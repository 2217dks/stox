const http = require("http");

const app = require("../../src/app");
const { createInMemoryEventBus } = require("../../src/realtime/eventBus");
const {
  startRealtimeBridge,
  validateMessage,
} = require("../../src/realtime/realtimeBridge");
const { createSocketServer } = require("../../src/sockets");
const logger = require("../../src/utils/logger");
const {
  collectEvents,
  connectSocket,
  emitWithAck,
  listen,
  sleep,
  waitFor,
  waitForEvent,
} = require("../helpers/realtime");

function pricePayload(symbol, price, extra = {}) {
  return {
    symbol,
    price: String(price),
    volume: "10",
    timestamp: "2026-11-11T10:00:00.000Z",
    ...extra,
  };
}

/**
 * The bridge is the only component that knows how to translate a bus message
 * into a Socket.IO emission. These tests drive the bus as a black box and
 * assert on what real clients receive, so room targeting, validation, payload
 * fidelity, startup retry, and shutdown are covered without inspecting private
 * bridge internals.
 */
describe("Realtime event bridge", () => {
  let server;
  let io;
  let marketRooms;
  let baseUrl;
  let bus;
  let bridge;
  let appleClient;
  let microsoftClient;

  const priceStream = {
    subscribe: jest.fn(),
    unsubscribe: jest.fn(),
    stop: jest.fn(),
  };

  const cache = {
    async getPrice() {
      return null;
    },
    async setPrice() {
      return true;
    },
  };

  beforeAll(async () => {
    jest.setTimeout(20000);

    server = http.createServer(app);
    ({ io, marketRooms } = createSocketServer(server, {
      marketPriceStream: priceStream,
      marketCache: cache,
    }));

    const port = await listen(server);
    baseUrl = `http://127.0.0.1:${port}`;

    bus = createInMemoryEventBus();
    bridge = startRealtimeBridge({ io, bus });
    await bridge.ready;

    appleClient = await connectSocket(baseUrl, "/market");
    microsoftClient = await connectSocket(baseUrl, "/market");

    await emitWithAck(appleClient, "subscribe", { symbol: "AAPL" });
    await emitWithAck(microsoftClient, "subscribe", { symbol: "MSFT" });
  });

  afterAll(async () => {
    for (const client of [appleClient, microsoftClient]) {
      if (client?.connected) {
        client.close();
      }
    }

    bridge.stop();
    marketRooms.stop();

    await new Promise((resolve) => io.close(resolve));
  });

  it("delivers a room-scoped message only to that room", async () => {
    const payload = pricePayload("AAPL", "123.45");

    const received = waitForEvent(appleClient, "price-update");
    const notReceived = collectEvents(microsoftClient, "price-update", 250);

    await bus.publish({
      namespace: "/market",
      room: "stock:AAPL",
      event: "price-update",
      payload,
    });

    await expect(received).resolves.toEqual(payload);
    expect(await notReceived).toEqual([]);
  });

  it("rejects trading events when the room and payload portfolio IDs differ", () => {
    const cases = [
      {
        event: "order-status",
        payload: {
          orderId: "order-1",
          portfolioId: "portfolio-B",
          status: "PENDING",
        },
      },
      {
        event: "trade-executed",
        payload: {
          tradeId: "trade-1",
          orderId: "order-1",
          portfolioId: "portfolio-B",
        },
      },
      {
        event: "portfolio-update",
        payload: {
          portfolioId: "portfolio-B",
        },
      },
    ];

    for (const { event, payload } of cases) {
      const result = validateMessage({
        namespace: "/trading",
        room: "portfolio:portfolio-A",
        event,
        payload,
      });

      expect(result).toEqual({
        ok: false,
        reason: "trading room portfolio ID must match payload.portfolioId.",
      });
    }
  });

  it("accepts trading events when the room and payload portfolio IDs match", () => {
    const cases = [
      {
        event: "order-status",
        payload: {
          orderId: "order-1",
          portfolioId: "portfolio-A",
          status: "PENDING",
        },
      },
      {
        event: "trade-executed",
        payload: {
          tradeId: "trade-1",
          orderId: "order-1",
          portfolioId: "portfolio-A",
        },
      },
      {
        event: "portfolio-update",
        payload: {
          portfolioId: "portfolio-A",
        },
      },
    ];

    for (const { event, payload } of cases) {
      const result = validateMessage({
        namespace: "/trading",
        room: "portfolio:portfolio-A",
        event,
        payload,
      });

      expect(result).toMatchObject({
        ok: true,
      });
    }
  });

  it("rejects roomless events and rooms from another namespace", async () => {
    const ignored = collectEvents(appleClient, "price-update", 250);

    await bus.publish({
      namespace: "/market",
      event: "price-update",
      payload: pricePayload("AAPL", "1"),
    });
    await bus.publish({
      namespace: "/market",
      room: "portfolio:not-a-market-room",
      event: "price-update",
      payload: pricePayload("AAPL", "2"),
    });

    expect(await ignored).toEqual([]);
  });

  it("preserves the payload exactly, including extra fields", async () => {
    const payload = pricePayload("AAPL", "1", {
      nested: { levels: [1, 2, 3], missing: null },
      flag: false,
      count: 0,
    });

    const received = waitForEvent(appleClient, "price-update", {
      predicate: (event) => event.flag === false,
    });

    await bus.publish({
      namespace: "/market",
      room: "stock:AAPL",
      event: "price-update",
      payload,
    });

    await expect(received).resolves.toEqual(payload);
  });

  it("delivers repeated messages in publish order", async () => {
    const eventsPromise = collectEvents(appleClient, "price-update", 400);
    const third = waitForEvent(appleClient, "price-update", {
      predicate: (payload) => payload.price === "3",
    });

    for (const price of [1, 2, 3]) {
      await bus.publish({
        namespace: "/market",
        room: "stock:AAPL",
        event: "price-update",
        payload: pricePayload("AAPL", price),
      });
    }

    await expect(third).resolves.toMatchObject({ price: "3" });

    const events = await eventsPromise;

    expect(events.map((payload) => payload.price)).toEqual(["1", "2", "3"]);
  });

  it("ignores malformed messages and keeps forwarding valid ones", async () => {
    const ignored = collectEvents(appleClient, "price-update", 250);
    const warn = jest.spyOn(logger, "warn").mockImplementation(() => {});

    try {
      for (const message of [
        null,
        undefined,
        "",
        {},
        { event: "price-update" },
        { namespace: "/market" },
        { namespace: "/unknown", event: "price-update", payload: {} },
        { namespace: "/market", event: "unknown-event", payload: {} },
        {
          namespace: "/market",
          event: "price-update",
          payload: null,
        },
        {
          namespace: "/market",
          event: "price-update",
          payload: { symbol: "", price: "1" },
        },
        {
          namespace: "/market",
          event: "price-update",
          payload: { symbol: "AAPL", price: "not-a-number" },
        },
        // Prototype keys must not be treated as validators.
        { namespace: "constructor", event: "price-update", payload: {} },
        { namespace: "/market", event: "constructor", payload: {} },
        { namespace: "/market", event: "hasOwnProperty", payload: {} },
        {
          namespace: "/trading",
          event: "order-status",
          payload: {
            orderId: "o-1",
            portfolioId: "p-1",
            status: "NOT_A_STATUS",
          },
        },
      ]) {
        await bus.publish(message);
      }

      expect(await ignored).toEqual([]);

      const rejected = warn.mock.calls.filter(
        ([message]) => message === "Realtime message rejected",
      );

      expect(rejected.length).toBeGreaterThan(0);

      // Rejected-message logs explain why, but never include the payload.
      for (const [, meta] of rejected) {
        expect(meta).toEqual(
          expect.objectContaining({
            reason: expect.any(String),
          }),
        );
        expect(meta).toHaveProperty("namespace");
        expect(meta).toHaveProperty("event");
        expect(meta).not.toHaveProperty("payload");
      }
    } finally {
      warn.mockRestore();
    }

    const valid = waitForEvent(appleClient, "price-update", {
      predicate: (payload) =>
        payload.symbol === "AAPL" && payload.price === "9",
    });

    await bus.publish({
      namespace: "/market",
      room: "stock:AAPL",
      event: "price-update",
      payload: pricePayload("AAPL", 9),
    });

    await expect(valid).resolves.toMatchObject({ symbol: "AAPL", price: "9" });
  });

  it("registers only one bridge for the same Socket.IO server and bus", async () => {
    const duplicate = startRealtimeBridge({ io, bus });

    expect(duplicate).toBe(bridge);

    const received = collectEvents(appleClient, "price-update", 300);

    await bus.publish({
      namespace: "/market",
      room: "stock:AAPL",
      event: "price-update",
      payload: pricePayload("AAPL", "7"),
    });

    // Give a duplicate registration a chance to deliver a second copy.
    expect(await received).toHaveLength(1);
  });

  it("stops forwarding after the bridge is stopped", async () => {
    const localBus = createInMemoryEventBus();
    const localBridge = startRealtimeBridge({ io, bus: localBus });

    await localBridge.ready;

    const before = waitForEvent(appleClient, "price-update", {
      predicate: (payload) => payload.price === "11",
    });

    await localBus.publish({
      namespace: "/market",
      room: "stock:AAPL",
      event: "price-update",
      payload: pricePayload("AAPL", 11),
    });

    await expect(before).resolves.toMatchObject({ price: "11" });

    localBridge.stop();

    const after = collectEvents(appleClient, "price-update", 250);

    await localBus.publish({
      namespace: "/market",
      room: "stock:AAPL",
      event: "price-update",
      payload: pricePayload("AAPL", 12),
    });

    await sleep(50);
    expect(await after).toEqual([]);
  });

  it("retries bridge startup until the bus accepts the subscription", async () => {
    const flakyBus = {
      attempts: 0,
      async subscribe() {
        this.attempts += 1;

        if (this.attempts < 3) {
          throw new Error("redis unavailable");
        }

        return () => {};
      },
    };

    const retryBridge = startRealtimeBridge({
      io,
      bus: flakyBus,
      retryBaseDelayMs: 5,
      retryMaxDelayMs: 5,
    });

    try {
      expect(retryBridge.getState().status).toBe("connecting");
      await expect(retryBridge.ready).resolves.toBe(true);
      expect(flakyBus.attempts).toBe(3);
      expect(retryBridge.getState()).toMatchObject({
        status: "connected",
        attempts: 3,
      });
    } finally {
      retryBridge.stop();
    }
  });

  it("stops a pending startup when the bridge is stopped", async () => {
    let attempts = 0;
    const unavailableBus = {
      async subscribe() {
        attempts += 1;
        throw new Error("redis unavailable");
      },
    };

    const pending = startRealtimeBridge({
      io,
      bus: unavailableBus,
      retryBaseDelayMs: 5,
      retryMaxDelayMs: 5,
    });

    await waitFor(() => attempts >= 2, {
      description: "startup retry attempts",
    });

    pending.stop();

    await expect(pending.ready).resolves.toBe(false);
    expect(pending.getState().status).toBe("stopped");

    const attemptsAtStop = attempts;

    await sleep(50);

    expect(attempts).toBe(attemptsAtStop);
  });

  it("requires a Socket.IO server and a subscribable bus", () => {
    expect(() => startRealtimeBridge({})).toThrow(TypeError);
    expect(() => startRealtimeBridge({ io })).toThrow(TypeError);
    expect(() => startRealtimeBridge({ io, bus: { publish() {} } })).toThrow(
      TypeError,
    );
  });
});
