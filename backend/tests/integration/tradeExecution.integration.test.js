const { Prisma } = require("@prisma/client");

const prisma = require("../../src/config/database");
const orderService = require("../../src/services/orderService");
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
    data: {
      cashBalance,
      reservedCash: "0",
      isActive: true,
    },
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
      reservedCash: "0",
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

  test("consumes the order reservation and releases unused reserved cash", async () => {
    await prisma.portfolio.update({
      where: { id: portfolioId },
      data: {
        cashBalance: "10000",
        reservedCash: "500",
      },
    });

    const order = await createOrder({
      quantity: "2",
      reservedCash: "500",
    });

    await tradeService.executeOrder(order, "100");

    const [storedOrder, portfolio] = await Promise.all([
      prisma.order.findUnique({ where: { id: order.id } }),
      prisma.portfolio.findUnique({ where: { id: portfolioId } }),
    ]);

    expect(storedOrder.status).toBe("EXECUTED");
    expect(storedOrder.reservedCash.toString()).toBe("0");
    expect(portfolio.cashBalance.toString()).toBe("9800");
    expect(portfolio.reservedCash.toString()).toBe("0");
  });

  test("rejects execution when the price increase exceeds unreserved cash", async () => {
    await prisma.portfolio.update({
      where: { id: portfolioId },
      data: {
        cashBalance: "1000",
        reservedCash: "700",
      },
    });

    const order = await createOrder({
      quantity: "10",
      reservedCash: "500",
    });

    await expect(tradeService.executeOrder(order, "100")).rejects.toMatchObject(
      {
        code: "INSUFFICIENT_BALANCE",
      },
    );

    const [storedOrder, portfolio, tradeCount, holdingCount] =
      await Promise.all([
        prisma.order.findUnique({ where: { id: order.id } }),
        prisma.portfolio.findUnique({ where: { id: portfolioId } }),
        prisma.trade.count({ where: { portfolioId } }),
        prisma.holding.count({ where: { portfolioId } }),
      ]);

    expect(storedOrder.status).toBe("PENDING");
    expect(storedOrder.reservedCash.toString()).toBe("500");
    expect(portfolio.cashBalance.toString()).toBe("1000");
    expect(portfolio.reservedCash.toString()).toBe("700");
    expect(tradeCount).toBe(0);
    expect(holdingCount).toBe(0);
  });

  test("supports an older pending BUY order with no reservation", async () => {
    const order = await createOrder({
      quantity: "2",
      reservedCash: "0",
    });

    await tradeService.executeOrder(order, "100");

    const [storedOrder, portfolio] = await Promise.all([
      prisma.order.findUnique({ where: { id: order.id } }),
      prisma.portfolio.findUnique({ where: { id: portfolioId } }),
    ]);

    expect(storedOrder.status).toBe("EXECUTED");
    expect(storedOrder.reservedCash.toString()).toBe("0");
    expect(portfolio.cashBalance.toString()).toBe("9800");
    expect(portfolio.reservedCash.toString()).toBe("0");
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

describe("executeOrder: cost-basis precision", () => {
  test("a full close removes the exact invested amount despite a rounded average price", async () => {
    // 3.02 / 3 = 1.00666666..., stored as 1.00666667 at Decimal(18,8).
    // Multiplying the stored average back by 3 would subtract 3.02000001.
    await createHolding({
      quantity: "3",
      averageBuyPrice: "1.00666667",
      totalInvested: "3.02",
    });
    await resetPortfolioCash("0");

    const order = await createOrder({ side: "SELL", quantity: "3" });
    const trade = await tradeService.executeOrder(order, "1.5");

    const [holding, portfolio] = await Promise.all([
      prisma.holding.findUnique({
        where: { portfolioId_symbol: { portfolioId, symbol: "AAPL" } },
      }),
      prisma.portfolio.findUnique({ where: { id: portfolioId } }),
    ]);

    expect(holding.quantity.toString()).toBe("0");
    expect(holding.totalInvested.toString()).toBe("0");
    expect(holding.averageBuyPrice.toString()).toBe("1.00666667");
    expect(portfolio.cashBalance.toString()).toBe("4.5");

    // The trade and the holding must use the same removed cost basis:
    // proceeds (4.5) - realized P&L (1.48) = 3.02.
    expect(trade.totalValue.toString()).toBe("4.5");
    expect(trade.realizedPnl.toString()).toBe("1.48");
    expect(trade.totalValue.minus(trade.realizedPnl).toString()).toBe("3.02");
  });

  test("partial sales followed by a full close remove exactly the original invested amount", async () => {
    await createHolding({
      quantity: "3",
      averageBuyPrice: "1.00666667",
      totalInvested: "3.02",
    });
    await resetPortfolioCash("0");

    const firstOrder = await createOrder({
      side: "SELL",
      quantity: "1",
      createdAt: new Date(Date.now() - 1000),
    });
    const secondOrder = await createOrder({
      side: "SELL",
      quantity: "2",
      createdAt: new Date(),
    });

    const firstTrade = await tradeService.executeOrder(firstOrder, "1.5");

    let holding = await prisma.holding.findUnique({
      where: { portfolioId_symbol: { portfolioId, symbol: "AAPL" } },
    });

    expect(holding.quantity.toString()).toBe("2");
    // 3.02 - round(3.02 * 1 / 3, 8) = 2.01333333.
    expect(holding.totalInvested.toString()).toBe("2.01333333");
    expect(firstTrade.totalValue.toString()).toBe("1.5");
    expect(firstTrade.realizedPnl.toString()).toBe("0.49333333");

    const secondTrade = await tradeService.executeOrder(secondOrder, "1.5");

    holding = await prisma.holding.findUnique({
      where: { portfolioId_symbol: { portfolioId, symbol: "AAPL" } },
    });

    expect(holding.quantity.toString()).toBe("0");
    expect(holding.totalInvested.toString()).toBe("0");
    expect(secondTrade.totalValue.toString()).toBe("3");
    expect(secondTrade.realizedPnl.toString()).toBe("0.98666667");

    // Derive each removed basis from its trade and prove they add back to the
    // original 3.02 with no residual.
    const removedFirst = firstTrade.totalValue.minus(firstTrade.realizedPnl);
    const removedSecond = secondTrade.totalValue.minus(secondTrade.realizedPnl);

    expect(removedFirst.toString()).toBe("1.00666667");
    expect(removedSecond.toString()).toBe("2.01333333");
    expect(removedFirst.plus(removedSecond).toString()).toBe("3.02");

    const proceeds = firstTrade.totalValue.plus(secondTrade.totalValue);
    const realized = firstTrade.realizedPnl.plus(secondTrade.realizedPnl);
    expect(proceeds.minus(realized).toString()).toBe("3.02");
  });

  test("repeated partial sells never leave a negative or residual cost basis", async () => {
    // 10 / 7 = 1.42857142..., stored as 1.42857143. Selling one share at a
    // time must remove exactly 10 in total without ever going negative.
    await createHolding({
      quantity: "7",
      averageBuyPrice: "1.42857143",
      totalInvested: "10",
    });
    await resetPortfolioCash("0");

    let previousTotalInvested = new Prisma.Decimal("10");
    let removedTotal = new Prisma.Decimal(0);

    for (let remaining = 7; remaining > 0; remaining -= 1) {
      const order = await createOrder({ side: "SELL", quantity: "1" });
      const trade = await tradeService.executeOrder(order, "2");

      const holding = await prisma.holding.findUnique({
        where: { portfolioId_symbol: { portfolioId, symbol: "AAPL" } },
      });

      expect(holding.quantity.toString()).toBe(String(remaining - 1));
      expect(holding.totalInvested.gte(0)).toBe(true);

      const removedCostBasis = trade.totalValue.minus(trade.realizedPnl);
      removedTotal = removedTotal.plus(removedCostBasis);

      // The amount removed plus the new remainder is exactly the previous
      // invested amount, at the column's 8 decimal places.
      expect(holding.totalInvested.plus(removedCostBasis).toString()).toBe(
        previousTotalInvested.toString(),
      );

      previousTotalInvested = holding.totalInvested;
    }

    expect(previousTotalInvested.toString()).toBe("0");
    expect(removedTotal.toString()).toBe("10");

    const trades = await prisma.trade.findMany({ where: { portfolioId } });
    expect(trades).toHaveLength(7);
  });
});

describe("executeOrder: concurrent holding updates", () => {
  test("two concurrent BUYs against one holding apply both contributions", async () => {
    // Regression: applyBuy used to calculate absolute totals from a holding
    // read before the transaction's write. Two orders could both read the
    // same snapshot and the last writer silently discarded the other fill.
    await createHolding({
      quantity: "2",
      averageBuyPrice: "100",
      totalInvested: "200",
    });
    await resetPortfolioCash("10000");

    const first = await createOrder({
      quantity: "3",
      createdAt: new Date(Date.now() - 1000),
    });
    const second = await createOrder({
      quantity: "4",
      createdAt: new Date(),
    });

    const results = await Promise.allSettled([
      tradeService.executeOrder(first, "100"),
      tradeService.executeOrder(second, "150"),
    ]);

    expect(results.map((result) => result.status)).toEqual([
      "fulfilled",
      "fulfilled",
    ]);

    const [holding, portfolio, trades] = await Promise.all([
      prisma.holding.findUnique({
        where: { portfolioId_symbol: { portfolioId, symbol: "AAPL" } },
      }),
      prisma.portfolio.findUnique({ where: { id: portfolioId } }),
      prisma.trade.findMany({ where: { portfolioId } }),
    ]);

    // 2 + 3 + 4 shares, 200 + 300 + 600 invested, 10000 - 900 cash.
    expect(holding.quantity.toString()).toBe("9");
    expect(holding.totalInvested.toString()).toBe("1100");
    expect(holding.averageBuyPrice.toNumber()).toBeCloseTo(1100 / 9, 6);
    expect(portfolio.cashBalance.toString()).toBe("9100");
    expect(trades).toHaveLength(2);
    expect(
      trades
        .reduce(
          (total, trade) => total.plus(trade.totalValue),
          new Prisma.Decimal(0),
        )
        .toString(),
    ).toBe("900");
  });

  test("two concurrent BUYs without an existing holding create it once without losing a fill", async () => {
    // The holding row is created by the same statement that merges into an
    // existing row, so the insert race between two first-time buys is covered
    // by the unique (portfolioId, symbol) constraint.
    await resetPortfolioCash("10000");

    const first = await createOrder({
      quantity: "3",
      createdAt: new Date(Date.now() - 1000),
    });
    const second = await createOrder({
      quantity: "4",
      createdAt: new Date(),
    });

    const results = await Promise.allSettled([
      tradeService.executeOrder(first, "100"),
      tradeService.executeOrder(second, "150"),
    ]);

    expect(results.every((result) => result.status === "fulfilled")).toBe(true);

    const [holding, portfolio, trades] = await Promise.all([
      prisma.holding.findUnique({
        where: { portfolioId_symbol: { portfolioId, symbol: "AAPL" } },
      }),
      prisma.portfolio.findUnique({ where: { id: portfolioId } }),
      prisma.trade.findMany({ where: { portfolioId } }),
    ]);

    expect(holding.quantity.toString()).toBe("7");
    expect(holding.totalInvested.toString()).toBe("900");
    expect(holding.averageBuyPrice.toNumber()).toBeCloseTo(900 / 7, 6);
    expect(portfolio.cashBalance.toString()).toBe("9100");
    expect(trades).toHaveLength(2);
  });

  test("two concurrent SELLs apply both fills against the same cost basis", async () => {
    await createHolding({
      quantity: "10",
      averageBuyPrice: "100",
      totalInvested: "1000",
    });
    await resetPortfolioCash("9000");

    const first = await createOrder({
      side: "SELL",
      quantity: "4",
      createdAt: new Date(Date.now() - 1000),
    });
    const second = await createOrder({
      side: "SELL",
      quantity: "4",
      createdAt: new Date(),
    });

    const results = await Promise.allSettled([
      tradeService.executeOrder(first, "120"),
      tradeService.executeOrder(second, "120"),
    ]);

    expect(results.every((result) => result.status === "fulfilled")).toBe(true);

    const [holding, portfolio, trades] = await Promise.all([
      prisma.holding.findUnique({
        where: { portfolioId_symbol: { portfolioId, symbol: "AAPL" } },
      }),
      prisma.portfolio.findUnique({ where: { id: portfolioId } }),
      prisma.trade.findMany({ where: { portfolioId } }),
    ]);

    expect(holding.quantity.toString()).toBe("2");
    expect(holding.totalInvested.toString()).toBe("200");
    expect(holding.averageBuyPrice.toString()).toBe("100");
    expect(portfolio.cashBalance.toString()).toBe("9960");
    expect(trades).toHaveLength(2);

    for (const trade of trades) {
      expect(trade.realizedPnl.toString()).toBe("80");
      expect(trade.realizedPnlPct.toString()).toBe("20");
    }
  });

  test("a concurrent BUY that loses the cash race rolls back its holding contribution", async () => {
    await resetPortfolioCash("500");

    const first = await createOrder({
      quantity: "3",
      createdAt: new Date(Date.now() - 1000),
    });
    const second = await createOrder({
      quantity: "4",
      createdAt: new Date(),
    });

    // 300 + 400 cannot both fit in 500 cash.
    const results = await Promise.allSettled([
      tradeService.executeOrder(first, "100"),
      tradeService.executeOrder(second, "100"),
    ]);

    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toMatchObject({ code: "INSUFFICIENT_BALANCE" });

    const [holding, portfolio, trades] = await Promise.all([
      prisma.holding.findUnique({
        where: { portfolioId_symbol: { portfolioId, symbol: "AAPL" } },
      }),
      prisma.portfolio.findUnique({ where: { id: portfolioId } }),
      prisma.trade.findMany({ where: { portfolioId } }),
    ]);

    // Only the winner's contribution survives: 3 shares / 300 invested with
    // 200 cash left, or 4 shares / 400 invested with 100 cash left.
    expect(trades).toHaveLength(1);
    expect(["3", "4"]).toContain(holding.quantity.toString());
    expect(["300", "400"]).toContain(holding.totalInvested.toString());
    expect(["200", "100"]).toContain(portfolio.cashBalance.toString());
  });

  test("a concurrent BUY and SELL keep quantity, cash, and cost basis consistent", async () => {
    // With different prices the serialization order changes the weighted
    // average, so the assertion allows both valid outcomes while proving that
    // neither fill is lost and every field stays mutually consistent.
    await createHolding({
      quantity: "10",
      averageBuyPrice: "100",
      totalInvested: "1000",
    });
    await resetPortfolioCash("9000");

    const buy = await createOrder({
      quantity: "5",
      createdAt: new Date(Date.now() - 1000),
    });
    const sell = await createOrder({
      side: "SELL",
      quantity: "4",
      createdAt: new Date(),
    });

    const results = await Promise.allSettled([
      tradeService.executeOrder(buy, "200"),
      tradeService.executeOrder(sell, "200"),
    ]);

    expect(results.every((result) => result.status === "fulfilled")).toBe(true);

    const [holding, portfolio, trades] = await Promise.all([
      prisma.holding.findUnique({
        where: { portfolioId_symbol: { portfolioId, symbol: "AAPL" } },
      }),
      prisma.portfolio.findUnique({ where: { id: portfolioId } }),
      prisma.trade.findMany({ where: { portfolioId } }),
    ]);

    expect(holding.quantity.toString()).toBe("11");
    // 9000 - 1000 (buy) + 800 (sell).
    expect(portfolio.cashBalance.toString()).toBe("8800");
    expect(trades).toHaveLength(2);

    const sellTrade = trades.find((trade) => trade.side === "SELL");
    const totalInvested = holding.totalInvested.toNumber();

    // The stored average must always describe the stored cost basis.
    expect(holding.averageBuyPrice.toNumber()).toBeCloseTo(
      totalInvested / 11,
      6,
    );

    // Sell-first: average stays 100 -> 1600 invested, 400 realized P&L.
    // Buy-first: average becomes 133.33.. -> 1466.66.. invested, 266.66.. P&L.
    if (Math.abs(totalInvested - 1600) < 0.001) {
      expect(sellTrade.realizedPnl.toNumber()).toBeCloseTo(400, 6);
    } else {
      expect(totalInvested).toBeCloseTo(1466.66666667, 6);
      expect(sellTrade.realizedPnl.toNumber()).toBeCloseTo(266.66666667, 6);
    }
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
    expect(rejected[0].reason).toMatchObject({
      code: "ORDER_NOT_EXECUTABLE",
    });

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

  test("does not execute an order for a deactivated portfolio", async () => {
    const order = await createOrder({ quantity: "2" });

    await prisma.portfolio.update({
      where: { id: portfolioId },
      data: { isActive: false },
    });

    await expect(tradeService.executeOrder(order, "100")).rejects.toMatchObject(
      {
        code: "ORDER_NOT_EXECUTABLE",
      },
    );

    const [storedOrder, tradeCount, holdingCount, portfolio] =
      await Promise.all([
        prisma.order.findUnique({ where: { id: order.id } }),
        prisma.trade.count({ where: { orderId: order.id } }),
        prisma.holding.count({ where: { portfolioId } }),
        prisma.portfolio.findUnique({ where: { id: portfolioId } }),
      ]);

    expect(storedOrder.status).toBe("PENDING");
    expect(storedOrder.executedPrice).toBeNull();
    expect(storedOrder.executedAt).toBeNull();
    expect(tradeCount).toBe(0);
    expect(holdingCount).toBe(0);
    expect(portfolio.cashBalance.toString()).toBe("10000");
  });
});

describe("order placement: executable asset types", () => {
  test("rejects a FOREX order before it can enter the pending queue", async () => {
    // Market data is only wired for STOCK and CRYPTO. Accepting a FOREX order
    // would leave a permanently unquotable PENDING row in the worker's queue.
    await expect(
      orderService.createOrder({
        userId,
        portfolioId,
        symbol: "EURUSD",
        assetType: "FOREX",
        side: "BUY",
        type: "MARKET",
        quantity: "1",
      }),
    ).rejects.toMatchObject({ code: "UNSUPPORTED_ASSET_TYPE" });

    expect(await prisma.order.count({ where: { portfolioId } })).toBe(0);
  });
});

async function resetPortfolioCash(cashBalance) {
  await prisma.portfolio.update({
    where: { id: portfolioId },
    data: { cashBalance },
  });
}
