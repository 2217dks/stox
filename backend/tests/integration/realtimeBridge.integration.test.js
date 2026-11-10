const http = require("http");

const app = require("../../src/app");
const {
  createInMemoryEventBus,
} = require("../../src/realtime/eventBus");
const { startRealtimeBridge } = require("../../src/realtime/realtimeBridge");
const { createSocketServer } = require("../../src/sockets");
const {
  collectEvents,
  connectSocket,
  emitWithAck,
  listen,
  sleep,
  waitForEvent,
} = require("../helpers/realtime");

/**
 * The bridge is the only component that knows how to translate a bus message
 * into a Socket.IO emission. These tests drive the bus as a black box and
 * assert on what real clients receive, so room targeting, payload fidelity,
 * and shutdown are covered without inspecting the bridge internals.
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
    bridge = await startRealtimeBridge({ io, bus });

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
    const payload = {
      symbol: "AAPL",
      price: "123.45",
      volume: "10",
      timestamp: "2026-11-11T10:00:00.000Z",
    };

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

  it("delivers a message without a room to the whole namespace", async () => {
    const payload = { message: "market maintenance in 5 minutes" };

    const apple = waitForEvent(appleClient, "maintenance");
    const microsoft = waitForEvent(microsoftClient, "maintenance");

    await bus.publish({
      namespace: "/market",
      event: "maintenance",
      payload,
    });

    await expect(apple).resolves.toEqual(payload);
    await expect(microsoft).resolves.toEqual(payload);
  });

  it("preserves the payload exactly, including nested values", async () => {
    const payload = {
      orderId: "order-1",
      nested: { levels: [1, 2, 3], missing: null },
      flag: false,
      count: 0,
    };

    const received = waitForEvent(appleClient, "custom-event");

    await bus.publish({
      namespace: "/market",
      room: "stock:AAPL",
      event: "custom-event",
      payload,
    });

    await expect(received).resolves.toEqual(payload);
  });

  it("delivers repeated messages in publish order", async () => {
    const events = collectEvents(appleClient, "sequence", 400);

    await bus.publish({
      namespace: "/market",
      room: "stock:AAPL",
      event: "sequence",
      payload: { index: 1 },
    });
    await bus.publish({
      namespace: "/market",
      room: "stock:AAPL",
      event: "sequence",
      payload: { index: 2 },
    });
    await bus.publish({
      namespace: "/market",
      room: "stock:AAPL",
      event: "sequence",
      payload: { index: 3 },
    });

    await expect(
      waitForEvent(appleClient, "sequence", {
        predicate: (payload) => payload.index === 3,
      }),
    ).resolves.toEqual({ index: 3 });

    expect((await events).map((payload) => payload.index)).toEqual([1, 2, 3]);
  });

  it("ignores malformed messages and keeps forwarding valid ones", async () => {
    const ignored = collectEvents(appleClient, "ignored-event", 250);

    for (const message of [
      null,
      undefined,
      "",
      {},
      { event: "ignored-event" },
      { namespace: "/market" },
    ]) {
      await bus.publish(message);
    }

    expect(await ignored).toEqual([]);

    const valid = waitForEvent(appleClient, "valid-event");

    await bus.publish({
      namespace: "/market",
      room: "stock:AAPL",
      event: "valid-event",
      payload: { ok: true },
    });

    await expect(valid).resolves.toEqual({ ok: true });
  });

  it("stops forwarding after the bridge is stopped", async () => {
    const localBus = createInMemoryEventBus();
    const localBridge = await startRealtimeBridge({ io, bus: localBus });

    const before = waitForEvent(appleClient, "before-stop");
    await localBus.publish({
      namespace: "/market",
      room: "stock:AAPL",
      event: "before-stop",
      payload: {},
    });
    await expect(before).resolves.toEqual({});

    localBridge.stop();

    const after = collectEvents(appleClient, "after-stop", 250);
    await localBus.publish({
      namespace: "/market",
      room: "stock:AAPL",
      event: "after-stop",
      payload: {},
    });

    await sleep(50);
    expect(await after).toEqual([]);
  });

  it("requires a Socket.IO server and a subscribable bus", async () => {
    await expect(startRealtimeBridge({})).rejects.toThrow(TypeError);
    await expect(startRealtimeBridge({ io })).rejects.toThrow(TypeError);
    await expect(
      startRealtimeBridge({ io, bus: { publish() {} } }),
    ).rejects.toThrow(TypeError);
  });
});
