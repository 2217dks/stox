const { Prisma } = require("@prisma/client");

const {
  normalizeSnapshotDate,
  getPeriodStart,
  addPortfolioToTotals,
  rankLeaderboard,
} = require("../../../src/services/leaderboardService");

describe("Leaderboard snapshot calculation", () => {
  describe("normalizeSnapshotDate", () => {
    test("normalizes a date to midnight UTC", () => {
      const result = normalizeSnapshotDate(
        new Date("2026-11-10T19:30:45.000Z"),
      );

      expect(result.toISOString()).toBe("2026-11-10T00:00:00.000Z");
    });

    test("throws for an invalid date", () => {
      expect(() => normalizeSnapshotDate("invalid-date")).toThrow(
        "Snapshot date must be a valid date.",
      );
    });
  });

  describe("getPeriodStart", () => {
    const snapshotDate = new Date("2026-11-10T00:00:00.000Z");

    test("returns the snapshot date for DAILY", () => {
      expect(getPeriodStart("DAILY", snapshotDate).toISOString()).toBe(
        "2026-11-10T00:00:00.000Z",
      );
    });

    test("returns Monday for WEEKLY", () => {
      expect(getPeriodStart("WEEKLY", snapshotDate).toISOString()).toBe(
        "2026-11-09T00:00:00.000Z",
      );
    });

    test("returns the first day of the month for MONTHLY", () => {
      expect(getPeriodStart("MONTHLY", snapshotDate).toISOString()).toBe(
        "2026-11-01T00:00:00.000Z",
      );
    });

    test("returns null for ALL_TIME", () => {
      expect(getPeriodStart("ALL_TIME", snapshotDate)).toBeNull();
    });
  });

  describe("addPortfolioToTotals", () => {
    test("aggregates starting balance, cash, and invested holdings", () => {
      const totalsByUser = new Map();

      addPortfolioToTotals(totalsByUser, {
        userId: "user-1",
        startingBalance: new Prisma.Decimal("10000"),
        cashBalance: new Prisma.Decimal("7000"),
        holdings: [
          { totalInvested: new Prisma.Decimal("2000") },
          { totalInvested: new Prisma.Decimal("1000") },
        ],
      });

      const totals = totalsByUser.get("user-1");

      expect(totals.startingBalance.toString()).toBe("10000");
      expect(totals.totalValue.toString()).toBe("10000");
    });

    test("aggregates multiple portfolios belonging to the same user", () => {
      const totalsByUser = new Map();

      addPortfolioToTotals(totalsByUser, {
        userId: "user-1",
        startingBalance: new Prisma.Decimal("10000"),
        cashBalance: new Prisma.Decimal("6000"),
        holdings: [{ totalInvested: new Prisma.Decimal("4000") }],
      });

      addPortfolioToTotals(totalsByUser, {
        userId: "user-1",
        startingBalance: new Prisma.Decimal("5000"),
        cashBalance: new Prisma.Decimal("3000"),
        holdings: [{ totalInvested: new Prisma.Decimal("2000") }],
      });

      const totals = totalsByUser.get("user-1");

      expect(totals.startingBalance.toString()).toBe("15000");
      expect(totals.totalValue.toString()).toBe("15000");
    });
  });

  describe("rankLeaderboard", () => {
    test("ranks users by return percentage in descending order", () => {
      const totals = new Map([
        [
          "user-1",
          {
            startingBalance: new Prisma.Decimal("1000"),
            totalValue: new Prisma.Decimal("1100"),
          },
        ],
        [
          "user-2",
          {
            startingBalance: new Prisma.Decimal("1000"),
            totalValue: new Prisma.Decimal("1200"),
          },
        ],
      ]);

      const pnl = new Map([
        ["user-1", new Prisma.Decimal("100")],
        ["user-2", new Prisma.Decimal("200")],
      ]);

      const result = rankLeaderboard(totals, pnl);

      expect(result.map((entry) => entry.userId)).toEqual(["user-2", "user-1"]);

      expect(result.map((entry) => entry.rank)).toEqual([1, 2]);
    });

    test("uses total portfolio value when returns are equal", () => {
      const totals = new Map([
        [
          "user-1",
          {
            startingBalance: new Prisma.Decimal("1000"),
            totalValue: new Prisma.Decimal("1100"),
          },
        ],
        [
          "user-2",
          {
            startingBalance: new Prisma.Decimal("1000"),
            totalValue: new Prisma.Decimal("1200"),
          },
        ],
      ]);

      const pnl = new Map([
        ["user-1", new Prisma.Decimal("100")],
        ["user-2", new Prisma.Decimal("100")],
      ]);

      const result = rankLeaderboard(totals, pnl);

      expect(result.map((entry) => entry.userId)).toEqual(["user-2", "user-1"]);
    });

    test("uses user ID as a deterministic tie-breaker", () => {
      const totals = new Map([
        [
          "user-z",
          {
            startingBalance: new Prisma.Decimal("1000"),
            totalValue: new Prisma.Decimal("1100"),
          },
        ],
        [
          "user-a",
          {
            startingBalance: new Prisma.Decimal("1000"),
            totalValue: new Prisma.Decimal("1100"),
          },
        ],
        [
          "user-b",
          {
            startingBalance: new Prisma.Decimal("1000"),
            totalValue: new Prisma.Decimal("1100"),
          },
        ],
      ]);

      const pnl = new Map([
        ["user-z", new Prisma.Decimal("100")],
        ["user-a", new Prisma.Decimal("100")],
        ["user-b", new Prisma.Decimal("100")],
      ]);

      const result = rankLeaderboard(totals, pnl);

      expect(result.map((entry) => entry.userId)).toEqual([
        "user-a",
        "user-b",
        "user-z",
      ]);
    });

    test("excludes users with zero or negative starting balances", () => {
      const totals = new Map([
        [
          "valid-user",
          {
            startingBalance: new Prisma.Decimal("1000"),
            totalValue: new Prisma.Decimal("1100"),
          },
        ],
        [
          "zero-user",
          {
            startingBalance: new Prisma.Decimal("0"),
            totalValue: new Prisma.Decimal("500"),
          },
        ],
        [
          "negative-user",
          {
            startingBalance: new Prisma.Decimal("-100"),
            totalValue: new Prisma.Decimal("500"),
          },
        ],
      ]);

      const result = rankLeaderboard(totals);

      expect(result).toHaveLength(1);
      expect(result[0].userId).toBe("valid-user");
    });

    test("returns an empty array when there are no users", () => {
      expect(rankLeaderboard(new Map())).toEqual([]);
    });

    test("assigns consecutive ranks after sorting", () => {
      const totals = new Map([
        [
          "user-1",
          {
            startingBalance: new Prisma.Decimal("1000"),
            totalValue: new Prisma.Decimal("1100"),
          },
        ],
        [
          "user-2",
          {
            startingBalance: new Prisma.Decimal("1000"),
            totalValue: new Prisma.Decimal("1200"),
          },
        ],
      ]);

      const result = rankLeaderboard(
        totals,
        new Map([
          ["user-1", new Prisma.Decimal("100")],
          ["user-2", new Prisma.Decimal("200")],
        ]),
      );

      expect(result.map((entry) => entry.rank)).toEqual([1, 2]);
    });
  });
});
