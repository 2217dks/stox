const request = require("supertest");

const app = require("../../src/app");
const prisma = require("../../src/config/database");
const orderService = require("../../src/services/orderService");
const tradeService = require("../../src/services/tradeService");
const {
  expireOverdueOrders,
  processPendingOrders,
} = require("../../src/workers/orderWorker");

// Order expiry is a terminal transition: it must release the cash reservation,
// record exactly one lifecycle event, and stay safe when a cancel or an
// execution races the sweep. The sweep also covers inactive portfolios, whose
// rows are deliberately excluded from the execution batch.

const timestamp = Date.now();

let user;
let token;
let portfolioId;

const quoteAt = (price) => ({
  getQuote: jest.fn(async (symbol) => ({
    symbol,
    assetClass: "STOCK",
    price,
  })),
});

async function resetPortfolio({ cashBalance = "10000", isActive = true } = {}) {
  await prisma.notification.deleteMany({ where: { userId: user.id } });
  await prisma.order.deleteMany({ where: { portfolioId } });
  await prisma.holding.deleteMany({ where: { portfolioId } });

  await prisma.portfolio.update({
    where: { id: portfolioId },
    data: {
      cashBalance,
      reservedCash: "0",
      isActive,
    },
  });
}

async function createOrder({ expiresAt, ...overrides } = {}) {
  // The public API (and the service) rejects a past expiry. Create a normal
  // future-dated order, then move its deadline into the past to model a row
  // that has aged out while it was pending.
  const order = await orderService.createOrder({
    userId: user.id,
    portfolioId,
    symbol: "AAPL",
    assetType: "STOCK",
    side: "BUY",
    type: "LIMIT",
    quantity: "2",
    limitPrice: "100",
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    ...overrides,
  });

  if (expiresAt !== undefined) {
    await prisma.order.update({
      where: { id: order.id },
      data: { expiresAt },
    });
  }

  return order;
}

async function eventsFor(orderId) {
  return prisma.orderEvent.findMany({
    where: { orderId },
    orderBy: [{ sequence: "asc" }],
  });
}

beforeAll(async () => {
  jest.setTimeout(30000);

  const register = await request(app).post("/api/v1/auth/register").send({
    name: "Order Expiry Test User",
    email: `order-expiry-${timestamp}@stox.local`,
    password: "TestPassword123!",
  });

  user = register.body.data.user;
  token = register.body.data.accessToken;

  const portfolios = await request(app)
    .get("/api/v1/portfolios")
    .set("Authorization", `Bearer ${token}`);

  portfolioId = portfolios.body.data.portfolios.find(
    (portfolio) => portfolio.isDefault,
  ).id;
});

beforeEach(async () => {
  await resetPortfolio();
});

afterAll(async () => {
  if (user?.id) {
    await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
  }

  await prisma.$disconnect();
});

