const { Prisma } = require("@prisma/client");

const prisma = require("../../src/config/database");
const orderService = require("../../src/services/orderService");
const marketDataService = require("../../src/services/marketData");
const {
  fanOutCopyTrades,
  scanUnprocessedCopyTrades,
} = require("../../src/services/copyTradeService");

// End-to-end copy-trade fan-out. The source trade and the follower orders are
// real database rows; only the market-data quote used by order placement is
// mocked, so no test calls Finnhub or Binance.

const timestamp = Date.now();

let sourceUser;
let sourcePortfolioId;

let copierA;
let copierAPortfolioId;
let copierASecondPortfolioId;

let copierB;
let copierBPortfolioId;

let quoteSpy;

async function createUserWithPortfolios(label) {
  const user = await prisma.user.create({
    data: {
      email: `copy-exec-${label}-${timestamp}@stox.local`,
      name: `Copy Exec ${label}`,
      passwordHash: "not-used-by-these-tests",
    },
  });

  const portfolio = await prisma.portfolio.create({
    data: {
      userId: user.id,
      name: `Copy Exec ${label} Main ${timestamp}`,
      startingBalance: "10000",
      cashBalance: "10000",
      isDefault: true,
    },
  });

  return { user, portfolio };
}

async function resetData() {
  const portfolioIds = [
    sourcePortfolioId,
    copierAPortfolioId,
    copierASecondPortfolioId,
    copierBPortfolioId,
  ];

  await prisma.notification.deleteMany({
    where: {
      userId: { in: [sourceUser.id, copierA.id, copierB.id] },
    },
  });

  // Order delete cascades trades, events, and copy-trade executions.
  await prisma.order.deleteMany({
    where: { portfolioId: { in: portfolioIds } },
  });

  await prisma.copyTrader.deleteMany({
    where: { copierId: { in: [copierA.id, copierB.id] } },
  });

  await prisma.holding.deleteMany({
    where: { portfolioId: { in: portfolioIds } },
  });

  await prisma.portfolio.updateMany({
    where: { id: { in: portfolioIds } },
    data: { cashBalance: "10000", reservedCash: "0", isActive: true },
  });
}

async function createSourceTrade({
  side = "BUY",
  quantity = "10",
  price = "100",
  source = "MANUAL",
} = {}) {
  const order = await prisma.order.create({
    data: {
      portfolioId: sourcePortfolioId,
      symbol: "AAPL",
      assetType: "STOCK",
      side,
      type: "MARKET",
      status: "EXECUTED",
      quantity,
      reservedCash: "0",
      executedPrice: price,
      executedAt: new Date(),
      source,
    },
  });

  return prisma.trade.create({
    data: {
      portfolioId: sourcePortfolioId,
      orderId: order.id,
      symbol: "AAPL",
      assetType: "STOCK",
      side,
      quantity,
      price,
      totalValue: new Prisma.Decimal(quantity).times(price),
      fees: new Prisma.Decimal(0),
      executedAt: new Date(),
    },
  });
}

function createConfig({
  copierId,
  copyPortfolioId,
  allocationPct = "100",
  maxTradeSize = null,
  isActive = true,
}) {
  return prisma.copyTrader.create({
    data: {
      copierId,
      copiedId: sourceUser.id,
      copyPortfolioId,
      allocationPct,
      maxTradeSize,
      isActive,
    },
  });
}

async function executionsFor(tradeId) {
  return prisma.copyTradeExecution.findMany({
    where: { sourceTradeId: tradeId },
    include: { order: true },
    orderBy: { createdAt: "asc" },
  });
}

beforeAll(async () => {
  jest.setTimeout(30000);

  quoteSpy = jest
    .spyOn(marketDataService, "getQuote")
    .mockResolvedValue({ price: "100" });

  const source = await createUserWithPortfolios("source");
  sourceUser = source.user;
  sourcePortfolioId = source.portfolio.id;

  const a = await createUserWithPortfolios("a");
  copierA = a.user;
  copierAPortfolioId = a.portfolio.id;

  const aSecond = await prisma.portfolio.create({
    data: {
      userId: copierA.id,
      name: `Copy Exec A Second ${timestamp}`,
      startingBalance: "10000",
      cashBalance: "10000",
    },
  });
  copierASecondPortfolioId = aSecond.id;

  const b = await createUserWithPortfolios("b");
  copierB = b.user;
  copierBPortfolioId = b.portfolio.id;
});

