const { Prisma } = require("@prisma/client");

const {
  evaluateLeagueMembers,
} = require("../../../src/services/competitionService");

function member(userId, quantity = "10") {
  return {
    user: { id: userId, isSuspended: false },
    portfolio: {
      trades: [
        {
          symbol: "AAPL",
          assetType: "STOCK",
          side: "BUY",
          quantity,
          price: "100",
          fees: "0",
          executedAt: new Date("2026-06-01T00:00:00.000Z"),
        },
      ],
    },
  };
}

describe("league leaderboard pricing", () => {
  test("prices a symbol once even when every member holds it", async () => {
    const priceProvider = {
      getQuote: jest.fn(async (symbol) => ({ symbol, price: "110" })),
    };

    const league = {
      startDate: new Date("2026-01-01T00:00:00.000Z"),
      endDate: new Date("2026-12-31T00:00:00.000Z"),
      status: "ACTIVE",
      startingBalance: new Prisma.Decimal("10000"),
      members: [member("user-1"), member("user-2"), member("user-3")],
    };

    const result = await evaluateLeagueMembers(league, {
      valuationDate: new Date("2026-11-10T00:00:00.000Z"),
      priceProvider,
    });

    expect(result).toHaveLength(3);
    expect(priceProvider.getQuote).toHaveBeenCalledTimes(1);
  });
});
