const http = require("http");

const Redis = require("ioredis");
const request = require("supertest");

const app = require("../../src/app");
const prisma = require("../../src/config/database");
const {
  configureEventBus,
  resetEventBus,
} = require("../../src/realtime/eventBus");
const { createRedisEventBus } = require("../../src/realtime/redisBus");
const { startRealtimeBridge } = require("../../src/realtime/realtimeBridge");
const { createSocketServer } = require("../../src/sockets");
const {
  collectEvents,
  connectSocket,
  emitWithAck,
  listen,
  sleep,
  waitFor,
  waitForEvent,
} = require("../helpers/realtime");

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

let channelCounter = 0;

function uniqueChannel(label) {
  channelCounter += 1;
  return `stox:test:realtime:${process.pid}:${Date.now()}:${label}:${channelCounter}`;
}

/**
 * Redis is the production transport between the worker process (publisher) and
 * the API process (subscriber + Socket.IO bridge). These tests use the real
 * server so serialization, channel naming, and connection lifecycle are
 * exercised exactly as deployed.
 */
describe("Redis realtime event bus", () => {
  const buses = [];

  function createBus(options = {}) {
    const bus = createRedisEventBus(options);
    buses.push(bus);
    return bus;
  }

  afterEach(async () => {
    while (buses.length > 0) {
      const bus = buses.pop();

      try {
        await bus.close();
      } catch (error) {
        // Already closed.
      }
    }
  });

  it("round-trips a message from a publisher to a subscriber", async () => {
    const channel = uniqueChannel("deliver");
    const subscriber = createBus({ channel });
    const publisher = createBus({ channel, withSubscriber: false });
    const handler = jest.fn();

    await subscriber.subscribe(handler);

    const message = {
      namespace: "/trading",
      room: "portfolio:abc",
      event: "order-status",
      payload: { orderId: "o-1", status: "PENDING" },
    };

    await publisher.publish(message);

    await waitFor(() => handler.mock.calls.length === 1, {
      description: "Redis message delivery",
    });

    expect(handler).toHaveBeenCalledWith(message);
  });

  it("delivers one message to every subscriber", async () => {
    const channel = uniqueChannel("fan-out");
    const subscriber = createBus({ channel });
    const publisher = createBus({ channel, withSubscriber: false });
    const first = jest.fn();
    const second = jest.fn();

    await subscriber.subscribe(first);
    await subscriber.subscribe(second);

    await publisher.publish({ event: "trade-executed" });

    await waitFor(
      () => first.mock.calls.length === 1 && second.mock.calls.length === 1,
      { description: "fan-out to both handlers" },
    );

    expect(first).toHaveBeenCalledWith({ event: "trade-executed" });
    expect(second).toHaveBeenCalledWith({ event: "trade-executed" });
  });

  it("stops delivering to a handler after it unsubscribes", async () => {
    const channel = uniqueChannel("unsubscribe");
    const subscriber = createBus({ channel });
    const publisher = createBus({ channel, withSubscriber: false });
    const removed = jest.fn();
    const kept = jest.fn();

    const unsubscribe = await subscriber.subscribe(removed);
    await subscriber.subscribe(kept);

    unsubscribe();

    await publisher.publish({ event: "first" });

    await waitFor(() => kept.mock.calls.length === 1, {
      description: "remaining handler",
    });

    await sleep(100);

    expect(removed).not.toHaveBeenCalled();
  });

  it("ignores malformed messages and continues delivering valid ones", async () => {
    const channel = uniqueChannel("malformed");
    const subscriber = createBus({ channel });
    const publisher = createBus({ channel, withSubscriber: false });
    const handler = jest.fn();

    await subscriber.subscribe(handler);

    const raw = new Redis(REDIS_URL);

    try {
      await raw.publish(channel, "not-json");
    } finally {
      await raw.quit();
    }

    await publisher.publish({ event: "after-malformed" });

    await waitFor(() => handler.mock.calls.length === 1, {
      description: "valid message after malformed frame",
    });

    expect(handler).toHaveBeenCalledWith({ event: "after-malformed" });
  });

  it("does not leak messages across channels", async () => {
    const channel = uniqueChannel("isolation-a");
    const otherChannel = uniqueChannel("isolation-b");
    const bus = createBus({ channel });
    const otherBus = createBus({ channel: otherChannel });
    const publisher = createBus({ channel, withSubscriber: false });
    const leaked = jest.fn();

    await otherBus.subscribe(leaked);
    await publisher.publish({ event: "channel-a-only" });

    await sleep(150);

    expect(leaked).not.toHaveBeenCalled();
  });

  it("rejects subscription on a publisher-only bus", async () => {
    const bus = createBus({
      channel: uniqueChannel("publisher-only"),
      withSubscriber: false,
    });

    await expect(bus.subscribe(jest.fn())).rejects.toThrow(
      /publisher-only/i,
    );
  });

  it("closes the subscriber connection and stops delivering", async () => {
    const channel = uniqueChannel("close");
    const closingBus = createBus({ channel });
    const observer = createBus({ channel });
    const publisher = createBus({ channel, withSubscriber: false });
    const closedHandler = jest.fn();
    const observerHandler = jest.fn();

    await closingBus.subscribe(closedHandler);
    await observer.subscribe(observerHandler);

    await closingBus.close();

    await publisher.publish({ event: "after-close" });

    await waitFor(() => observerHandler.mock.calls.length === 1, {
      description: "observer delivery after another bus closed",
    });

    // The closed bus must not receive anything, even though the message did
    // reach the channel (proven by the observer above).
    expect(closedHandler).not.toHaveBeenCalled();

    // Publishing from a closed bus is best-effort and must never crash a
    // caller; it may reject, which the event bus wrapper already swallows.
    await closingBus.publish({ event: "closed" }).catch(() => {});
  });
});

