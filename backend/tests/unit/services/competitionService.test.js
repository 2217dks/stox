const { Prisma } = require("@prisma/client");
const {
  getLeagueLeaderboard,
  getEffectiveLeagueStatus,
  syncLeagueStatuses,
} = require("../../../src/services/competitionService");
const prisma = require("../../../src/config/database");

jest.mock("../../../src/config/database", () => ({
  league: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  leagueMember: {
    update: jest.fn(),
  },
  $transaction: jest.fn(),
}));

describe("competitionService - Scoring and Valuation Rules (#128)", () => {
  const leagueId = "11111111-1111-4111-8111-111111111111";
  const startDate = new Date("2026-01-01T00:00:00.000Z");
  const endDate = new Date("2026-01-10T00:00:00.000Z");
  const now = new Date("2026-01-05T00:00:00.000Z");

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("uses actual trade fee (fees) in cash and portfolio calculations with nonzero fees", async () => {
    const portfolioId = "p-1";
    const userId = "u-1";

    const mockLeague = {
      id: leagueId,
      name: "Fee Test League",
      startingBalance: new Prisma.Decimal("10000"),
      startDate,
      endDate,
      status: "ACTIVE",
      members: [
        {
          id: "m-1",
          userId,
          portfolioId,
          joinedAt: new Date("2025-12-31T00:00:00.000Z"),
          user: { id: userId, name: "Fee Trader", avatarUrl: null, isSuspended: false },
          portfolio: {
            trades: [
              // Buy 10 AAPL @ 150 with $15 in fees. Cash = 10000 - 1500 - 15 = 8485.
              {
                symbol: "AAPL",
                assetType: "STOCK",
                side: "BUY",
                quantity: new Prisma.Decimal("10"),
                price: new Prisma.Decimal("150"),
                fees: new Prisma.Decimal("15"),
                executedAt: new Date("2026-01-02T00:00:00.000Z"),
              },
              // Sell 5 AAPL @ 200 with $10 in fees. Cash = 8485 + 1000 - 10 = 9475.
              // Remaining holding: 5 AAPL.
              {
                symbol: "AAPL",
                assetType: "STOCK",
                side: "SELL",
                quantity: new Prisma.Decimal("5"),
                price: new Prisma.Decimal("200"),
                fees: new Prisma.Decimal("10"),
                executedAt: new Date("2026-01-03T00:00:00.000Z"),
              },
            ],
          },
        },
      ],
    };

    prisma.league.findUnique.mockResolvedValue(mockLeague);

    // Current price of AAPL is 200.
    // Holding value = 5 * 200 = 1000.
    // Total value = 9475 + 1000 = 10475.
    // Return % = ((10475 - 10000) / 10000) * 100 = 4.75%.
    // Without fees ($25 total), total value would have been 10500 (+5.00%).
    const mockPriceProvider = {
      getQuote: jest.fn().mockResolvedValue({ symbol: "AAPL", price: "200" }),
    };

    const result = await getLeagueLeaderboard({
      leagueId,
      now,
      priceProvider: mockPriceProvider,
      finalizeIfEnded: false,
    });

    expect(result.leaderboard).toHaveLength(1);
    expect(result.leaderboard[0].totalValue).toBe(10475);
    expect(result.leaderboard[0].returnPct).toBe(4.75);
    expect(result.leaderboard[0].tradeCount).toBe(2);
  });

  test("handles short positions correctly by deducting market liability from total value", async () => {
    const portfolioId = "p-short";
    const userId = "u-short";

    const mockLeague = {
      id: leagueId,
      name: "Short Position League",
      startingBalance: new Prisma.Decimal("10000"),
      startDate,
      endDate,
      status: "ACTIVE",
      members: [
        {
          id: "m-short",
          userId,
          portfolioId,
          joinedAt: new Date("2025-12-31T00:00:00.000Z"),
          user: { id: userId, name: "Short Seller", avatarUrl: null, isSuspended: false },
          portfolio: {
            trades: [
              // Sell 10 TSLA @ 100 with 0 fees. Cash = 10000 + 1000 = 11000.
              // Holding quantity = -10.
              {
                symbol: "TSLA",
                assetType: "STOCK",
                side: "SELL",
                quantity: new Prisma.Decimal("10"),
                price: new Prisma.Decimal("100"),
                fees: new Prisma.Decimal("0"),
                executedAt: new Date("2026-01-02T00:00:00.000Z"),
              },
            ],
          },
        },
      ],
    };

    prisma.league.findUnique.mockResolvedValue(mockLeague);

    // Current price of TSLA rose to 150 (short loss!).
    // Short liability = 10 * 150 = 1500.
    // Holding value = -1500.
    // Total value = 11000 - 1500 = 9500 (-5.00% return).
    const mockPriceProvider = {
      getQuote: jest.fn().mockResolvedValue({ symbol: "TSLA", price: "150" }),
    };

    const result = await getLeagueLeaderboard({
      leagueId,
      now,
      priceProvider: mockPriceProvider,
      finalizeIfEnded: false,
    });

    expect(result.leaderboard).toHaveLength(1);
    expect(result.leaderboard[0].totalValue).toBe(9500);
    expect(result.leaderboard[0].returnPct).toBe(-5);
  });

  test("throws MARKET_DATA_PROVIDER_UNAVAILABLE when market quote is missing and does not fall back to execution price", async () => {
    const mockLeague = {
      id: leagueId,
      name: "Missing Price League",
      startingBalance: new Prisma.Decimal("10000"),
      startDate,
      endDate,
      status: "ACTIVE",
      members: [
        {
          id: "m-1",
          userId: "u-1",
          portfolioId: "p-1",
          joinedAt: new Date("2025-12-31T00:00:00.000Z"),
          user: { id: "u-1", name: "User 1", avatarUrl: null, isSuspended: false },
          portfolio: {
            trades: [
              {
                symbol: "XYZ",
                assetType: "STOCK",
                side: "BUY",
                quantity: new Prisma.Decimal("10"),
                price: new Prisma.Decimal("50"),
                fees: new Prisma.Decimal("0"),
                executedAt: new Date("2026-01-02T00:00:00.000Z"),
              },
            ],
          },
        },
      ],
    };

    prisma.league.findUnique.mockResolvedValue(mockLeague);

    // Provider returns null / missing quote
    const mockPriceProvider = {
      getQuote: jest.fn().mockResolvedValue(null),
    };

    await expect(
      getLeagueLeaderboard({
        leagueId,
        now,
        priceProvider: mockPriceProvider,
        finalizeIfEnded: true,
      }),
    ).rejects.toMatchObject({
      code: "MARKET_DATA_PROVIDER_UNAVAILABLE",
      statusCode: 503,
    });

    // Ensure rankings were NOT persisted
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.league.update).not.toHaveBeenCalled();
    expect(prisma.leagueMember.update).not.toHaveBeenCalled();
  });

  test("throws MARKET_DATA_PROVIDER_UNAVAILABLE when price provider throws an error", async () => {
    const mockLeague = {
      id: leagueId,
      name: "Provider Error League",
      startingBalance: new Prisma.Decimal("10000"),
      startDate,
      endDate,
      status: "ACTIVE",
      members: [
        {
          id: "m-1",
          userId: "u-1",
          portfolioId: "p-1",
          joinedAt: new Date("2025-12-31T00:00:00.000Z"),
          user: { id: "u-1", name: "User 1", avatarUrl: null, isSuspended: false },
          portfolio: {
            trades: [
              {
                symbol: "AAPL",
                assetType: "STOCK",
                side: "BUY",
                quantity: new Prisma.Decimal("5"),
                price: new Prisma.Decimal("150"),
                fees: new Prisma.Decimal("0"),
                executedAt: new Date("2026-01-02T00:00:00.000Z"),
              },
            ],
          },
        },
      ],
    };

    prisma.league.findUnique.mockResolvedValue(mockLeague);

    const mockPriceProvider = {
      getQuote: jest.fn().mockRejectedValue(new Error("Connection reset by peer")),
    };

    await expect(
      getLeagueLeaderboard({
        leagueId,
        now,
        priceProvider: mockPriceProvider,
      }),
    ).rejects.toMatchObject({
      code: "MARKET_DATA_PROVIDER_UNAVAILABLE",
      statusCode: 503,
    });
  });

  test("throws MARKET_DATA_PROVIDER_UNAVAILABLE and does not persist rankings when historical price is missing for ended league", async () => {
    const mockLeague = {
      id: leagueId,
      name: "Ended League Missing Price",
      startingBalance: new Prisma.Decimal("10000"),
      startDate,
      endDate,
      status: "ACTIVE",
      members: [
        {
          id: "m-1",
          userId: "u-1",
          portfolioId: "p-1",
          joinedAt: new Date("2025-12-31T00:00:00.000Z"),
          user: { id: "u-1", name: "User 1", avatarUrl: null, isSuspended: false },
          portfolio: {
            trades: [
              {
                symbol: "AAPL",
                assetType: "STOCK",
                side: "BUY",
                quantity: new Prisma.Decimal("5"),
                price: new Prisma.Decimal("150"),
                fees: new Prisma.Decimal("0"),
                executedAt: new Date("2026-01-02T00:00:00.000Z"),
              },
            ],
          },
        },
      ],
    };

    prisma.league.findUnique.mockResolvedValue(mockLeague);

    const mockPriceProvider = {
      getHistoricalPrice: jest.fn().mockResolvedValue(null),
    };

    const endedNow = new Date("2026-01-15T00:00:00.000Z"); // after endDate

    await expect(
      getLeagueLeaderboard({
        leagueId,
        now: endedNow,
        priceProvider: mockPriceProvider,
        finalizeIfEnded: true,
      }),
    ).rejects.toMatchObject({
      code: "MARKET_DATA_PROVIDER_UNAVAILABLE",
      statusCode: 503,
    });

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.league.update).not.toHaveBeenCalled();
    expect(prisma.leagueMember.update).not.toHaveBeenCalled();
  });

  test("applies deterministic tie-breaker hierarchy using Prisma.Decimal", async () => {
    // 5 members testing tie-breaker hierarchy:
    // 1. returnPct DESC
    // 2. totalValue DESC
    // 3. tradeCount DESC
    // 4. joinedAt ASC
    // 5. userId ASC
    const mockLeague = {
      id: leagueId,
      name: "Tie Breaker League",
      startingBalance: new Prisma.Decimal("10000"),
      startDate,
      endDate,
      status: "ACTIVE",
      members: [
        // Member A: return = +10%
        {
          id: "m-a",
          userId: "user-a",
          portfolioId: "p-a",
          joinedAt: new Date("2025-12-31T00:00:00.000Z"),
          user: { id: "user-a", name: "User A", avatarUrl: null, isSuspended: false },
          portfolio: {
            trades: [
              {
                symbol: "AAPL",
                assetType: "STOCK",
                side: "BUY",
                quantity: new Prisma.Decimal("10"),
                price: new Prisma.Decimal("100"),
                fees: new Prisma.Decimal("0"),
                executedAt: new Date("2026-01-02T00:00:00.000Z"),
              },
            ],
          },
        },
        // Member B1: 0 trades, return = 0%, totalValue = 10000, tradeCount = 0, joined at 12-30, userId = "user-b1"
        {
          id: "m-b1",
          userId: "user-b1",
          portfolioId: "p-b1",
          joinedAt: new Date("2025-12-30T00:00:00.000Z"),
          user: { id: "user-b1", name: "User B1", avatarUrl: null, isSuspended: false },
          portfolio: { trades: [] },
        },
        // Member B2: 0 trades, return = 0%, totalValue = 10000, tradeCount = 0, joined at 12-30, userId = "user-b2" (same join time, higher userId)
        {
          id: "m-b2",
          userId: "user-b2",
          portfolioId: "p-b2",
          joinedAt: new Date("2025-12-30T00:00:00.000Z"),
          user: { id: "user-b2", name: "User B2", avatarUrl: null, isSuspended: false },
          portfolio: { trades: [] },
        },
        // Member B3: 0 trades, return = 0%, totalValue = 10000, tradeCount = 0, joined at 12-31 (later join time)
        {
          id: "m-b3",
          userId: "user-b3",
          portfolioId: "p-b3",
          joinedAt: new Date("2025-12-31T00:00:00.000Z"),
          user: { id: "user-b3", name: "User B3", avatarUrl: null, isSuspended: false },
          portfolio: { trades: [] },
        },
        // Member C: 2 trades, return = 0%, totalValue = 10000, tradeCount = 2
        {
          id: "m-c",
          userId: "user-c",
          portfolioId: "p-c",
          joinedAt: new Date("2025-12-31T12:00:00.000Z"),
          user: { id: "user-c", name: "User C", avatarUrl: null, isSuspended: false },
          portfolio: {
            trades: [
              {
                symbol: "AAPL",
                assetType: "STOCK",
                side: "BUY",
                quantity: new Prisma.Decimal("10"),
                price: new Prisma.Decimal("100"),
                fees: new Prisma.Decimal("0"),
                executedAt: new Date("2026-01-02T00:00:00.000Z"),
              },
              {
                symbol: "AAPL",
                assetType: "STOCK",
                side: "SELL",
                quantity: new Prisma.Decimal("10"),
                price: new Prisma.Decimal("100"),
                fees: new Prisma.Decimal("0"),
                executedAt: new Date("2026-01-03T00:00:00.000Z"),
              },
            ],
          },
        },
      ],
    };

    prisma.league.findUnique.mockResolvedValue(mockLeague);

    const mockPriceProvider = {
      getQuote: jest.fn().mockImplementation((sym) => {
        if (sym === "AAPL") return Promise.resolve({ symbol: "AAPL", price: "110" });
        return Promise.resolve({ symbol: sym, price: "100" });
      }),
    };

    const result = await getLeagueLeaderboard({
      leagueId,
      now,
      priceProvider: mockPriceProvider,
      finalizeIfEnded: false,
    });

    const ranks = result.leaderboard.map((m) => ({
      rank: m.rank,
      userId: m.userId,
      returnPct: m.returnPct,
      tradeCount: m.tradeCount,
    }));

    // Expected ordering:
    // Rank 1: user-a (returnPct = 1%)
    // Rank 2: user-c (returnPct = 0%, totalValue = 10000, tradeCount = 2)
    // Rank 3: user-b1 (returnPct = 0%, totalValue = 10000, tradeCount = 0, joinedAt = 12-30, userId = "user-b1")
    // Rank 4: user-b2 (returnPct = 0%, totalValue = 10000, tradeCount = 0, joinedAt = 12-30, userId = "user-b2")
    // Rank 5: user-b3 (returnPct = 0%, totalValue = 10000, tradeCount = 0, joinedAt = 12-31, userId = "user-b3")
    expect(ranks).toEqual([
      { rank: 1, userId: "user-a", returnPct: 1, tradeCount: 1 },
      { rank: 2, userId: "user-c", returnPct: 0, tradeCount: 2 },
      { rank: 3, userId: "user-b1", returnPct: 0, tradeCount: 0 },
      { rank: 4, userId: "user-b2", returnPct: 0, tradeCount: 0 },
      { rank: 5, userId: "user-b3", returnPct: 0, tradeCount: 0 },
    ]);
  });
});

