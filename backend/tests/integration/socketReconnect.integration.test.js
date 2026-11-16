const http = require("http");
const request = require("supertest");

const app = require("../../src/app");
const prisma = require("../../src/config/database");
const { createInMemoryEventBus } = require("../../src/realtime/eventBus");
const { startRealtimeBridge } = require("../../src/realtime/realtimeBridge");
const { createSocketServer } = require("../../src/sockets");
const {
  collectEvents,
  connectSocket,
  emitWithAck,
  listen,
  waitFor,
  waitForEvent,
} = require("../helpers/realtime");

const timestamp = Date.now();

function reconnect(client) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("Socket did not reconnect in time."));
    }, 5000);

    client.once("connect", () => {
      clearTimeout(timer);
      resolve();
    });

    client.disconnect();
    client.connect();
  });
}

function tradePayload(tradeId, portfolioId) {
  return {
    tradeId,
    orderId: `order-${tradeId}`,
    portfolioId,
    symbol: "AAPL",
    side: "BUY",
    quantity: "1",
    price: "200",
    totalValue: "200",
    realizedPnl: null,
    executedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("Socket reconnect handling", () => {
  let server;
  let io;
  let marketRooms;
  let baseUrl;
  let bus;
  let bridge;
  let userId;
  let portfolioId;
  let accessToken;

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
    jest.setTimeout(30000);

    server = http.createServer(app);
    ({ io, marketRooms } = createSocketServer(server, {
      marketPriceStream: priceStream,
      marketCache: cache,
    }));

    baseUrl = `http://127.0.0.1:${await listen(server)}`;

    bus = createInMemoryEventBus();
    bridge = startRealtimeBridge({ io, bus });
    await bridge.ready;

    const registration = await request(app)
      .post("/api/v1/auth/register")
      .send({
        name: "Socket Reconnect User",
        email: `socket-reconnect-${timestamp}@stox.local`,
        password: "TestPassword123!",
      });

    userId = registration.body.data.user.id;
    accessToken = registration.body.data.accessToken;

    const portfolio = await prisma.portfolio.findFirst({
      where: { userId, isDefault: true },
    });

    portfolioId = portfolio.id;
  });

  afterAll(async () => {
    bridge.stop();
    marketRooms.stop();

    if (userId) {
      await prisma.user.deleteMany({ where: { id: userId } });
    }

    await new Promise((resolve) => io.close(resolve));
    await prisma.$disconnect();
  });

  test("a reconnected trading socket must rejoin before receiving events again", async () => {
    const client = await connectSocket(baseUrl, "/trading", {
      auth: { token: accessToken },
    });

    await expect(
      emitWithAck(client, "join:portfolio", { portfolioId }),
    ).resolves.toEqual({ ok: true, portfolioId });

    await reconnect(client);
    expect(client.connected).toBe(true);

    // The new server-side socket starts with no rooms.
    const missed = collectEvents(client, "trade-executed", 250);
    await bus.publish({
      namespace: "/trading",
      room: `portfolio:${portfolioId}`,
      event: "trade-executed",
      payload: tradePayload("missed", portfolioId),
    });
    expect(await missed).toEqual([]);

    await expect(
      emitWithAck(client, "join:portfolio", { portfolioId }),
    ).resolves.toEqual({ ok: true, portfolioId });

    const received = waitForEvent(client, "trade-executed");
    await bus.publish({
      namespace: "/trading",
      room: `portfolio:${portfolioId}`,
      event: "trade-executed",
      payload: tradePayload("after-rejoin", portfolioId),
    });

    await expect(received).resolves.toMatchObject({
      tradeId: "after-rejoin",
    });

    // One publish must produce exactly one delivery, not one per old listener.
    const single = collectEvents(client, "trade-executed", 300);
    await bus.publish({
      namespace: "/trading",
      room: `portfolio:${portfolioId}`,
      event: "trade-executed",
      payload: tradePayload("single-delivery", portfolioId),
    });

    expect(await single).toHaveLength(1);

    client.close();
  });

  test("a reconnected notifications socket re-authenticates and rejoins its user room", async () => {
    const client = await connectSocket(baseUrl, "/notifications", {
      auth: { token: accessToken },
    });

    await reconnect(client);
    expect(client.connected).toBe(true);

    // The server derives the room from the token on every new connection, so
    // the client does not have to rejoin manually.
    const received = waitForEvent(client, "notification");
    await bus.publish({
      namespace: "/notifications",
      room: `user:${userId}`,
      event: "notification",
      payload: {
        notificationId: "notification-reconnect",
        userId,
        type: "ORDER_EXECUTED",
        title: "Order executed",
        message: "BUY 1 AAPL executed.",
        data: { symbol: "AAPL" },
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    });

    await expect(received).resolves.toMatchObject({
      notificationId: "notification-reconnect",
    });

    const single = collectEvents(client, "notification", 300);
    await bus.publish({
      namespace: "/notifications",
      room: `user:${userId}`,
      event: "notification",
      payload: {
        notificationId: "notification-single",
        userId,
        type: "ORDER_EXECUTED",
        title: "Order executed",
        message: "SELL 1 AAPL executed.",
        data: { symbol: "AAPL" },
        createdAt: "2026-01-01T00:00:01.000Z",
      },
    });

    expect(await single).toHaveLength(1);

    client.close();
  });

  test("a reconnected market socket must resubscribe before receiving prices", async () => {
    priceStream.subscribe.mockClear();
    priceStream.unsubscribe.mockClear();

    const client = await connectSocket(baseUrl, "/market");

    await expect(
      emitWithAck(client, "subscribe", { symbol: "AAPL", assetClass: "STOCK" }),
    ).resolves.toMatchObject({ ok: true, symbol: "AAPL" });

    await reconnect(client);
    expect(client.connected).toBe(true);

    await waitFor(
      () =>
        priceStream.unsubscribe.mock.calls.some(
          ([symbol]) => symbol === "AAPL",
        ),
      { description: "subscription release on disconnect" },
    );

    const missed = collectEvents(client, "price-update", 250);
    await bus.publish({
      namespace: "/market",
      room: "stock:AAPL",
      event: "price-update",
      payload: {
        symbol: "AAPL",
        price: "100",
        volume: "10",
        timestamp: "2026-01-01T00:00:00.000Z",
      },
    });
    expect(await missed).toEqual([]);

    await expect(
      emitWithAck(client, "subscribe", { symbol: "AAPL", assetClass: "STOCK" }),
    ).resolves.toMatchObject({ ok: true, symbol: "AAPL" });

    const received = waitForEvent(client, "price-update");
    await bus.publish({
      namespace: "/market",
      room: "stock:AAPL",
      event: "price-update",
      payload: {
        symbol: "AAPL",
        price: "101",
        volume: "10",
        timestamp: "2026-01-01T00:00:01.000Z",
      },
    });

    await expect(received).resolves.toMatchObject({ price: "101" });

    const single = collectEvents(client, "price-update", 300);
    await bus.publish({
      namespace: "/market",
      room: "stock:AAPL",
      event: "price-update",
      payload: {
        symbol: "AAPL",
        price: "102",
        volume: "10",
        timestamp: "2026-01-01T00:00:02.000Z",
      },
    });

    expect(await single).toHaveLength(1);

    client.close();
  });
});