describe("Worker-to-API realtime fan-out over Redis", () => {
  let server;
  let io;
  let baseUrl;
  let apiBus;
  let workerBus;
  let bridge;
  let client;
  let token;
  let userId;
  let portfolioId;

  beforeAll(async () => {
    jest.setTimeout(30000);

    server = http.createServer(app);
    ({ io } = createSocketServer(server));

    const port = await listen(server);
    baseUrl = `http://127.0.0.1:${port}`;

    const channel = uniqueChannel("cross-process");

    apiBus = createRedisEventBus({ channel });
    workerBus = createRedisEventBus({ channel, withSubscriber: false });

    configureEventBus(apiBus);
    bridge = await startRealtimeBridge({ io, bus: apiBus });

    const registration = await request(app)
      .post("/api/v1/auth/register")
      .send({
        name: "Redis Fanout User",
        email: `redis-fanout-${Date.now()}@stox.local`,
        password: "TestPassword123!",
      });

    token = registration.body.data.accessToken;
    userId = registration.body.data.user.id;

    const portfolio = await prisma.portfolio.findFirst({
      where: { userId, isDefault: true },
    });
    portfolioId = portfolio.id;

    client = await connectSocket(baseUrl, "/trading", {
      auth: { token },
    });

    const ack = await emitWithAck(client, "join:portfolio", { portfolioId });

    expect(ack).toEqual({ ok: true, portfolioId });
  });

  afterAll(async () => {
    if (client?.connected) {
      client.close();
    }

    if (bridge) {
      bridge.stop();
    }

    resetEventBus();

    if (apiBus) {
      await apiBus.close();
    }

    if (workerBus) {
      await workerBus.close();
    }

    if (userId) {
      await prisma.user.delete({ where: { id: userId } });
    }

    await new Promise((resolve) => io.close(resolve));
    await prisma.$disconnect();
  });

  it("forwards a worker-published order event to the portfolio room", async () => {
    const payload = {
      orderId: "order-from-worker",
      portfolioId,
      symbol: "AAPL",
      side: "BUY",
      type: "MARKET",
      status: "EXECUTED",
      quantity: "1",
      price: "100",
      updatedAt: new Date().toISOString(),
    };

    const received = waitForEvent(client, "order-status", {
      predicate: (event) => event.orderId === payload.orderId,
    });

    await workerBus.publish({
      namespace: "/trading",
      room: `portfolio:${portfolioId}`,
      event: "order-status",
      payload,
    });

    await expect(received).resolves.toEqual(payload);
  });

  it("does not forward a worker event aimed at another portfolio room", async () => {
    const received = collectEvents(client, "order-status", 300);

    await workerBus.publish({
      namespace: "/trading",
      room: `portfolio:${portfolioId}-not-mine`,
      event: "order-status",
      payload: {
        orderId: "foreign-order",
        portfolioId: `${portfolioId}-not-mine`,
        status: "EXECUTED",
      },
    });

    expect(await received).toEqual([]);
  });

  it("forwards trade-executed and portfolio-update payloads unchanged", async () => {
    const trade = {
      tradeId: "trade-1",
      orderId: "order-1",
      portfolioId,
      symbol: "AAPL",
      side: "BUY",
      quantity: "1",
      price: "100",
      totalValue: "100",
      realizedPnl: null,
      executedAt: new Date().toISOString(),
    };
    const valuation = {
      portfolioId,
      cashBalance: "9900",
      holdingsValue: "100",
      totalValue: "10000",
      pnl: "0",
      asOf: new Date().toISOString(),
    };

    const tradeEvent = waitForEvent(client, "trade-executed", {
      predicate: (event) => event.tradeId === trade.tradeId,
    });
    const portfolioEvent = waitForEvent(client, "portfolio-update", {
      predicate: (event) => event.portfolioId === portfolioId,
    });

    await workerBus.publish({
      namespace: "/trading",
      room: `portfolio:${portfolioId}`,
      event: "trade-executed",
      payload: trade,
    });
    await workerBus.publish({
      namespace: "/trading",
      room: `portfolio:${portfolioId}`,
      event: "portfolio-update",
      payload: valuation,
    });

    await expect(tradeEvent).resolves.toEqual(trade);
    await expect(portfolioEvent).resolves.toEqual(valuation);
  });
});
