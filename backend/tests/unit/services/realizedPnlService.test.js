const { Prisma } = require("@prisma/client");
const {
  calculateRealizedPnl,
  getPortfolioRealizedPnl,
} = require("../../../src/services/realizedPnlService");
const prisma = require("../../../src/config/database");

jest.mock("../../../src/config/database", () => ({
  portfolio: {
    findFirst: jest.fn(),
  },
  trade: {
    findMany: jest.fn(),
  },
}));

describe("Realized P&L Service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("calculateRealizedPnl pure logic", () => {
    test("calculates positive, negative, and breakeven trades preserving exact decimal precision", () => {
      const trades = [
        {
          id: "t1",
          orderId: "o1",
          symbol: "AAPL",
          side: "SELL",
          quantity: new Prisma.Decimal("10.00000000"),
          price: new Prisma.Decimal("150.00000000"),
          totalValue: new Prisma.Decimal("1500.00000000"),
          fees: new Prisma.Decimal("5.00000000"),
          realizedPnl: new Prisma.Decimal("195.00000000"), // proceeds 1500 - cost 1300 - fee 5 = 195
          realizedPnlPct: new Prisma.Decimal("15.0000"),
          executedAt: new Date("2026-11-01T10:00:00Z"),
        },
        {
          id: "t2",
          orderId: "o2",
          symbol: "TSLA",
          side: "SELL",
          quantity: new Prisma.Decimal("5.00000000"),
          price: new Prisma.Decimal("200.00000000"),
          totalValue: new Prisma.Decimal("1000.00000000"),
          fees: new Prisma.Decimal("0.00000000"),
          realizedPnl: new Prisma.Decimal("-200.00000000"), // loss
          realizedPnlPct: new Prisma.Decimal("-16.6667"),
          executedAt: new Date("2026-11-02T10:00:00Z"),
        },
        {
          id: "t3",
          orderId: "o3",
          symbol: "MSFT",
          side: "SELL",
          quantity: new Prisma.Decimal("2.00000000"),
          price: new Prisma.Decimal("300.00000000"),
          totalValue: new Prisma.Decimal("600.00000000"),
          fees: new Prisma.Decimal("0.00000000"),
          realizedPnl: new Prisma.Decimal("0.00000000"), // breakeven
          realizedPnlPct: new Prisma.Decimal("0.0000"),
          executedAt: new Date("2026-11-03T10:00:00Z"),
        },
      ];

      const result = calculateRealizedPnl(trades);

      // Total realized P&L: 195 - 200 + 0 = -5.00000000
      expect(result.realizedPnl).toBe("-5.00000000");
      expect(result.tradeCount).toBe(3);
      expect(result.winningTrades).toBe(1);
      expect(result.losingTrades).toBe(1);
      expect(result.breakevenTrades).toBe(1);
      expect(result.winRate).toBe(0.3333);
      expect(result.totalFees).toBe("5.00000000");
      expect(result.totalProceeds).toBe("3100.00000000");
      // Total cost basis: 1300 + 1200 + 600 = 3100
      expect(result.totalCostBasis).toBe("3100.00000000");
      expect(result.bySymbol).toHaveLength(3);

      const aapl = result.bySymbol.find((s) => s.symbol === "AAPL");
      expect(aapl.realizedPnl).toBe("195.00000000");
      expect(aapl.winningTrades).toBe(1);
      expect(aapl.fees).toBe("5.00000000");
    });

    test("handles partial closes and multiple fills correctly", () => {
      // Scenario: Buy 20 @ 100 ($2,000 invested).
      // Partial close 1: Sell 10 @ 120 = $1,200 proceeds. Proportional cost basis removed = $1,000. Realized PnL = +$200.
      // Partial close 2: Sell 10 @ 90 = $900 proceeds. Cost basis removed = $1,000. Realized PnL = -$100.
      const trades = [
        {
          id: "fill-1",
          orderId: "ord-1",
          symbol: "NVDA",
          side: "SELL",
          quantity: new Prisma.Decimal("10.00000000"),
          price: new Prisma.Decimal("120.00000000"),
          totalValue: new Prisma.Decimal("1200.00000000"),
          fees: new Prisma.Decimal("0.00000000"),
          realizedPnl: new Prisma.Decimal("200.00000000"),
          realizedPnlPct: new Prisma.Decimal("20.0000"),
          executedAt: new Date("2026-11-05T12:00:00Z"),
        },
        {
          id: "fill-2",
          orderId: "ord-2",
          symbol: "NVDA",
          side: "SELL",
          quantity: new Prisma.Decimal("10.00000000"),
          price: new Prisma.Decimal("90.00000000"),
          totalValue: new Prisma.Decimal("900.00000000"),
          fees: new Prisma.Decimal("2.00000000"),
          realizedPnl: new Prisma.Decimal("-102.00000000"),
          realizedPnlPct: new Prisma.Decimal("-10.2000"),
          executedAt: new Date("2026-11-06T12:00:00Z"),
        },
      ];

      const result = calculateRealizedPnl(trades);

      expect(result.realizedPnl).toBe("98.00000000");
      expect(result.totalProceeds).toBe("2100.00000000");
      expect(result.totalFees).toBe("2.00000000");
      expect(result.totalCostBasis).toBe("2000.00000000");
      expect(result.tradeCount).toBe(2);
      expect(result.winningTrades).toBe(1);
      expect(result.losingTrades).toBe(1);
      expect(result.winRate).toBe(0.5);
    });

    test("handles empty trades gracefully with zero metrics", () => {
      const result = calculateRealizedPnl([]);
      expect(result.realizedPnl).toBe("0.00000000");
      expect(result.realizedPnlPct).toBe("0.0000");
      expect(result.totalProceeds).toBe("0.00000000");
      expect(result.totalCostBasis).toBe("0.00000000");
      expect(result.totalFees).toBe("0.00000000");
      expect(result.tradeCount).toBe(0);
      expect(result.winningTrades).toBe(0);
      expect(result.winRate).toBe(0);
      expect(result.trades).toEqual([]);
      expect(result.bySymbol).toEqual([]);
    });
  });

  describe("getPortfolioRealizedPnl service", () => {
    test("throws 404 when portfolio does not belong to user", async () => {
      prisma.portfolio.findFirst.mockResolvedValue(null);

      await expect(
        getPortfolioRealizedPnl("user-1", "port-1", { period: "1M" }),
      ).rejects.toMatchObject({
        statusCode: 404,
        code: "PORTFOLIO_NOT_FOUND",
      });
    });

    test("queries completed trades within period boundaries", async () => {
      prisma.portfolio.findFirst.mockResolvedValue({
        id: "port-1",
        name: "Main Portfolio",
        currency: "USD",
        isActive: true,
      });

      prisma.trade.findMany.mockResolvedValue([
        {
          id: "trade-1",
          orderId: "ord-1",
          symbol: "AAPL",
          side: "SELL",
          quantity: new Prisma.Decimal("5.00000000"),
          price: new Prisma.Decimal("160.00000000"),
          totalValue: new Prisma.Decimal("800.00000000"),
          fees: new Prisma.Decimal("1.00000000"),
          realizedPnl: new Prisma.Decimal("50.00000000"),
          realizedPnlPct: new Prisma.Decimal("6.6756"),
          executedAt: new Date("2026-11-10T14:30:00Z"),
        },
      ]);

      const result = await getPortfolioRealizedPnl("user-1", "port-1", {
        period: "1M",
        asOf: new Date("2026-11-15T00:00:00Z"),
      });

      expect(result.portfolioId).toBe("port-1");
      expect(result.period).toBe("1M");
      expect(result.realizedPnl).toBe("50.00000000");
      expect(result.tradeCount).toBe(1);
      expect(result.winningTrades).toBe(1);
      expect(prisma.trade.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            portfolioId: "port-1",
            realizedPnl: { not: null },
            executedAt: expect.any(Object),
          }),
        }),
      );
    });
  });
});
