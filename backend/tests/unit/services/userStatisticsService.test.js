const { Prisma } = require("@prisma/client");

jest.mock("../../../src/config/database", () => ({
  portfolio: {
    findFirst: jest.fn(),
  },
  trade: {
    aggregate: jest.fn(),
    count: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
  },
  $queryRaw: jest.fn(),
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

describe("userStatisticsService unit tests", () => {
  const userId = "user-uuid-1111";

  beforeEach(() => {
    jest.clearAllMocks();
    getCurrentUser.mockResolvedValue({ id: userId, isSuspended: false });
  });

  test("returns zeroed statistics shape when user has no trades", async () => {
    prisma.$queryRaw.mockResolvedValue([
      {
        totalTrades: 0,
        winningTrades: 0,
        losingTrades: 0,
        totalVolume: null,
        avgRealizedPnlPct: null,
        bestTrade: null,
        worstTrade: null,
      },
    ]);

    const result = await getUserStatistics(userId);

    expect(getCurrentUser).toHaveBeenCalledWith(userId);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(prisma.trade.aggregate).not.toHaveBeenCalled();
    expect(prisma.trade.count).not.toHaveBeenCalled();
    expect(prisma.trade.findFirst).not.toHaveBeenCalled();
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
    prisma.$queryRaw.mockResolvedValue([
      {
        totalTrades: 5,
        winningTrades: 2,
        losingTrades: 1,
        totalVolume: "5400",
        avgRealizedPnlPct: "5.5",
        bestTrade: {
          symbol: "MSFT",
          realizedPnl: "500",
          realizedPnlPct: "20",
        },
        worstTrade: {
          symbol: "TSLA",
          realizedPnl: "-300",
          realizedPnlPct: "-8",
        },
      },
    ]);

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
    expect(prisma.trade.aggregate).not.toHaveBeenCalled();
    expect(prisma.trade.count).not.toHaveBeenCalled();
    expect(prisma.trade.findFirst).not.toHaveBeenCalled();
  });

  test("scopes queries to the authenticated user's portfolio", async () => {
    prisma.$queryRaw.mockResolvedValue([
      {
        totalTrades: 0,
        winningTrades: 0,
        losingTrades: 0,
        totalVolume: null,
        avgRealizedPnlPct: null,
        bestTrade: null,
        worstTrade: null,
      },
    ]);

    await getUserStatistics(userId);

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    const sqlArg = prisma.$queryRaw.mock.calls[0][0];
    expect(sqlArg.values).toContain(userId);
    expect(sqlArg.text).toContain('p."userId" = $1');
    expect(prisma.trade.aggregate).not.toHaveBeenCalled();
  });

  test("throws PORTFOLIO_NOT_FOUND when portfolioId is not owned by user", async () => {
    prisma.portfolio.findFirst.mockResolvedValue(null);

    await expect(
      getUserStatistics(userId, { portfolioId: "foreign-portfolio-id" }),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: "PORTFOLIO_NOT_FOUND",
      message: "Portfolio not found.",
    });

    expect(prisma.portfolio.findFirst).toHaveBeenCalledWith({
      where: {
        id: "foreign-portfolio-id",
        userId,
      },
      select: { id: true },
    });
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(prisma.trade.aggregate).not.toHaveBeenCalled();
  });

  test("scopes queries to specific portfolio when portfolioId belongs to user", async () => {
    prisma.portfolio.findFirst.mockResolvedValue({ id: "owned-port-id" });
    prisma.$queryRaw.mockResolvedValue([
      {
        totalTrades: 1,
        winningTrades: 1,
        losingTrades: 0,
        totalVolume: "100",
        avgRealizedPnlPct: "10",
        bestTrade: null,
        worstTrade: null,
      },
    ]);

    await getUserStatistics(userId, { portfolioId: "owned-port-id" });

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    const sqlArg = prisma.$queryRaw.mock.calls[0][0];
    expect(sqlArg.values).toContain(userId);
    expect(sqlArg.values).toContain("owned-port-id");
    expect(prisma.trade.aggregate).not.toHaveBeenCalled();
  });

  test("filters aggregate trade count and volume by symbol and side", async () => {
    prisma.$queryRaw.mockResolvedValue([
      {
        totalTrades: 3,
        winningTrades: 2,
        losingTrades: 0,
        totalVolume: "3000",
        avgRealizedPnlPct: "12.5",
        bestTrade: null,
        worstTrade: null,
      },
    ]);

    const result = await getUserStatistics(userId, { symbol: "AAPL", side: "SELL" });

    expect(result.totalTrades).toBe(3);
    expect(result.totalVolume).toBe("3000");
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    const sqlArg = prisma.$queryRaw.mock.calls[0][0];
    expect(sqlArg.values).toContain("AAPL");
    expect(sqlArg.values).toContain("SELL");
    expect(prisma.trade.aggregate).not.toHaveBeenCalled();
  });

  describe("breakeven, null, and edge-case trade histories", () => {
    test("handles user with only BUY trades (all realizedPnl is null)", async () => {
      prisma.$queryRaw.mockResolvedValue([
        {
          totalTrades: 4,
          winningTrades: 0,
          losingTrades: 0,
          totalVolume: "4000",
          avgRealizedPnlPct: null,
          bestTrade: null,
          worstTrade: null,
        },
      ]);

      const result = await getUserStatistics(userId);

      expect(result.totalTrades).toBe(4);
      expect(result.totalVolume).toBe("4000");
      expect(result.winningTrades).toBe(0);
      expect(result.losingTrades).toBe(0);
      expect(result.winRate).toBe(0);
      expect(result.averageReturn).toBeNull();
      expect(result.bestTrade).toBeNull();
      expect(result.worstTrade).toBeNull();
    });

    test("handles user with only breakeven trades (realizedPnl == 0)", async () => {
      prisma.$queryRaw.mockResolvedValue([
        {
          totalTrades: 2,
          winningTrades: 0,
          losingTrades: 0,
          totalVolume: "1000",
          avgRealizedPnlPct: "0",
          bestTrade: {
            symbol: "NVDA",
            realizedPnl: "0",
            realizedPnlPct: "0",
          },
          worstTrade: {
            symbol: "NVDA",
            realizedPnl: "0",
            realizedPnlPct: "0",
          },
        },
      ]);

      const result = await getUserStatistics(userId);

      expect(result.totalTrades).toBe(2);
      expect(result.winningTrades).toBe(0);
      expect(result.losingTrades).toBe(0);
      expect(result.winRate).toBe(0);
      expect(result.averageReturn).toBe("0");
      expect(result.bestTrade?.realizedPnl).toBe("0");
      expect(result.worstTrade?.realizedPnl).toBe("0");
    });

    test("handles 100% win rate (all wins, no losses)", async () => {
      prisma.$queryRaw.mockResolvedValue([
        {
          totalTrades: 3,
          winningTrades: 3,
          losingTrades: 0,
          totalVolume: "3000",
          avgRealizedPnlPct: "15",
          bestTrade: {
            symbol: "AAPL",
            realizedPnl: "300",
            realizedPnlPct: "15",
          },
          worstTrade: {
            symbol: "GOOG",
            realizedPnl: "100",
            realizedPnlPct: "5",
          },
        },
      ]);

      const result = await getUserStatistics(userId);

      expect(result.totalTrades).toBe(3);
      expect(result.winningTrades).toBe(3);
      expect(result.losingTrades).toBe(0);
      expect(result.winRate).toBe(1);
    });

    test("handles 0% win rate when all decided trades are losses", async () => {
      prisma.$queryRaw.mockResolvedValue([
        {
          totalTrades: 2,
          winningTrades: 0,
          losingTrades: 2,
          totalVolume: "2000",
          avgRealizedPnlPct: "-10",
          bestTrade: {
            symbol: "TSLA",
            realizedPnl: "-50",
            realizedPnlPct: "-5",
          },
          worstTrade: {
            symbol: "TSLA",
            realizedPnl: "-150",
            realizedPnlPct: "-15",
          },
        },
      ]);

      const result = await getUserStatistics(userId);

      expect(result.winningTrades).toBe(0);
      expect(result.losingTrades).toBe(2);
      expect(result.winRate).toBe(0);
    });

    test("preserves 8 decimal place high precision values without float distortion", async () => {
      prisma.$queryRaw.mockResolvedValue([
        {
          totalTrades: 1,
          winningTrades: 1,
          losingTrades: 0,
          totalVolume: "12345678.12345678",
          avgRealizedPnlPct: "12.34567891",
          bestTrade: {
            symbol: "BTCUSDT",
            realizedPnl: "98765.43210987",
            realizedPnlPct: "12.34567891",
          },
          worstTrade: null,
        },
      ]);

      const result = await getUserStatistics(userId);

      expect(result.totalVolume).toBe("12345678.12345678");
      expect(result.averageReturn).toBe("12.34567891");
      expect(result.bestTrade?.realizedPnl).toBe("98765.43210987");
      expect(result.bestTrade?.realizedPnlPct).toBe("12.34567891");
    });
  });

  describe("getMonthlyTradeStatistics", () => {
    test("aggregates trades across multiple months and year rollover", async () => {
      prisma.$queryRaw.mockResolvedValue([
        {
          month: "2025-12",
          totalTrades: 1,
          winningTrades: 1,
          losingTrades: 0,
          totalVolume: "1000",
          realizedPnl: "100",
          avgRealizedPnlPct: "10",
        },
        {
          month: "2026-01",
          totalTrades: 2,
          winningTrades: 1,
          losingTrades: 1,
          totalVolume: "5000",
          realizedPnl: "100",
          avgRealizedPnlPct: "1.25",
        },
      ]);

      const { getMonthlyTradeStatistics } = require("../../../src/services/userStatisticsService");
      const monthly = await getMonthlyTradeStatistics(userId);

      expect(monthly).toHaveLength(2);

      // Dec 2025
      expect(monthly[0].month).toBe("2025-12");
      expect(monthly[0].totalTrades).toBe(1);
      expect(monthly[0].winningTrades).toBe(1);
      expect(monthly[0].losingTrades).toBe(0);
      expect(monthly[0].winRate).toBe(1);
      expect(monthly[0].totalVolume).toBe("1000");
      expect(monthly[0].realizedPnl).toBe("100");
      expect(monthly[0].averageReturn).toBe("10.0000");

      // Jan 2026
      expect(monthly[1].month).toBe("2026-01");
      expect(monthly[1].totalTrades).toBe(2);
      expect(monthly[1].winningTrades).toBe(1);
      expect(monthly[1].losingTrades).toBe(1);
      expect(monthly[1].winRate).toBe(0.5);
      expect(monthly[1].totalVolume).toBe("5000");
      expect(monthly[1].realizedPnl).toBe("100");
      expect(monthly[1].averageReturn).toBe("1.2500");
    });
  });
});
