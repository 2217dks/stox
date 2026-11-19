jest.mock("../../../src/config/database", () => ({
  league: { findUnique: jest.fn() },
}));

jest.mock("../../../src/services/marketData", () => ({
  getQuote: jest.fn(),
  getHistoricalPrice: jest.fn(),
  getHistoricalPrices: jest.fn(),
}));

const prisma = require("../../../src/config/database");
const marketData = require("../../../src/services/marketData");
const {
  getLeagueLeaderboard,
} = require("../../../src/services/competitionService");

describe("completed league leaderboard", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  test("returns stored ranks even when a suspended member was never ranked", async () => {
    const startDate = new Date("2026-01-01T00:00:00.000Z");
    const endDate = new Date("2026-06-01T00:00:00.000Z");

    prisma.league.findUnique.mockResolvedValue({
      id: "league-1",
      name: "Spring League",
      status: "COMPLETED",
      startDate,
      endDate,
      members: [
        {
          userId: "user-1",
          portfolioId: "portfolio-1",
          rank: 1,
          finalReturn: "12.5",
          joinedAt: startDate,
          user: { name: "Ranked", avatarUrl: null, isSuspended: false },
          portfolio: { trades: [] },
        },
        {
          userId: "user-2",
          portfolioId: "portfolio-2",
          rank: null,
          finalReturn: null,
          joinedAt: startDate,
          user: { name: "Suspended", avatarUrl: null, isSuspended: true },
          portfolio: { trades: [] },
        },
      ],
    });

    const result = await getLeagueLeaderboard({
      leagueId: "league-1",
      now: new Date("2026-11-10T00:00:00.000Z"),
    });

    expect(result.leaderboard).toHaveLength(1);
    expect(result.leaderboard[0].userId).toBe("user-1");
    expect(result.leaderboard[0].rank).toBe(1);
    expect(marketData.getQuote).not.toHaveBeenCalled();
    expect(marketData.getHistoricalPrice).not.toHaveBeenCalled();
  });
});
