const prisma = require("../../src/config/database");
const { processPendingOrders } = require("../../src/workers/orderWorker");

// Contract tests for the pending-order processor. The real database and the
// real executeOrder transaction are used; only the market-data provider is
// injected, so these tests never call Finnhub or Binance.

const timestamp = Date.now();

let userId;
let portfolioId;

const quoteAt = (price) => ({
  getQuote: jest.fn(async (symbol) => ({
    symbol,
    assetClass: "STOCK",
    price,
  })),
});

async function resetPortfolio({ cashBalance = "10000", isActive = true } = {}) {
  await prisma.notification.deleteMany({ where: { userId } });
  await prisma.trade.deleteMany({ where: { portfolioId } });
  await prisma.order.deleteMany({ where: { portfolioId } });
  await prisma.holding.deleteMany({ where: { portfolioId } });
  await prisma.portfolio.update({
    where: { id: portfolioId },
    data: { cashBalance, isActive },
  });
}

async function createOrder(overrides = {}) {
  return prisma.order.create({
    data: {
      portfolioId,
      symbol: "AAPL",
      assetType: "STOCK",
      side: "BUY",
      type: "MARKET",
      status: "PENDING",
      quantity: "1",
      ...overrides,
    },
  });
}

beforeAll(async () => {
  jest.setTimeout(30000);

  const user = await prisma.user.create({
    data: {
      email: `order-worker-${timestamp}@stox.local`,
      name: "Order Worker Test User",
      passwordHash: "not-used-by-these-tests",
    },
  });

  userId = user.id;

  const portfolio = await prisma.portfolio.create({
    data: {
      userId,
      name: `Worker Portfolio ${timestamp}`,
      startingBalance: "10000",
      cashBalance: "10000",
    },
  });

  portfolioId = portfolio.id;
});

beforeEach(async () => {
  await resetPortfolio();
});

afterAll(async () => {
  if (userId) {
    await prisma.user.delete({ where: { id: userId } }).catch(() => {});
  }

  await prisma.$disconnect();
});