beforeEach(async () => {
  await resetData();
});

afterAll(async () => {
  quoteSpy?.mockRestore();

  await prisma.user.deleteMany({
    where: { id: { in: [sourceUser.id, copierA.id, copierB.id] } },
  });

  await prisma.$disconnect();
});

describe("fanOutCopyTrades sizing and destination", () => {
  test("copies the source quantity scaled by allocationPct into the configured portfolio", async () => {
    const trade = await createSourceTrade({ quantity: "10", price: "100" });

    const config = await createConfig({
      copierId: copierA.id,
      copyPortfolioId: copierASecondPortfolioId,
      allocationPct: "25",
    });

    const result = await fanOutCopyTrades({ tradeId: trade.id });

    expect(result).toMatchObject({
      sourceTradeId: trade.id,
      eligible: 1,
      placed: 1,
      failed: 0,
      skipped: 0,
      retryable: 0,
    });

    const [execution] = await executionsFor(trade.id);

    expect(execution).toMatchObject({
      copierId: copierA.id,
      copyTraderId: config.id,
      status: "PLACED",
    });
    expect(execution.order).toMatchObject({
      portfolioId: copierASecondPortfolioId,
      symbol: "AAPL",
      assetType: "STOCK",
      side: "BUY",
      type: "MARKET",
      source: "COPY_TRADE",
      status: "PENDING",
    });
    expect(execution.order.quantity.toString()).toBe("2.5");
    expect(execution.order.copyTradeExecutionId).toBe(execution.id);
  });

  test("caps the copied quantity by maxTradeSize as a notional value", async () => {
    const trade = await createSourceTrade({ quantity: "10", price: "100" });

    await createConfig({
      copierId: copierA.id,
      copyPortfolioId: copierAPortfolioId,
      allocationPct: "100",
      maxTradeSize: "250",
    });

    await fanOutCopyTrades({ tradeId: trade.id });

    const [execution] = await executionsFor(trade.id);

    // 250 / 100 = 2.5 units, below the 10-unit mirrored quantity.
    expect(execution.order.quantity.toString()).toBe("2.5");
    expect(
      execution.order.quantity
        .times(execution.order.limitPrice ?? new Prisma.Decimal("100"))
        .lte(250),
    ).toBe(true);
  });

  test("rounds the copied quantity down to the column scale", async () => {
    const trade = await createSourceTrade({ quantity: "1", price: "3" });

    await createConfig({
      copierId: copierA.id,
      copyPortfolioId: copierAPortfolioId,
      allocationPct: "100",
      maxTradeSize: "1",
    });

    await fanOutCopyTrades({ tradeId: trade.id });

    const [execution] = await executionsFor(trade.id);

    expect(execution.order.quantity.toString()).toBe("0.33333333");
  });

  test("uses the copier's default active portfolio when no destination is stored", async () => {
    const trade = await createSourceTrade();

    await createConfig({
      copierId: copierA.id,
      copyPortfolioId: null,
    });

    await fanOutCopyTrades({ tradeId: trade.id });

    const [execution] = await executionsFor(trade.id);
    expect(execution.order.portfolioId).toBe(copierAPortfolioId);
  });

  test("skips a copied quantity that rounds down to zero", async () => {
    const trade = await createSourceTrade({ quantity: "1", price: "100" });

    await createConfig({
      copierId: copierA.id,
      copyPortfolioId: copierAPortfolioId,
      allocationPct: "100",
      maxTradeSize: "0.00000001",
    });

    const result = await fanOutCopyTrades({ tradeId: trade.id });

    expect(result).toMatchObject({ placed: 0, skipped: 1, failed: 0 });

    const [execution] = await executionsFor(trade.id);
    expect(execution.status).toBe("SKIPPED");
    expect(execution.order).toBeNull();
    expect(execution.failureCode).toBe("ZERO_COPY_QUANTITY");
  });

  test("mirrors a SELL as a market order", async () => {
    const trade = await createSourceTrade({
      side: "SELL",
      quantity: "4",
      price: "100",
    });

    await createConfig({
      copierId: copierA.id,
      copyPortfolioId: copierAPortfolioId,
      allocationPct: "50",
    });

    await fanOutCopyTrades({ tradeId: trade.id });

    const [execution] = await executionsFor(trade.id);
    expect(execution.order).toMatchObject({
      side: "SELL",
      type: "MARKET",
      source: "COPY_TRADE",
    });
    expect(execution.order.quantity.toString()).toBe("2");
  });
});