describe("competitionService - UTC Boundary Status Transitions (#128)", () => {
  const startDate = new Date("2026-05-01T12:00:00.000Z");
  const endDate = new Date("2026-05-10T12:00:00.000Z");
  const baseLeague = {
    startDate,
    endDate,
    status: "UPCOMING",
  };

  test("just before start date (< startDate): status is UPCOMING", () => {
    const justBefore = new Date(startDate.getTime() - 1);
    expect(getEffectiveLeagueStatus(baseLeague, justBefore)).toBe("UPCOMING");
  });

  test("exactly at start date (=== startDate): status transitions to ACTIVE", () => {
    expect(getEffectiveLeagueStatus(baseLeague, startDate)).toBe("ACTIVE");
  });

  test("just after start date (> startDate, < endDate): status is ACTIVE", () => {
    const justAfter = new Date(startDate.getTime() + 1);
    expect(getEffectiveLeagueStatus(baseLeague, justAfter)).toBe("ACTIVE");
  });

  test("just before end date (< endDate): status is ACTIVE", () => {
    const justBefore = new Date(endDate.getTime() - 1);
    expect(getEffectiveLeagueStatus(baseLeague, justBefore)).toBe("ACTIVE");
  });

  test("exactly at end date (=== endDate): status transitions to COMPLETED", () => {
    expect(getEffectiveLeagueStatus(baseLeague, endDate)).toBe("COMPLETED");
  });

  test("just after end date (> endDate): status is COMPLETED", () => {
    const justAfter = new Date(endDate.getTime() + 1);
    expect(getEffectiveLeagueStatus(baseLeague, justAfter)).toBe("COMPLETED");
  });

  test("preserves CANCELLED status regardless of timestamps", () => {
    const cancelled = { ...baseLeague, status: "CANCELLED" };
    expect(getEffectiveLeagueStatus(cancelled, startDate)).toBe("CANCELLED");
    expect(getEffectiveLeagueStatus(cancelled, endDate)).toBe("CANCELLED");
  });
});
