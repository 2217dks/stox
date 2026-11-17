const prisma = require("../../src/config/database");
const orderService = require("../../src/services/orderService");
const tradeService = require("../../src/services/tradeService");
const { processPendingOrders } = require("../../src/workers/orderWorker");

// End-to-end coverage for the advanced order lifecycle. The real database and
// the real executeOrder transaction are used; only the market-data provider is
// injected, so no test calls Finnhub or Binance.

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

async function resetPortfolio({ cashBalance = "10000" } = {}) {
  await prisma.notification.deleteMany({ where: { userId } });
  // Order delete cascades trades, order events, and copy-trade executions.
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

async function createHolding({
  symbol = "AAPL",
  quantity = "10",
  averageBuyPrice = "50",
} = {}) {
  const totalInvested = (
    Number(quantity) * Number(averageBuyPrice)
  ).toFixed(8);

  return prisma.holding.create({
    data: {
      portfolioId,
      symbol,
      assetType: "STOCK",
      quantity,
      averageBuyPrice,
      totalInvested,
      isShort: false,
    },
  });
}

function createOrder(overrides = {}) {
  return orderService.createOrder({
    userId,
    portfolioId,
    symbol: "AAPL",
    assetType: "STOCK",
    side: "BUY",
    type: "MARKET",
    quantity: "1",
    ...overrides,
  });
}

async function eventsFor(orderId) {
  return prisma.orderEvent.findMany({
    where: { orderId },
    orderBy: [{ sequence: "asc" }],
  });
}

beforeAll(async () => {
  jest.setTimeout(30000);

  const user = await prisma.user.create({
    data: {
      email: `advanced-orders-${timestamp}@stox.local`,
      name: "Advanced Orders Test User",
      passwordHash: "not-used-by-these-tests",
    },
  });

  userId = user.id;

  const portfolio = await prisma.portfolio.create({
    data: {
      userId,
      name: `Advanced Orders Portfolio ${timestamp}`,
      startingBalance: "10000",
      cashBalance: "10000",
      isDefault: true,
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

describe("take-profit execution", () => {
  test("fills a BUY at or above the trigger and not below it", async () => {
    const order = await createOrder({
      type: "TAKE_PROFIT",
      stopPrice: "120",
      quantity: "2",
    });

    const below = await processPendingOrders({
      quoteProvider: quoteAt("119.99"),
      portfolioId,
    });

    expect(below).toMatchObject({ scanned: 1, executed: 0, skipped: 1 });
    expect(
      (await prisma.order.findUnique({ where: { id: order.id } })).status,
    ).toBe("PENDING");

    const atTrigger = await processPendingOrders({
      quoteProvider: quoteAt("120"),
      portfolioId,
    });

    expect(atTrigger).toMatchObject({ scanned: 1, executed: 1 });

    const [storedOrder, trade, events, portfolio] = await Promise.all([
      prisma.order.findUnique({ where: { id: order.id } }),
      prisma.trade.findUnique({ where: { orderId: order.id } }),
      eventsFor(order.id),
      prisma.portfolio.findUnique({ where: { id: portfolioId } }),
    ]);

    expect(storedOrder.status).toBe("EXECUTED");
    expect(storedOrder.executedPrice.toString()).toBe("120");
    expect(storedOrder.reservedCash.toString()).toBe("0");
    expect(trade.totalValue.toString()).toBe("240");
    expect(portfolio.reservedCash.toString()).toBe("0");
    expect(events.map((event) => event.eventType)).toEqual([
      "CREATED",
      "EXECUTED",
    ]);
    expect(events[1].metadata).toMatchObject({
      executionPrice: "120",
      quantity: "2",
    });
  });

  test("fills a SELL above the trigger and realizes the trade", async () => {
    await createHolding({ quantity: "2", averageBuyPrice: "100" });

    const order = await createOrder({
      type: "TAKE_PROFIT",
      side: "SELL",
      stopPrice: "120",
      quantity: "1",
    });

    const summary = await processPendingOrders({
      quoteProvider: quoteAt("130"),
      portfolioId,
    });

    expect(summary).toMatchObject({ scanned: 1, executed: 1 });

    const [storedOrder, trade, holding, portfolio] = await Promise.all([
      prisma.order.findUnique({ where: { id: order.id } }),
      prisma.trade.findUnique({ where: { orderId: order.id } }),
      prisma.holding.findUnique({
        where: { portfolioId_symbol: { portfolioId, symbol: "AAPL" } },
      }),
      prisma.portfolio.findUnique({ where: { id: portfolioId } }),
    ]);

    expect(storedOrder.status).toBe("EXECUTED");
    expect(storedOrder.executedPrice.toString()).toBe("130");
    expect(trade.side).toBe("SELL");
    expect(trade.realizedPnl.toString()).toBe("30");
    expect(holding.quantity.toString()).toBe("1");
    expect(portfolio.cashBalance.toString()).toBe("10130");
  });
});

describe("stop-loss execution", () => {
  test("fills a SELL at or below the trigger and not above it", async () => {
    await createHolding({ quantity: "3", averageBuyPrice: "100" });

    const order = await createOrder({
      type: "STOP_LOSS",
      side: "SELL",
      stopPrice: "80",
      quantity: "2",
    });

    const above = await processPendingOrders({
      quoteProvider: quoteAt("80.01"),
      portfolioId,
    });

    expect(above).toMatchObject({ scanned: 1, executed: 0, skipped: 1 });

    const atTrigger = await processPendingOrders({
      quoteProvider: quoteAt("80"),
      portfolioId,
    });

    expect(atTrigger).toMatchObject({ scanned: 1, executed: 1 });

    const [storedOrder, holding, events] = await Promise.all([
      prisma.order.findUnique({ where: { id: order.id } }),
      prisma.holding.findUnique({
        where: { portfolioId_symbol: { portfolioId, symbol: "AAPL" } },
      }),
      eventsFor(order.id),
    ]);

    expect(storedOrder.status).toBe("EXECUTED");
    expect(storedOrder.executedPrice.toString()).toBe("80");
    expect(holding.quantity.toString()).toBe("1");
    expect(events[1]).toMatchObject({
      eventType: "EXECUTED",
      previousStatus: "PENDING",
      newStatus: "EXECUTED",
    });
  });

  test("fills at the current price when the market gaps through the trigger", async () => {
    await createHolding({ quantity: "1", averageBuyPrice: "100" });

    const order = await createOrder({
      type: "STOP_LOSS",
      side: "SELL",
      stopPrice: "80",
      quantity: "1",
    });

    const summary = await processPendingOrders({
      quoteProvider: quoteAt("70"),
      portfolioId,
    });

    expect(summary).toMatchObject({ scanned: 1, executed: 1 });

    const storedOrder = await prisma.order.findUnique({
      where: { id: order.id },
    });

    // The trigger decides eligibility; the fill uses the observed market price.
    expect(storedOrder.executedPrice.toString()).toBe("70");
  });
});

describe("limit-order execution", () => {
  test("fills a BUY at or below the limit and not above it", async () => {
    const order = await createOrder({
      type: "LIMIT",
      limitPrice: "100",
      quantity: "2",
    });

    const above = await processPendingOrders({
      quoteProvider: quoteAt("100.01"),
      portfolioId,
    });

    expect(above).toMatchObject({ scanned: 1, executed: 0, skipped: 1 });

    const atLimit = await processPendingOrders({
      quoteProvider: quoteAt("100"),
      portfolioId,
    });

    expect(atLimit).toMatchObject({ scanned: 1, executed: 1 });

    const storedOrder = await prisma.order.findUnique({
      where: { id: order.id },
    });

    expect(storedOrder.executedPrice.toString()).toBe("100");
  });

  test("fills a BUY at the better market price when the market gaps below the limit", async () => {
    const order = await createOrder({
      type: "LIMIT",
      limitPrice: "100",
      quantity: "1",
    });

    const summary = await processPendingOrders({
      quoteProvider: quoteAt("95"),
      portfolioId,
    });

    expect(summary).toMatchObject({ scanned: 1, executed: 1 });

    const storedOrder = await prisma.order.findUnique({
      where: { id: order.id },
    });

    expect(storedOrder.executedPrice.toString()).toBe("95");
  });

  test("fills a SELL at or above the limit and not below it", async () => {
    await createHolding({ quantity: "2", averageBuyPrice: "50" });

    const order = await createOrder({
      type: "LIMIT",
      side: "SELL",
      limitPrice: "120",
      quantity: "1",
    });

    const below = await processPendingOrders({
      quoteProvider: quoteAt("119.99"),
      portfolioId,
    });

    expect(below).toMatchObject({ scanned: 1, executed: 0, skipped: 1 });

    const above = await processPendingOrders({
      quoteProvider: quoteAt("125"),
      portfolioId,
    });

    expect(above).toMatchObject({ scanned: 1, executed: 1 });

    const storedOrder = await prisma.order.findUnique({
      where: { id: order.id },
    });

    expect(storedOrder.executedPrice.toString()).toBe("125");
  });
});

describe("duplicate processing and terminal outcomes", () => {
  test("executes an order exactly once when the worker and a direct call race", async () => {
    const order = await createOrder({
      type: "TAKE_PROFIT",
      stopPrice: "100",
      quantity: "1",
    });

    const first = await processPendingOrders({
      quoteProvider: quoteAt("100"),
      portfolioId,
    });

    expect(first).toMatchObject({ scanned: 1, executed: 1 });

    const second = await processPendingOrders({
      quoteProvider: quoteAt("100"),
      portfolioId,
    });

    expect(second).toMatchObject({ scanned: 0, executed: 0 });

    await expect(
      tradeService.executeOrder(order.id, "100"),
    ).rejects.toMatchObject({ code: "ORDER_NOT_EXECUTABLE" });

    expect(
      await prisma.trade.count({ where: { orderId: order.id } }),
    ).toBe(1);
  });

  test("rejects an unfundable triggered BUY and releases the reservation", async () => {
    const order = await createOrder({
      type: "TAKE_PROFIT",
      stopPrice: "100",
      quantity: "10",
    });

    // The reservation is held, but the portfolio no longer has the cash to
    // settle the fill. The worker must reject rather than retry forever.
    await prisma.portfolio.update({
      where: { id: portfolioId },
      data: { cashBalance: "50" },
    });

    const summary = await processPendingOrders({
      quoteProvider: quoteAt("100"),
      portfolioId,
    });

    expect(summary).toMatchObject({ scanned: 1, rejected: 1, executed: 0 });

    const [storedOrder, portfolio, events] = await Promise.all([
      prisma.order.findUnique({ where: { id: order.id } }),
      prisma.portfolio.findUnique({ where: { id: portfolioId } }),
      eventsFor(order.id),
    ]);

    expect(storedOrder.status).toBe("REJECTED");
    expect(storedOrder.reservedCash.toString()).toBe("0");
    expect(portfolio.reservedCash.toString()).toBe("0");
    expect(events[1]).toMatchObject({
      eventType: "REJECTED",
      previousStatus: "PENDING",
      newStatus: "REJECTED",
    });
    expect(events[1].metadata).toMatchObject({
      reason: "INSUFFICIENT_BALANCE",
    });
  });
});

describe("advanced-order cancellation", () => {
  test.each([
    ["LIMIT", { limitPrice: "90" }],
    ["STOP_LOSS", { stopPrice: "90" }],
    ["TAKE_PROFIT", { stopPrice: "110" }],
  ])(
    "cancels a pending %s BUY, releases the reservation, and prevents execution",
    async (type, pricing) => {
      const order = await createOrder({
        type,
        quantity: "2",
        ...pricing,
      });

      const portfolioBefore = await prisma.portfolio.findUnique({
        where: { id: portfolioId },
      });
      expect(portfolioBefore.reservedCash.gt(0)).toBe(true);

      const cancelled = await orderService.cancelOrder({
        userId,
        orderId: order.id,
      });

      expect(cancelled.status).toBe("CANCELLED");
      expect(cancelled.reservedCash).toBe("0");

      const portfolioAfter = await prisma.portfolio.findUnique({
        where: { id: portfolioId },
      });
      expect(portfolioAfter.reservedCash.toString()).toBe("0");

      const events = await eventsFor(order.id);
      expect(events.map((event) => event.eventType)).toEqual([
        "CREATED",
        "CANCELLED",
      ]);

      // A quote that would have triggered the order must not execute it.
      const summary = await processPendingOrders({
        quoteProvider: quoteAt(type === "TAKE_PROFIT" ? "200" : "50"),
        portfolioId,
      });

      expect(summary).toMatchObject({ scanned: 0, executed: 0 });
      expect(await prisma.trade.count({ where: { orderId: order.id } })).toBe(0);
    },
  );

  test("cancels a pending SELL without touching reserved cash", async () => {
    await createHolding({ quantity: "2", averageBuyPrice: "50" });

    const order = await createOrder({
      type: "LIMIT",
      side: "SELL",
      limitPrice: "200",
      quantity: "1",
    });

    const cancelled = await orderService.cancelOrder({
      userId,
      orderId: order.id,
    });

    expect(cancelled.status).toBe("CANCELLED");

    const portfolio = await prisma.portfolio.findUnique({
      where: { id: portfolioId },
    });
    expect(portfolio.reservedCash.toString()).toBe("0");

    const holding = await prisma.holding.findUnique({
      where: { portfolioId_symbol: { portfolioId, symbol: "AAPL" } },
    });
    expect(holding.quantity.toString()).toBe("2");
  });
});
