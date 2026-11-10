const { Prisma } = require("@prisma/client");

const prisma = require("../../src/config/database");
const tradeService = require("../../src/services/tradeService");

// Contract tests for the order-execution write path.
//
// These tests treat executeOrder as a black box: they create real rows in the
// local PostgreSQL database, call the service with an execution price, and
// assert the externally visible financial state (order, trade, holding, cash).
// They deliberately do not mock Prisma, so the transaction, conditional status
// transition, Decimal arithmetic, and rollback behavior are all exercised.

const timestamp = Date.now();

let userId;
let portfolioId;

async function resetPortfolio(cashBalance = "10000") {
  await prisma.notification.deleteMany({ where: { userId } });
  await prisma.trade.deleteMany({ where: { portfolioId } });
  await prisma.order.deleteMany({ where: { portfolioId } });
  await prisma.holding.deleteMany({ where: { portfolioId } });
  await prisma.portfolio.update({
    where: { id: portfolioId },
    data: { cashBalance },
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

async function createHolding(overrides = {}) {
  return prisma.holding.create({
    data: {
      portfolioId,
      symbol: "AAPL",
      assetType: "STOCK",
      quantity: "1",
      averageBuyPrice: "100",
      totalInvested: "100",
      ...overrides,
    },
  });
}

beforeAll(async () => {
  jest.setTimeout(30000);

  const user = await prisma.user.create({
    data: {
      email: `trade-execution-${timestamp}@stox.local`,
      name: "Trade Execution Test User",
      passwordHash: "not-used-by-these-tests",
    },
  });

  userId = user.id;

  const portfolio = await prisma.portfolio.create({
    data: {
      userId,
      name: `Execution Portfolio ${timestamp}`,
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

describe("executeOrder: BUY", () => {
  test("executes a pending market order and creates the trade, holding, and cash debit atomically", async () => {
    const order = await createOrder({ quantity: "2" });

    const trade = await tradeService.executeOrder(order, "100");

    const [storedOrder, storedTrade, holding, portfolio] = await Promise.all([
      prisma.order.findUnique({ where: { id: order.id } }),
      prisma.trade.findUnique({ where: { orderId: order.id } }),
      prisma.holding.findUnique({
        where: { portfolioId_symbol: { portfolioId, symbol: "AAPL" } },
      }),
      prisma.portfolio.findUnique({ where: { id: portfolioId } }),
    ]);

    expect(trade.id).toBe(storedTrade.id);
    expect(storedOrder.status).toBe("EXECUTED");
    expect(storedOrder.executedPrice.toString()).toBe("100");
    expect(storedOrder.executedAt).toBeInstanceOf(Date);

    expect(storedTrade).toMatchObject({
      portfolioId,
      symbol: "AAPL",
      assetType: "STOCK",
      side: "BUY",
    });
    expect(storedTrade.quantity.toString()).toBe("2");
    expect(storedTrade.price.toString()).toBe("100");
    expect(storedTrade.totalValue.toString()).toBe("200");
    expect(storedTrade.fees.toString()).toBe("0");
    expect(storedTrade.realizedPnl).toBeNull();
    expect(storedTrade.realizedPnlPct).toBeNull();

    expect(holding.quantity.toString()).toBe("2");
    expect(holding.averageBuyPrice.toString()).toBe("100");
    expect(holding.totalInvested.toString()).toBe("200");
    expect(holding.isShort).toBe(false);

    expect(portfolio.cashBalance.toString()).toBe("9800");

    const notification = await prisma.notification.findFirst({
      where: { userId, type: "ORDER_EXECUTED" },
    });

    expect(notification).toMatchObject({
      userId,
      type: "ORDER_EXECUTED",
      isRead: false,
    });
    expect(notification.data).toMatchObject({
      orderId: order.id,
      tradeId: storedTrade.id,
      symbol: "AAPL",
      side: "BUY",
      quantity: "2",
      price: "100",
      totalValue: "200",
    });
  });

  test("adds to an existing holding using a weighted average buy price", async () => {
    await createHolding({
      quantity: "2",
      averageBuyPrice: "100",
      totalInvested: "200",
    });
    await resetPortfolioCash("9800");

    const order = await createOrder({ quantity: "2" });

    await tradeService.executeOrder(order, "150");

    const [holding, portfolio] = await Promise.all([
      prisma.holding.findUnique({
        where: { portfolioId_symbol: { portfolioId, symbol: "AAPL" } },
      }),
      prisma.portfolio.findUnique({ where: { id: portfolioId } }),
    ]);

    expect(holding.quantity.toString()).toBe("4");
    expect(holding.totalInvested.toString()).toBe("500");
    expect(holding.averageBuyPrice.toString()).toBe("125");
    expect(portfolio.cashBalance.toString()).toBe("9500");
  });

  test("rejects a buy that would overdraw the portfolio and leaves all state untouched", async () => {
    await resetPortfolio("50");

    const order = await createOrder({ quantity: "1" });

    await expect(tradeService.executeOrder(order, "100")).rejects.toMatchObject(
      {
        code: "INSUFFICIENT_BALANCE",
      },
    );

    const [storedOrder, tradeCount, holdingCount, portfolio] =
      await Promise.all([
        prisma.order.findUnique({ where: { id: order.id } }),
        prisma.trade.count({ where: { portfolioId } }),
        prisma.holding.count({ where: { portfolioId } }),
        prisma.portfolio.findUnique({ where: { id: portfolioId } }),
      ]);

    expect(storedOrder.status).toBe("PENDING");
    expect(storedOrder.executedPrice).toBeNull();
    expect(storedOrder.executedAt).toBeNull();
    expect(tradeCount).toBe(0);
    expect(holdingCount).toBe(0);
    expect(portfolio.cashBalance.toString()).toBe("50");
  });
});

describe("executeOrder: SELL", () => {
  test("partially closes a holding, credits cash, and realizes P&L against average cost", async () => {
    await createHolding({
      quantity: "10",
      averageBuyPrice: "100",
      totalInvested: "1000",
    });
    await resetPortfolioCash("9000");

    const order = await createOrder({
      side: "SELL",
      quantity: "4",
    });

    await tradeService.executeOrder(order, "120");

    const [storedTrade, holding, portfolio] = await Promise.all([
      prisma.trade.findUnique({ where: { orderId: order.id } }),
      prisma.holding.findUnique({
        where: { portfolioId_symbol: { portfolioId, symbol: "AAPL" } },
      }),
      prisma.portfolio.findUnique({ where: { id: portfolioId } }),
    ]);

    expect(storedTrade.quantity.toString()).toBe("4");
    expect(storedTrade.price.toString()).toBe("120");
    expect(storedTrade.totalValue.toString()).toBe("480");
    expect(storedTrade.realizedPnl.toString()).toBe("80");
    expect(storedTrade.realizedPnlPct.toString()).toBe("20");

    expect(holding.quantity.toString()).toBe("6");
    expect(holding.totalInvested.toString()).toBe("600");
    expect(holding.averageBuyPrice.toString()).toBe("100");
    expect(portfolio.cashBalance.toString()).toBe("9480");
  });

  test("rejects a sell larger than the position and leaves all state untouched", async () => {
    await createHolding({
      quantity: "1",
      averageBuyPrice: "100",
      totalInvested: "100",
    });
    await resetPortfolioCash("9900");

    const order = await createOrder({
      side: "SELL",
      quantity: "2",
    });

    await expect(tradeService.executeOrder(order, "120")).rejects.toMatchObject(
      {
        code: "INSUFFICIENT_POSITION",
      },
    );

    const [storedOrder, tradeCount, holding, portfolio] = await Promise.all([
      prisma.order.findUnique({ where: { id: order.id } }),
      prisma.trade.count({ where: { portfolioId } }),
      prisma.holding.findUnique({
        where: { portfolioId_symbol: { portfolioId, symbol: "AAPL" } },
      }),
      prisma.portfolio.findUnique({ where: { id: portfolioId } }),
    ]);

    expect(storedOrder.status).toBe("PENDING");
    expect(tradeCount).toBe(0);
    expect(holding.quantity.toString()).toBe("1");
    expect(holding.totalInvested.toString()).toBe("100");
    expect(portfolio.cashBalance.toString()).toBe("9900");
  });

  test("leaves a zero-quantity holding after a full close", async () => {
    await createHolding({
      quantity: "3",
      averageBuyPrice: "100",
      totalInvested: "300",
    });
    await resetPortfolioCash("9700");

    const order = await createOrder({
      side: "SELL",
      quantity: "3",
    });

    await tradeService.executeOrder(order, "110");

    const holding = await prisma.holding.findUnique({
      where: { portfolioId_symbol: { portfolioId, symbol: "AAPL" } },
    });

    expect(holding.quantity.toString()).toBe("0");
    expect(holding.totalInvested.toString()).toBe("0");
    expect(holding.averageBuyPrice.toString()).toBe("100");
  });
});

describe("executeOrder: state transition safety", () => {
  test("rejects an order that is not pending and never creates a second trade", async () => {
    const order = await createOrder({ status: "CANCELLED" });

    await expect(tradeService.executeOrder(order, "100")).rejects.toMatchObject(
      {
        code: "ORDER_NOT_EXECUTABLE",
      },
    );

    expect(await prisma.trade.count({ where: { portfolioId } })).toBe(0);

    const portfolio = await prisma.portfolio.findUnique({
      where: { id: portfolioId },
    });
    expect(portfolio.cashBalance.toString()).toBe("10000");
  });

  test("only one of two concurrent executions succeeds and the financial state is applied once", async () => {
    const order = await createOrder({ quantity: "2" });

    const results = await Promise.allSettled([
      tradeService.executeOrder(order, "100"),
      tradeService.executeOrder(order, "100"),
    ]);

    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toMatchObject({ code: "ORDER_NOT_EXECUTABLE" });

    const [storedOrder, trades, holding, portfolio] = await Promise.all([
      prisma.order.findUnique({ where: { id: order.id } }),
      prisma.trade.findMany({ where: { orderId: order.id } }),
      prisma.holding.findUnique({
        where: { portfolioId_symbol: { portfolioId, symbol: "AAPL" } },
      }),
      prisma.portfolio.findUnique({ where: { id: portfolioId } }),
    ]);

    expect(storedOrder.status).toBe("EXECUTED");
    expect(trades).toHaveLength(1);
    expect(holding.quantity.toString()).toBe("2");
    expect(portfolio.cashBalance.toString()).toBe("9800");
  });

  test("rejects a missing order", async () => {
    await expect(
      tradeService.executeOrder("11111111-1111-4111-8111-111111111111", "100"),
    ).rejects.toMatchObject({ code: "ORDER_NOT_FOUND" });
  });

  test("rejects an invalid execution price", async () => {
    const order = await createOrder();

    await expect(tradeService.executeOrder(order, "0")).rejects.toMatchObject({
      code: "INVALID_EXECUTION_PRICE",
    });
  });
});

async function resetPortfolioCash(cashBalance) {
  await prisma.portfolio.update({
    where: { id: portfolioId },
    data: { cashBalance },
  });
}
