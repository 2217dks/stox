jest.mock("../../../src/config/database", () => ({
  $disconnect: jest.fn(),
}));

const { Prisma } = require("@prisma/client");

const { serializeTrade, executeOrder } = require("../../../src/services/tradeService");

// Contract for the trade read API: Decimal columns are serialized as strings
// so precision survives JSON, and nullable realized P&L stays null for buys.
// Zero is a valid realized P&L (a sell at its cost basis) and must stay "0",
// not collapse into null.

function buildTrade(overrides = {}) {
  return {
    id: "trade-1",
    portfolioId: "portfolio-1",
    orderId: "order-1",
    symbol: "AAPL",
    assetType: "STOCK",
    side: "SELL",
    quantity: new Prisma.Decimal("2"),
    price: new Prisma.Decimal("100"),
    totalValue: new Prisma.Decimal("200"),
    fees: new Prisma.Decimal("0"),
    realizedPnl: null,
    realizedPnlPct: null,
    executedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

describe("serializeTrade", () => {
  test("serializes a zero realized P&L as '0' instead of null", () => {
    const serialized = serializeTrade(
      buildTrade({
        realizedPnl: new Prisma.Decimal(0),
        realizedPnlPct: new Prisma.Decimal(0),
      }),
    );

    expect(serialized.realizedPnl).toBe("0");
    expect(serialized.realizedPnlPct).toBe("0");
  });

  test("keeps a buy's missing realized P&L as null", () => {
    const serialized = serializeTrade(buildTrade({ side: "BUY" }));

    expect(serialized.realizedPnl).toBeNull();
    expect(serialized.realizedPnlPct).toBeNull();
  });

  test("serializes decimal fields as strings", () => {
    const serialized = serializeTrade(buildTrade());

    expect(serialized).toMatchObject({
      quantity: "2",
      price: "100",
      totalValue: "200",
      fees: "0",
    });
  });
});

describe("executeOrder fee validation", () => {
  test.each([
    [-1, "negative number"],
    ["-0.01", "negative string"],
    [NaN, "NaN"],
    [Infinity, "Infinity"],
    [-Infinity, "-Infinity"],
    ["invalid", "non-numeric string"],
    [null, "null"],
    [{}, "object"],
  ])("rejects invalid fee %s with INVALID_TRADE_FEE before transaction", async (invalidFee) => {
    await expect(
      executeOrder("order-id", "100", { fees: invalidFee }),
    ).rejects.toMatchObject({
      statusCode: 400,
      code: "INVALID_TRADE_FEE",
      message: "Trade fee must be a non-negative finite number.",
    });
  });
});