describe("fanOutCopyTrades eligibility and isolation", () => {
  test("does nothing when there are no active followers", async () => {
    const trade = await createSourceTrade();

    await createConfig({
      copierId: copierA.id,
      copyPortfolioId: copierAPortfolioId,
      isActive: false,
    });

    const result = await fanOutCopyTrades({ tradeId: trade.id });

    expect(result).toMatchObject({
      eligible: 0,
      placed: 0,
      failed: 0,
      skipped: 0,
    });
    expect(await executionsFor(trade.id)).toHaveLength(0);
    expect(
      await prisma.order.count({
        where: { portfolioId: copierAPortfolioId, source: "COPY_TRADE" },
      }),
    ).toBe(0);
  });

  test("does not re-copy a trade whose source order is already a copy trade", async () => {
    const trade = await createSourceTrade({ source: "COPY_TRADE" });

    await createConfig({
      copierId: copierA.id,
      copyPortfolioId: copierAPortfolioId,
    });

    const result = await fanOutCopyTrades({ tradeId: trade.id });

    expect(result).toMatchObject({ placed: 0, skipped: 1 });
    expect(result.reason).toBe("COPY_TRADE_SOURCE");
    expect(await executionsFor(trade.id)).toHaveLength(0);
  });

  test("isolates a follower whose order cannot be funded", async () => {
    const trade = await createSourceTrade({ quantity: "10", price: "100" });

    await createConfig({
      copierId: copierA.id,
      copyPortfolioId: copierAPortfolioId,
    });
    await createConfig({
      copierId: copierB.id,
      copyPortfolioId: copierBPortfolioId,
    });

    await prisma.portfolio.update({
      where: { id: copierBPortfolioId },
      data: { cashBalance: "0" },
    });

    const result = await fanOutCopyTrades({ tradeId: trade.id });

    expect(result).toMatchObject({
      eligible: 2,
      placed: 1,
      failed: 1,
      skipped: 0,
    });

    const executions = await executionsFor(trade.id);
    const byCopier = new Map(
      executions.map((execution) => [execution.copierId, execution]),
    );

    expect(byCopier.get(copierA.id).status).toBe("PLACED");
    expect(byCopier.get(copierA.id).order).not.toBeNull();

    expect(byCopier.get(copierB.id).status).toBe("FAILED");
    expect(byCopier.get(copierB.id).order).toBeNull();
    expect(byCopier.get(copierB.id).failureCode).toBe("INSUFFICIENT_BALANCE");
  });

  test("marks a follower with an inactive destination portfolio as failed", async () => {
    const trade = await createSourceTrade({ quantity: "1", price: "100" });

    await createConfig({
      copierId: copierA.id,
      copyPortfolioId: copierAPortfolioId,
    });
    await createConfig({
      copierId: copierB.id,
      copyPortfolioId: copierBPortfolioId,
    });

    await prisma.portfolio.update({
      where: { id: copierBPortfolioId },
      data: { isActive: false },
    });

    const result = await fanOutCopyTrades({ tradeId: trade.id });

    expect(result).toMatchObject({ placed: 1, failed: 1 });

    const executions = await executionsFor(trade.id);
    const failed = executions.find(
      (execution) => execution.copierId === copierB.id,
    );

    expect(failed.status).toBe("FAILED");
    expect(failed.failureCode).toBe("PORTFOLIO_INACTIVE");
  });
});

