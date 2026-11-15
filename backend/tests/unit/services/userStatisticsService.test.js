const { Prisma } = require("@prisma/client");

jest.mock("../../../src/config/database", () => ({
  trade: {
    aggregate: jest.fn(),
    count: jest.fn(),
    findFirst: jest.fn(),
  },
  $disconnect: jest.fn(),
}));

jest.mock("../../../src/services/authService", () => ({
  getCurrentUser: jest.fn(),
}));

const prisma = require("../../../src/config/database");
const { getCurrentUser } = require("../../../src/services/authService");
const {
  getUserStatistics,
  computeWinRate,
  toDecimalString,
  serializeTradeSummary,
  buildTradeFilter,
} = require("../../../src/services/userStatisticsService");

describe("userStatisticsService helper functions", () => {
  describe("toDecimalString", () => {
    test("returns null for null or undefined", () => {
      expect(toDecimalString(null)).toBeNull();
      expect(toDecimalString(undefined)).toBeNull();
    });

    test("converts Decimal or numbers to string", () => {
      expect(toDecimalString(new Prisma.Decimal("123.45"))).toBe("123.45");
      expect(toDecimalString(100)).toBe("100");
    });
  });

  describe("serializeTradeSummary", () => {
    test("returns null for empty trade", () => {
      expect(serializeTradeSummary(null)).toBeNull();
      expect(serializeTradeSummary(undefined)).toBeNull();
    });

    test("serializes trade summary with decimal strings", () => {
      const summary = serializeTradeSummary({
        symbol: "AAPL",
        realizedPnl: new Prisma.Decimal("150.25"),
        realizedPnlPct: new Prisma.Decimal("15.025"),
      });

      expect(summary).toEqual({
        symbol: "AAPL",
        realizedPnl: "150.25",
        realizedPnlPct: "15.025",
      });
    });
  });

  describe("computeWinRate", () => {
    test("returns 0 when there are no decided trades", () => {
      expect(computeWinRate(0, 0)).toBe(0);
    });

    test("computes correct ratio rounded to 4 decimals", () => {
      expect(computeWinRate(2, 1)).toBe(0.6667);
      expect(computeWinRate(3, 0)).toBe(1);
      expect(computeWinRate(0, 5)).toBe(0);
      expect(computeWinRate(1, 1)).toBe(0.5);
    });
  });

  describe("buildTradeFilter", () => {
    const userId = "user-123";

    test("builds basic user portfolio filter", () => {
      const filter = buildTradeFilter(userId);
      expect(filter).toEqual({
        portfolio: { userId },
      });
    });

    test("applies optional filters: portfolioId, symbol, side, from, to", () => {
      const from = new Date("2026-01-01T00:00:00.000Z");
      const to = new Date("2026-02-01T00:00:00.000Z");

      const filter = buildTradeFilter(userId, {
        portfolioId: "port-1",
        symbol: "AAPL",
        side: "BUY",
        from,
        to,
      });

      expect(filter).toEqual({
        portfolio: { userId },
        portfolioId: "port-1",
        symbol: "AAPL",
        side: "BUY",
        executedAt: {
          gte: from,
          lt: to,
        },
      });
    });
  });
});

describe("userStatisticsService unit tests (baseline fixtures)", () => {
  const userId = "user-uuid-1111";

  beforeEach(() => {
    jest.clearAllMocks();
    getCurrentUser.mockResolvedValue({ id: userId, isSuspended: false });
  });

  test("returns zeroed statistics shape when user has no trades", async () => {
    prisma.trade.aggregate.mockResolvedValue({
      _count: 0,
      _sum: { totalValue: null },
      _avg: { realizedPnlPct: null },
    });
    prisma.trade.count
      .mockResolvedValueOnce(0) // winningTrades
      .mockResolvedValueOnce(0); // losingTrades
    prisma.trade.findFirst
      .mockResolvedValueOnce(null) // bestTrade
      .mockResolvedValueOnce(null); // worstTrade

    const result = await getUserStatistics(userId);

    expect(getCurrentUser).toHaveBeenCalledWith(userId);
    expect(result).toEqual({
      totalTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
      winRate: 0,
      totalVolume: "0",
      averageReturn: null,
      bestTrade: null,
      worstTrade: null,
    });
  });

  test("computes statistics correctly for user with winning and losing trades", async () => {
    prisma.trade.aggregate.mockResolvedValue({
      _count: 5,
      _sum: { totalValue: new Prisma.Decimal("5400") },
      _avg: { realizedPnlPct: new Prisma.Decimal("5.5") },
    });
    prisma.trade.count
      .mockResolvedValueOnce(2) // winningTrades
      .mockResolvedValueOnce(1); // losingTrades
    prisma.trade.findFirst
      .mockResolvedValueOnce({
        symbol: "MSFT",
        realizedPnl: new Prisma.Decimal("500"),
        realizedPnlPct: new Prisma.Decimal("20"),
      }) // bestTrade
      .mockResolvedValueOnce({
        symbol: "TSLA",
        realizedPnl: new Prisma.Decimal("-300"),
        realizedPnlPct: new Prisma.Decimal("-8"),
      }); // worstTrade

    const result = await getUserStatistics(userId);

    expect(result.totalTrades).toBe(5);
    expect(result.winningTrades).toBe(2);
    expect(result.losingTrades).toBe(1);
    expect(result.winRate).toBe(0.6667);
    expect(result.totalVolume).toBe("5400");
    expect(result.averageReturn).toBe("5.5");
    expect(result.bestTrade).toEqual({
      symbol: "MSFT",
      realizedPnl: "500",
      realizedPnlPct: "20",
    });
    expect(result.worstTrade).toEqual({
      symbol: "TSLA",
      realizedPnl: "-300",
      realizedPnlPct: "-8",
    });
  });

  test("scopes queries to the authenticated user's portfolio", async () => {
    prisma.trade.aggregate.mockResolvedValue({
      _count: 0,
      _sum: { totalValue: null },
      _avg: { realizedPnlPct: null },
    });
    prisma.trade.count.mockResolvedValue(0);
    prisma.trade.findFirst.mockResolvedValue(null);

    await getUserStatistics(userId);

    const expectedFilter = {
      portfolio: {
        userId,
      },
    };

    expect(prisma.trade.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expectedFilter,
      }),
    );
    expect(prisma.trade.count).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining(expectedFilter),
      }),
    );
  });
});