describe("POST /orders expiresAt contract", () => {
  function postOrder(body) {
    return request(app)
      .post("/api/v1/orders")
      .set("Authorization", `Bearer ${token}`)
      .send(body);
  }

  test("accepts a future ISO instant with an explicit UTC offset and persists it", async () => {
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    const response = await postOrder({
      portfolioId,
      symbol: "AAPL",
      assetType: "STOCK",
      side: "BUY",
      type: "LIMIT",
      quantity: "2",
      limitPrice: "100",
      expiresAt,
    });

    expect(response.status).toBe(201);
    expect(response.body.data.order.expiresAt).toBe(expiresAt);

    const stored = await prisma.order.findUnique({
      where: { id: response.body.data.order.id },
    });
    expect(stored.expiresAt.toISOString()).toBe(expiresAt);

    const events = await eventsFor(stored.id);
    expect(events[0].metadata).toMatchObject({ expiresAt });
  });

  test("rejects a past instant", async () => {
    const response = await postOrder({
      portfolioId,
      symbol: "AAPL",
      assetType: "STOCK",
      side: "BUY",
      type: "LIMIT",
      quantity: "1",
      limitPrice: "100",
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
    expect(
      response.body.error.details.map((detail) => detail.path),
    ).toContain("expiresAt");
  });

  test("rejects an instant without an explicit UTC offset", async () => {
    const response = await postOrder({
      portfolioId,
      symbol: "AAPL",
      assetType: "STOCK",
      side: "BUY",
      type: "LIMIT",
      quantity: "1",
      limitPrice: "100",
      expiresAt: "2030-01-01T00:00:00",
    });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
    expect(
      response.body.error.details.map((detail) => detail.path),
    ).toContain("expiresAt");
  });

  test("rejects an unparseable value", async () => {
    const response = await postOrder({
      portfolioId,
      symbol: "AAPL",
      assetType: "STOCK",
      side: "BUY",
      type: "LIMIT",
      quantity: "1",
      limitPrice: "100",
      expiresAt: "not-a-date",
    });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("expireOverdueOrders", () => {
  test("expires an order at the exact boundary and releases its reservation", async () => {
    const order = await createOrder({
      expiresAt: new Date("2026-01-01T00:00:00.000Z"),
    });

    const result = await expireOverdueOrders({
      now: new Date("2026-01-01T00:00:00.000Z"),
    });

    expect(result).toEqual({ scanned: 1, expired: 1 });

    const [storedOrder, portfolio, events] = await Promise.all([
      prisma.order.findUnique({ where: { id: order.id } }),
      prisma.portfolio.findUnique({ where: { id: portfolioId } }),
      eventsFor(order.id),
    ]);

    expect(storedOrder.status).toBe("EXPIRED");
    expect(storedOrder.reservedCash.toString()).toBe("0");
    expect(portfolio.reservedCash.toString()).toBe("0");
    expect(events.map((event) => event.eventType)).toEqual([
      "CREATED",
      "EXPIRED",
    ]);
    expect(events[1].metadata).toMatchObject({ reason: "ORDER_EXPIRED" });
  });

  test("does not expire an order before its expiry instant", async () => {
    const order = await createOrder({
      expiresAt: new Date("2026-01-01T00:00:00.001Z"),
    });

    const result = await expireOverdueOrders({
      now: new Date("2026-01-01T00:00:00.000Z"),
    });

    expect(result).toEqual({ scanned: 0, expired: 0 });

    const storedOrder = await prisma.order.findUnique({
      where: { id: order.id },
    });
    expect(storedOrder.status).toBe("PENDING");
  });

  test("is idempotent when the sweep runs twice", async () => {
    const order = await createOrder({
      expiresAt: new Date("2026-01-01T00:00:00.000Z"),
    });

    const now = new Date("2026-01-02T00:00:00.000Z");
    const first = await expireOverdueOrders({ now });
    const second = await expireOverdueOrders({ now });

    expect(first).toEqual({ scanned: 1, expired: 1 });
    expect(second).toEqual({ scanned: 0, expired: 0 });

    const events = await eventsFor(order.id);
    expect(events.map((event) => event.eventType)).toEqual([
      "CREATED",
      "EXPIRED",
    ]);
  });

  test("expires an order whose portfolio is inactive, without touching newer pending orders", async () => {
    const expired = await createOrder({
      expiresAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    const stillPending = await createOrder({
      expiresAt: new Date("2030-01-01T00:00:00.000Z"),
    });

    await prisma.portfolio.update({
      where: { id: portfolioId },
      data: { isActive: false },
    });

    const result = await expireOverdueOrders({
      now: new Date("2026-06-01T00:00:00.000Z"),
    });

    expect(result).toEqual({ scanned: 1, expired: 1 });

    const [expiredOrder, pendingOrder, portfolio] = await Promise.all([
      prisma.order.findUnique({ where: { id: expired.id } }),
      prisma.order.findUnique({ where: { id: stillPending.id } }),
      prisma.portfolio.findUnique({ where: { id: portfolioId } }),
    ]);

    expect(expiredOrder.status).toBe("EXPIRED");
    expect(expiredOrder.reservedCash.toString()).toBe("0");
    expect(pendingOrder.status).toBe("PENDING");
    // The still-pending order keeps its reservation; the expired one released
    // only its own share.
    expect(portfolio.reservedCash.toString()).toBe("200");
  });
});

describe("expiry through the worker", () => {
  test("the polling pass expires overdue orders before fetching the execution batch", async () => {
    const order = await createOrder({
      expiresAt: new Date("2026-01-01T00:00:00.000Z"),
    });

    const quoteProvider = quoteAt("100");

    const summary = await processPendingOrders({
      quoteProvider,
      portfolioId,
      now: new Date("2026-06-01T00:00:00.000Z"),
    });

    expect(summary).toMatchObject({
      scanned: 1,
      expired: 1,
      executed: 0,
      skipped: 0,
    });
    expect(quoteProvider.getQuote).not.toHaveBeenCalled();

    const storedOrder = await prisma.order.findUnique({
      where: { id: order.id },
    });
    expect(storedOrder.status).toBe("EXPIRED");
  });

  test("an execution that races expiry cannot fill an expired order", async () => {
    const order = await createOrder({
      expiresAt: new Date("2026-01-01T00:00:00.000Z"),
    });

    await expect(
      tradeService.executeOrder(order.id, "100", {
        now: new Date("2026-06-01T00:00:00.000Z"),
      }),
    ).rejects.toMatchObject({ code: "ORDER_EXPIRED" });

    const storedOrder = await prisma.order.findUnique({
      where: { id: order.id },
    });
    expect(storedOrder.status).toBe("PENDING");
    expect(await prisma.trade.count({ where: { orderId: order.id } })).toBe(0);

    // The worker's next pass settles the row as EXPIRED.
    const summary = await processPendingOrders({
      quoteProvider: quoteAt("100"),
      portfolioId,
      now: new Date("2026-06-01T00:00:00.000Z"),
    });

    expect(summary).toMatchObject({ expired: 1 });
  });

  test("concurrent cancel and expiry produce one terminal transition and one event", async () => {
    const order = await createOrder({
      expiresAt: new Date("2026-01-01T00:00:00.000Z"),
    });

    const results = await Promise.allSettled([
      orderService.cancelOrder({ userId: user.id, orderId: order.id }),
      expireOverdueOrders({ now: new Date("2026-06-01T00:00:00.000Z") }),
    ]);

    // Cancellation may win (then the sweep finds nothing) or lose (then it
    // throws ORDER_NOT_CANCELLABLE). Both are valid; the invariants below are
    // what matter.
    expect(
      results.some((result) => result.status === "fulfilled"),
    ).toBe(true);

    const [storedOrder, events, portfolio] = await Promise.all([
      prisma.order.findUnique({ where: { id: order.id } }),
      eventsFor(order.id),
      prisma.portfolio.findUnique({ where: { id: portfolioId } }),
    ]);

    expect(["CANCELLED", "EXPIRED"]).toContain(storedOrder.status);
    expect(storedOrder.reservedCash.toString()).toBe("0");
    expect(portfolio.reservedCash.toString()).toBe("0");
    expect(events).toHaveLength(2);
    expect(events[1].eventType).toBe(storedOrder.status);
  });

  test("concurrent execute and expiry never produce both a fill and an expiry", async () => {
    const order = await createOrder({
      expiresAt: new Date("2026-01-01T00:00:00.000Z"),
    });

    const now = new Date("2026-06-01T00:00:00.000Z");

    await Promise.allSettled([
      tradeService.executeOrder(order.id, "100", { now }),
      expireOverdueOrders({ now }),
    ]);

    const [storedOrder, tradeCount, events] = await Promise.all([
      prisma.order.findUnique({ where: { id: order.id } }),
      prisma.trade.count({ where: { orderId: order.id } }),
      eventsFor(order.id),
    ]);

    if (storedOrder.status === "EXECUTED") {
      expect(tradeCount).toBe(1);
      expect(events).toHaveLength(2);
      expect(events[1].eventType).toBe("EXECUTED");
    } else {
      expect(storedOrder.status).toBe("EXPIRED");
      expect(tradeCount).toBe(0);
      expect(events).toHaveLength(2);
      expect(events[1].eventType).toBe("EXPIRED");
    }
  });
});
