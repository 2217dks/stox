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
const { getUserStatistics } = require("../../../src/services/userStatisticsService");

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