describe("processPendingOrders", () => {
  test("executes a market order at the provider quote", async () => {
    const order = await createOrder({ quantity: "2" });
    const quoteProvider = quoteAt("100");

    const summary = await processPendingOrders({
      quoteProvider,
      portfolioId,
    });

    expect(summary).toMatchObject({
      scanned: 1,
      executed: 1,
      skipped: 0,
      failed: 0,
    });

    const [storedOrder, trade, holding, portfolio] = await Promise.all([
      prisma.order.findUnique({ where: { id: order.id } }),
      prisma.trade.findUnique({ where: { orderId: order.id } }),
      prisma.holding.findUnique({
        where: { portfolioId_symbol: { portfolioId, symbol: "AAPL" } },
      }),
      prisma.portfolio.findUnique({ where: { id: portfolioId } }),
    ]);

    expect(storedOrder.status).toBe("EXECUTED");
    expect(storedOrder.executedPrice.toString()).toBe("100");
    expect(trade.totalValue.toString()).toBe("200");
    expect(holding.quantity.toString()).toBe("2");
    expect(portfolio.cashBalance.toString()).toBe("9800");
  });

  test("keeps an unmet limit order pending until the trigger price is reached", async () => {
    const order = await createOrder({
      type: "LIMIT",
      limitPrice: "250",
      quantity: "2",
    });

    const aboveLimit = await processPendingOrders({
      quoteProvider: quoteAt("250.01"),
      portfolioId,
    });

    expect(aboveLimit).toMatchObject({ scanned: 1, executed: 0, skipped: 1 });

    let storedOrder = await prisma.order.findUnique({
      where: { id: order.id },
    });
    expect(storedOrder.status).toBe("PENDING");
    expect(await prisma.trade.count({ where: { orderId: order.id } })).toBe(0);

    const atLimit = await processPendingOrders({
      quoteProvider: quoteAt("250"),
      portfolioId,
    });

    expect(atLimit).toMatchObject({ scanned: 1, executed: 1 });

    storedOrder = await prisma.order.findUnique({ where: { id: order.id } });
    expect(storedOrder.status).toBe("EXECUTED");
    expect(storedOrder.executedPrice.toString()).toBe("250");
  });

  test("expires an order whose expiry has passed without calling the provider", async () => {
    const order = await createOrder({
      expiresAt: new Date(Date.now() - 1000),
    });
    const quoteProvider = quoteAt("100");

    const summary = await processPendingOrders({
      quoteProvider,
      portfolioId,
      now: new Date(),
    });

    expect(summary).toMatchObject({ scanned: 1, expired: 1, executed: 0 });
    expect(quoteProvider.getQuote).not.toHaveBeenCalled();

    const storedOrder = await prisma.order.findUnique({
      where: { id: order.id },
    });
    expect(storedOrder.status).toBe("EXPIRED");
  });

  test("rejects an order that cannot be funded instead of retrying forever", async () => {
    await resetPortfolio({ cashBalance: "50" });
    const order = await createOrder({ quantity: "1" });

    const summary = await processPendingOrders({
      quoteProvider: quoteAt("100"),
      portfolioId,
    });

    expect(summary).toMatchObject({ scanned: 1, rejected: 1, executed: 0 });

    const storedOrder = await prisma.order.findUnique({
      where: { id: order.id },
    });
    expect(storedOrder.status).toBe("REJECTED");
    expect(await prisma.trade.count({ where: { orderId: order.id } })).toBe(0);
  });

  test("leaves an order pending when the provider fails", async () => {
    const order = await createOrder();
    const quoteProvider = {
      getQuote: jest.fn(async () => {
        throw new Error("provider unavailable");
      }),
    };

    const summary = await processPendingOrders({
      quoteProvider,
      portfolioId,
    });

    expect(summary).toMatchObject({ scanned: 1, failed: 1, executed: 0 });

    const storedOrder = await prisma.order.findUnique({
      where: { id: order.id },
    });
    expect(storedOrder.status).toBe("PENDING");
  });

  test("skips orders belonging to an inactive portfolio", async () => {
    await resetPortfolio({ isActive: false });
    const order = await createOrder();
    const quoteProvider = quoteAt("100");

    const summary = await processPendingOrders({
      quoteProvider,
      portfolioId,
    });

    expect(summary).toMatchObject({ scanned: 1, skipped: 1, executed: 0 });
    expect(quoteProvider.getQuote).not.toHaveBeenCalled();

    const storedOrder = await prisma.order.findUnique({
      where: { id: order.id },
    });
    expect(storedOrder.status).toBe("PENDING");
  });

  test("rejects an already-pending FOREX order instead of retrying it forever", async () => {
    // Defence in depth: new FOREX orders are rejected at placement, but a row
    // written before that guard (or by another process) must not occupy a
    // queue slot on every poll.
    const order = await createOrder({
      symbol: "EURUSD",
      assetType: "FOREX",
    });
    const quoteProvider = quoteAt("100");

    const summary = await processPendingOrders({
      quoteProvider,
      portfolioId,
    });

    expect(summary).toMatchObject({ scanned: 1, rejected: 1, executed: 0 });
    expect(quoteProvider.getQuote).not.toHaveBeenCalled();

    const storedOrder = await prisma.order.findUnique({
      where: { id: order.id },
    });
    expect(storedOrder.status).toBe("REJECTED");
  });

  test("rejects an order immediately when the provider reports a permanent error", async () => {
    const order = await createOrder();
    const permanentError = Object.assign(new Error("unsupported symbol"), {
      statusCode: 404,
      code: "MARKET_DATA_NOT_FOUND",
    });
    const quoteProvider = {
      getQuote: jest.fn(async () => {
        throw permanentError;
      }),
    };

    const summary = await processPendingOrders({
      quoteProvider,
      portfolioId,
      maxAttempts: 5,
    });

    expect(summary).toMatchObject({ scanned: 1, rejected: 1, failed: 0 });

    const storedOrder = await prisma.order.findUnique({
      where: { id: order.id },
    });
    expect(storedOrder.status).toBe("REJECTED");
  });

  test("counts a transient provider failure and keeps the order pending below the retry limit", async () => {
    const order = await createOrder();
    const quoteProvider = {
      getQuote: jest.fn(async () => {
        throw new Error("provider unavailable");
      }),
    };

    const summary = await processPendingOrders({
      quoteProvider,
      portfolioId,
      maxAttempts: 3,
    });

    expect(summary).toMatchObject({ scanned: 1, failed: 1, rejected: 0 });

    const storedOrder = await prisma.order.findUnique({
      where: { id: order.id },
    });
    expect(storedOrder.status).toBe("PENDING");
    expect(storedOrder.executionAttempts).toBe(1);
    expect(storedOrder.lastExecutionAttemptAt).toBeInstanceOf(Date);
  });

  test("rejects an order after the maximum number of transient failures", async () => {
    const order = await createOrder();
    const quoteProvider = {
      getQuote: jest.fn(async () => {
        throw new Error("provider unavailable");
      }),
    };

    await processPendingOrders({
      quoteProvider,
      portfolioId,
      maxAttempts: 2,
    });
    const summary = await processPendingOrders({
      quoteProvider,
      portfolioId,
      maxAttempts: 2,
    });

    expect(summary).toMatchObject({ scanned: 1, rejected: 1, failed: 0 });

    const storedOrder = await prisma.order.findUnique({
      where: { id: order.id },
    });
    expect(storedOrder.status).toBe("REJECTED");
    expect(storedOrder.executionAttempts).toBe(2);
  });

  test("a permanently failing order cannot starve newer valid orders", async () => {
    // `limit: 1` forces the worker to see only the oldest pending order on
    // each pass, which is exactly how a poisoned order used to monopolise the
    // queue. Once the retry budget is spent it must leave the queue so the
    // newer order can execute.
    const failingOrder = await createOrder({
      symbol: "FAIL",
      createdAt: new Date(Date.now() - 10_000),
    });
    const validOrder = await createOrder({
      createdAt: new Date(Date.now() - 1_000),
    });

    const quoteProvider = {
      getQuote: jest.fn(async (symbol) => {
        if (symbol === "FAIL") {
          throw new Error("provider unavailable");
        }

        return { symbol, assetClass: "STOCK", price: "100" };
      }),
    };

    const first = await processPendingOrders({
      quoteProvider,
      portfolioId,
      limit: 1,
      maxAttempts: 2,
    });
    const second = await processPendingOrders({
      quoteProvider,
      portfolioId,
      limit: 1,
      maxAttempts: 2,
    });
    const third = await processPendingOrders({
      quoteProvider,
      portfolioId,
      limit: 1,
      maxAttempts: 2,
    });

    expect(first).toMatchObject({ scanned: 1, failed: 1 });
    expect(second).toMatchObject({ scanned: 1, rejected: 1 });
    expect(third).toMatchObject({ scanned: 1, executed: 1 });

    const [storedFailing, storedValid] = await Promise.all([
      prisma.order.findUnique({ where: { id: failingOrder.id } }),
      prisma.order.findUnique({ where: { id: validOrder.id } }),
    ]);

    expect(storedFailing.status).toBe("REJECTED");
    expect(storedValid.status).toBe("EXECUTED");
  });
});