describe("fanOutCopyTrades idempotency and retries", () => {
  test("a replayed fan-out never places a second order for the same follower", async () => {
    const trade = await createSourceTrade({ quantity: "2", price: "100" });

    await createConfig({
      copierId: copierA.id,
      copyPortfolioId: copierAPortfolioId,
    });

    const first = await fanOutCopyTrades({ tradeId: trade.id });
    const second = await fanOutCopyTrades({ tradeId: trade.id });

    expect(first).toMatchObject({ placed: 1 });
    expect(second).toMatchObject({ placed: 0, skipped: 1 });

    expect(await executionsFor(trade.id)).toHaveLength(1);
    expect(
      await prisma.order.count({
        where: { portfolioId: copierAPortfolioId, source: "COPY_TRADE" },
      }),
    ).toBe(1);
  });

  test("retries a transient follower failure without duplicating placed followers", async () => {
    const trade = await createSourceTrade({ quantity: "1", price: "100" });

    await createConfig({
      copierId: copierA.id,
      copyPortfolioId: copierAPortfolioId,
    });
    await createConfig({
      copierId: copierB.id,
      copyPortfolioId: copierBPortfolioId,
    });

    const transientOrderService = {
      createOrder: jest.fn(async (payload) => {
        if (payload.portfolioId === copierAPortfolioId) {
          const error = new Error("market data timeout");
          error.code = "MARKET_DATA_TIMEOUT";
          throw error;
        }

        return orderService.createOrder(payload);
      }),
    };

    await expect(
      fanOutCopyTrades({
        tradeId: trade.id,
        orderService: transientOrderService,
        maxAttempts: 3,
      }),
    ).rejects.toMatchObject({ code: "COPY_TRADE_RETRY" });

    let executions = await executionsFor(trade.id);
    const byCopier = new Map(
      executions.map((execution) => [execution.copierId, execution]),
    );

    expect(byCopier.get(copierA.id)).toMatchObject({
      status: "PENDING",
      attempts: 1,
    });
    expect(byCopier.get(copierA.id).order).toBeNull();
    expect(byCopier.get(copierB.id).status).toBe("PLACED");

    // The retry reuses the same execution rows. The placed follower is skipped
    // and the transient follower is attempted again.
    const retry = await fanOutCopyTrades({
      tradeId: trade.id,
      maxAttempts: 3,
    });

    expect(retry).toMatchObject({ placed: 1, skipped: 1, retryable: 0 });

    executions = await executionsFor(trade.id);
    expect(executions).toHaveLength(2);
    expect(
      executions.find((execution) => execution.copierId === copierA.id).status,
    ).toBe("PLACED");
    expect(
      await prisma.order.count({
        where: { portfolioId: copierBPortfolioId, source: "COPY_TRADE" },
      }),
    ).toBe(1);
  });

  test("stops retrying after the attempt budget and records a terminal failure", async () => {
    const trade = await createSourceTrade({ quantity: "1", price: "100" });

    await createConfig({
      copierId: copierA.id,
      copyPortfolioId: copierAPortfolioId,
    });

    const alwaysTransient = {
      createOrder: jest.fn(async () => {
        const error = new Error("market data timeout");
        error.code = "MARKET_DATA_TIMEOUT";
        throw error;
      }),
    };

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        await fanOutCopyTrades({
          tradeId: trade.id,
          orderService: alwaysTransient,
          maxAttempts: 3,
        });
      } catch (error) {
        expect(error.code).toBe("COPY_TRADE_RETRY");
      }
    }

    const [execution] = await executionsFor(trade.id);

    expect(execution.status).toBe("FAILED");
    expect(execution.attempts).toBe(3);
    expect(execution.failureCode).toBe("MAX_ATTEMPTS_EXCEEDED");
    expect(execution.order).toBeNull();
  });

  test("marks a fanned-out trade so the recovery scan does not replay it", async () => {
    const trade = await createSourceTrade({ quantity: "1", price: "100" });

    await createConfig({
      copierId: copierA.id,
      copyPortfolioId: copierAPortfolioId,
    });

    const before = await scanUnprocessedCopyTrades({ limit: 100 });
    expect(before.map((item) => item.id)).toContain(trade.id);

    await fanOutCopyTrades({ tradeId: trade.id });

    const after = await scanUnprocessedCopyTrades({ limit: 100 });
    expect(after.map((item) => item.id)).not.toContain(trade.id);

    const storedTrade = await prisma.trade.findUnique({
      where: { id: trade.id },
    });
    expect(storedTrade.copyFanOutAt).toBeInstanceOf(Date);
  });

  test("marks a trade with no followers as processed so the scan is finite", async () => {
    const trade = await createSourceTrade({ quantity: "1", price: "100" });

    const result = await fanOutCopyTrades({ tradeId: trade.id });
    expect(result).toMatchObject({ eligible: 0, placed: 0 });

    const after = await scanUnprocessedCopyTrades({ limit: 100 });
    expect(after.map((item) => item.id)).not.toContain(trade.id);
  });

  test("returns a terminal no-op when the source trade no longer exists", async () => {
    await expect(
      fanOutCopyTrades({
        tradeId: "00000000-0000-4000-8000-000000000000",
      }),
    ).rejects.toMatchObject({ code: "SOURCE_TRADE_NOT_FOUND" });
  });
});
