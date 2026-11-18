const { Prisma } = require("@prisma/client");
const {
  calculatePositionUnrealizedPnl,
  getPortfolioUnrealizedPnl,
  evaluateHoldingFreshness,
} = require("../../../src/services/unrealizedPnlService");
const prisma = require("../../../src/config/database");

jest.mock("../../../src/config/database", () => ({
  portfolio: {
    findFirst: jest.fn(),
  },
  holding: {
    findMany: jest.fn(),
  },
}));

describe("Unrealized P&L Service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("evaluateHoldingFreshness", () => {
    test("considers quotes within threshold as FRESH", () => {
      const now = new Date("2026-11-18T10:00:00Z");
      const quote = { timestamp: "2026-11-18T09:59:30Z" }; // 30s old

      const result = evaluateHoldingFreshness(quote, "STOCK", { now });
      expect(result.isStale).toBe(false);
      expect(result.freshness).toBe("FRESH");
      expect(result.ageSeconds).toBe(30);
    });

    test("considers quotes exceeding threshold as STALE", () => {
      const now = new Date("2026-11-18T10:00:00Z");
      const quote = { timestamp: "2026-11-18T09:50:00Z" }; // 600s old (threshold is 300s for STOCK)

      const result = evaluateHoldingFreshness(quote, "STOCK", { now });
      expect(result.isStale).toBe(true);
      expect(result.freshness).toBe("STALE");
      expect(result.ageSeconds).toBe(600);
    });

    test("respects custom maxAgeSeconds override", () => {
      const now = new Date("2026-11-18T10:00:00Z");
      const quote = { timestamp: "2026-11-18T09:59:15Z" }; // 45s old

      const result = evaluateHoldingFreshness(quote, "STOCK", { maxAgeSeconds: 30, now });
      expect(result.isStale).toBe(true);
      expect(result.freshness).toBe("STALE");
      expect(result.ageSeconds).toBe(45);
    });
  });

  describe("calculatePositionUnrealizedPnl", () => {
    test("calculates gain on a long position with exact decimal precision", () => {
      const holding = {
        id: "h1",
        symbol: "AAPL",
        assetType: "STOCK",
        isShort: false,
        quantity: "10.00000000",
        averageBuyPrice: "150.00000000",
        totalInvested: "1500.00000000",
      };

      const quote = {
        price: "165.50000000",
        timestamp: new Date().toISOString(),
      };

      const result = calculatePositionUnrealizedPnl(holding, quote);

      expect(result.symbol).toBe("AAPL");
      expect(result.marketValue).toBe("1655.00000000");
      expect(result.unrealizedPnl).toBe("155.00000000");
      expect(result.unrealizedPnlPct).toBe("10.3333");
      expect(result.isStale).toBe(false);
      expect(result.freshness).toBe("FRESH");
    });

    test("calculates loss on a long position", () => {
      const holding = {
        id: "h2",
        symbol: "GOOGL",
        assetType: "STOCK",
        isShort: false,
        quantity: "5.00000000",
        averageBuyPrice: "200.00000000",
        totalInvested: "1000.00000000",
      };

      const quote = {
        price: "180.00000000",
        timestamp: new Date().toISOString(),
      };

      const result = calculatePositionUnrealizedPnl(holding, quote);

      expect(result.marketValue).toBe("900.00000000");
      expect(result.unrealizedPnl).toBe("-100.00000000");
      expect(result.unrealizedPnlPct).toBe("-10.0000");
    });

    test("calculates gain on a short position when price drops", () => {
      const holding = {
        id: "h3",
        symbol: "TSLA",
        assetType: "STOCK",
        isShort: true,
        quantity: "10.00000000",
        averageBuyPrice: "250.00000000",
        totalInvested: "2500.00000000",
      };

      const quote = {
        price: "220.00000000",
        timestamp: new Date().toISOString(),
      };

      const result = calculatePositionUnrealizedPnl(holding, quote);

      expect(result.marketValue).toBe("2200.00000000");
      // Short gain: invested 2500 - current value 2200 = +300
      expect(result.unrealizedPnl).toBe("300.00000000");
      expect(result.unrealizedPnlPct).toBe("12.0000");
    });

    test("throws 503 MARKET_DATA_PROVIDER_UNAVAILABLE on missing or null quote", () => {
      const holding = {
        id: "h4",
        symbol: "MSFT",
        assetType: "STOCK",
        quantity: "1.00000000",
        averageBuyPrice: "300.00000000",
        totalInvested: "300.00000000",
      };

      expect(() => calculatePositionUnrealizedPnl(holding, null)).toThrow(
        expect.objectContaining({
          statusCode: 503,
          code: "MARKET_DATA_PROVIDER_UNAVAILABLE",
        }),
      );

      expect(() => calculatePositionUnrealizedPnl(holding, { price: null })).toThrow(
        expect.objectContaining({
          statusCode: 503,
          code: "MARKET_DATA_PROVIDER_UNAVAILABLE",
        }),
      );
    });

    test("throws 503 MARKET_DATA_STALE_QUOTE when rejectStale is true and price is stale", () => {
      const holding = {
        id: "h5",
        symbol: "BTCUSDT",
        assetType: "CRYPTO",
        quantity: "1.00000000",
        averageBuyPrice: "60000.00000000",
        totalInvested: "60000.00000000",
      };

      const oldTimestamp = new Date(Date.now() - 300000).toISOString(); // 5 min old (threshold is 60s)
      const quote = {
        price: "65000.00000000",
        timestamp: oldTimestamp,
      };

      expect(() =>
        calculatePositionUnrealizedPnl(holding, quote, { rejectStale: true }),
      ).toThrow(
        expect.objectContaining({
          statusCode: 503,
          code: "MARKET_DATA_STALE_QUOTE",
        }),
      );
    });
  });

  describe("getPortfolioUnrealizedPnl service", () => {
    test("handles portfolio with no open holdings", async () => {
      prisma.portfolio.findFirst.mockResolvedValue({
        id: "port-1",
        userId: "user-1",
      });
      prisma.holding.findMany.mockResolvedValue([]);

      const result = await getPortfolioUnrealizedPnl("user-1", "port-1");

      expect(result.portfolioId).toBe("port-1");
      expect(result.positionCount).toBe(0);
      expect(result.unrealizedPnl).toBe("0.00000000");
      expect(result.positions).toEqual([]);
    });

    test("aggregates positions with overall unrealized P&L and staleness indicators", async () => {
      prisma.portfolio.findFirst.mockResolvedValue({
        id: "port-1",
        userId: "user-1",
      });
      prisma.holding.findMany.mockResolvedValue([
        {
          id: "h1",
          symbol: "AAPL",
          assetType: "STOCK",
          quantity: new Prisma.Decimal("10.00000000"),
          averageBuyPrice: new Prisma.Decimal("150.00000000"),
          totalInvested: new Prisma.Decimal("1500.00000000"),
          isShort: false,
        },
        {
          id: "h2",
          symbol: "NVDA",
          assetType: "STOCK",
          quantity: new Prisma.Decimal("5.00000000"),
          averageBuyPrice: new Prisma.Decimal("100.00000000"),
          totalInvested: new Prisma.Decimal("500.00000000"),
          isShort: false,
        },
      ]);

      const mockProvider = {
        getQuote: jest.fn().mockImplementation(async (symbol) => {
          if (symbol === "AAPL") {
            return { price: "160.00000000", timestamp: new Date().toISOString() };
          }
          return { price: "90.00000000", timestamp: new Date().toISOString() };
        }),
      };

      const result = await getPortfolioUnrealizedPnl("user-1", "port-1", {
        priceProvider: mockProvider,
      });

      // AAPL: value 1600, invested 1500, pnl +100
      // NVDA: value 450, invested 500, pnl -50
      // Total: invested 2000, value 2050, pnl +50
      expect(result.totalInvested).toBe("2000.00000000");
      expect(result.marketValue).toBe("2050.00000000");
      expect(result.unrealizedPnl).toBe("50.00000000");
      expect(result.unrealizedPnlPct).toBe("2.5000");
      expect(result.positionCount).toBe(2);
      expect(result.isStale).toBe(false);
      expect(result.freshness).toBe("FRESH");
    });
  });
});
