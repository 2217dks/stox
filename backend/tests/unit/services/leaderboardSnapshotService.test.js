const { Prisma } = require("@prisma/client");

const {
  normalizeSnapshotDate,
  getPeriodStart,
  addPortfolioToTotals,
  rankLeaderboard,
  generateLeaderboardSnapshots,
} = require("../../../src/services/leaderboardService");
const prisma = require("../../../src/config/database");

describe("Leaderboard snapshot calculation", () => {
  describe("normalizeSnapshotDate", () => {
    test("normalizes a date to midnight UTC", () => {
      const result = normalizeSnapshotDate(
        new Date("2026-11-10T19:30:45.000Z"),
      );

      expect(result.toISOString()).toBe("2026-11-10T00:00:00.000Z");
    });

    test("normalizes boundary timestamps (23:59:59.999Z) to the same UTC day midnight", () => {
      const result = normalizeSnapshotDate(
        new Date("2026-11-10T23:59:59.999Z"),
      );

      expect(result.toISOString()).toBe("2026-11-10T00:00:00.000Z");
    });

    test("normalizes exact midnight 00:00:00.000Z to exact midnight UTC", () => {
      const result = normalizeSnapshotDate(
        new Date("2026-11-10T00:00:00.000Z"),
      );

      expect(result.toISOString()).toBe("2026-11-10T00:00:00.000Z");
    });

    test("normalizes leap day boundary timestamps to leap day midnight UTC", () => {
      const result = normalizeSnapshotDate(
        new Date("2024-02-29T23:59:59.999Z"),
      );

      expect(result.toISOString()).toBe("2024-02-29T00:00:00.000Z");
    });

    test("normalizes year-end boundary timestamps to year-end midnight UTC", () => {
      const result = normalizeSnapshotDate(
        new Date("2026-12-31T23:59:59.999Z"),
      );

      expect(result.toISOString()).toBe("2026-12-31T00:00:00.000Z");
    });

    test("normalizes year-start boundary timestamps to year-start midnight UTC", () => {
      const result = normalizeSnapshotDate(
        new Date("2027-01-01T00:00:00.000Z"),
      );

      expect(result.toISOString()).toBe("2027-01-01T00:00:00.000Z");
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

    test("returns preceding Monday for WEEKLY when snapshot date is Sunday", () => {
      const sundayDate = new Date("2026-11-15T00:00:00.000Z");
      expect(getPeriodStart("WEEKLY", sundayDate).toISOString()).toBe(
        "2026-11-09T00:00:00.000Z",
      );
    });

    test("returns same day for WEEKLY when snapshot date is Monday", () => {
      const mondayDate = new Date("2026-11-09T00:00:00.000Z");
      expect(getPeriodStart("WEEKLY", mondayDate).toISOString()).toBe(
        "2026-11-09T00:00:00.000Z",
      );
    });

    test("returns preceding Monday for WEEKLY when snapshot date is Saturday", () => {
      const saturdayDate = new Date("2026-11-14T00:00:00.000Z");
      expect(getPeriodStart("WEEKLY", saturdayDate).toISOString()).toBe(
        "2026-11-09T00:00:00.000Z",
      );
    });

    test("returns the first day of the month for MONTHLY", () => {
      expect(getPeriodStart("MONTHLY", snapshotDate).toISOString()).toBe(
        "2026-11-01T00:00:00.000Z",
      );
    });

    test("returns the first day of February on a leap year for MONTHLY", () => {
      const leapDate = new Date("2024-02-29T00:00:00.000Z");
      expect(getPeriodStart("MONTHLY", leapDate).toISOString()).toBe(
        "2024-02-01T00:00:00.000Z",
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

    test("ranks negative returns where a smaller loss is ranked above a larger loss", () => {
      const totals = new Map([
        [
          "user-heavy-loss",
          {
            startingBalance: new Prisma.Decimal("1000"),
            totalValue: new Prisma.Decimal("500"),
          },
        ],
        [
          "user-light-loss",
          {
            startingBalance: new Prisma.Decimal("1000"),
            totalValue: new Prisma.Decimal("950"),
          },
        ],
        [
          "user-moderate-loss",
          {
            startingBalance: new Prisma.Decimal("1000"),
            totalValue: new Prisma.Decimal("850"),
          },
        ],
      ]);

      const pnl = new Map([
        ["user-heavy-loss", new Prisma.Decimal("-500")],
        ["user-light-loss", new Prisma.Decimal("-50")],
        ["user-moderate-loss", new Prisma.Decimal("-150")],
      ]);

      const result = rankLeaderboard(totals, pnl);

      expect(result.map((entry) => entry.userId)).toEqual([
        "user-light-loss",
        "user-moderate-loss",
        "user-heavy-loss",
      ]);
      expect(result[0].returnPct.toString()).toBe("-5");
      expect(result[1].returnPct.toString()).toBe("-15");
      expect(result[2].returnPct.toString()).toBe("-50");
    });

    test("formats returnPct to 4 decimal places and totalValue to 8 decimal places", () => {
      const totals = new Map([
        [
          "user-1",
          {
            startingBalance: new Prisma.Decimal("3000"),
            totalValue: new Prisma.Decimal("3333.333333333"),
          },
        ],
      ]);

      const pnl = new Map([["user-1", new Prisma.Decimal("100.123456")]]);

      const result = rankLeaderboard(totals, pnl);

      expect(result).toHaveLength(1);
      // 100.123456 / 3000 * 100 = 3.33744856 -> 3.3374
      expect(result[0].returnPct.toString()).toBe("3.3374");
      expect(result[0].totalValue.toString()).toBe("3333.33333333");
    });
  });

  describe("generateLeaderboardSnapshots idempotency and invariants", () => {
    afterEach(() => {
      jest.restoreAllMocks();
    });

    test("runs inside a transaction, filters out suspended users, and deletes old entries before inserting", async () => {
      const mockSnapshot = { id: "snap-mock-123" };
      const mockPortfolios = [
        {
          id: "port-1",
          userId: "user-1",
          startingBalance: new Prisma.Decimal("10000"),
          cashBalance: new Prisma.Decimal("10000"),
          holdings: [],
        },
      ];

      const deleteManyMock = jest.fn().mockResolvedValue({ count: 1 });
      const createManyMock = jest.fn().mockResolvedValue({ count: 1 });
      const upsertMock = jest.fn().mockResolvedValue(mockSnapshot);
      const findManyPortfoliosMock = jest
        .fn()
        .mockResolvedValue(mockPortfolios);
      const groupByTradeMock = jest.fn().mockResolvedValue([]);

      const mockTx = {
        portfolio: { findMany: findManyPortfoliosMock },
        trade: { groupBy: groupByTradeMock },
        leaderboardSnapshot: { upsert: upsertMock },
        leaderboardEntry: {
          deleteMany: deleteManyMock,
          createMany: createManyMock,
        },
      };

      jest
        .spyOn(prisma, "$transaction")
        .mockImplementation(async (callback) => {
          return callback(mockTx);
        });

      const date = new Date("2026-11-10T15:00:00.000Z");
      const result = await generateLeaderboardSnapshots({ date });

      expect(result.snapshotDate.toISOString()).toBe("2026-11-10T00:00:00.000Z");
      expect(result.leaderboards).toHaveLength(4);

      // Verify suspended users are filtered in portfolio query
      expect(findManyPortfoliosMock).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            user: {
              isSuspended: false,
            },
          },
        }),
      );

      // Verify deleteMany is called before createMany for each of the 4 periods
      expect(deleteManyMock).toHaveBeenCalledTimes(4);
      expect(createManyMock).toHaveBeenCalledTimes(4);

      // Verify deletion scope and snapshotDate match the normalized date
      expect(deleteManyMock).toHaveBeenCalledWith({
        where: {
          scope: "GLOBAL",
          period: expect.any(String),
          snapshotDate: new Date("2026-11-10T00:00:00.000Z"),
        },
      });
    });

    test("excludes league competition portfolios from the global board", async () => {
      const mockPortfolios = [
        {
          id: "port-main",
          userId: "user-main",
          startingBalance: new Prisma.Decimal("10000"),
          cashBalance: new Prisma.Decimal("10000"),
          holdings: [],
          leagueMember: null,
        },
        {
          id: "port-league",
          userId: "user-league",
          startingBalance: new Prisma.Decimal("9999999999"),
          cashBalance: new Prisma.Decimal("9999999999"),
          holdings: [],
          leagueMember: { id: "member-1" },
        },
      ];

      const createManyMock = jest.fn().mockResolvedValue({ count: 1 });
      const groupByTradeMock = jest.fn().mockResolvedValue([]);

      const mockTx = {
        portfolio: { findMany: jest.fn().mockResolvedValue(mockPortfolios) },
        trade: { groupBy: groupByTradeMock },
        leaderboardSnapshot: { upsert: jest.fn().mockResolvedValue({ id: "s" }) },
        leaderboardEntry: {
          deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
          createMany: createManyMock,
        },
      };

      jest
        .spyOn(prisma, "$transaction")
        .mockImplementation(async (callback) => callback(mockTx));

      await generateLeaderboardSnapshots({
        date: new Date("2026-11-10T15:00:00.000Z"),
      });

      const entries = createManyMock.mock.calls.flatMap(
        ([argument]) => argument.data,
      );

      expect(entries.some((entry) => entry.userId === "user-main")).toBe(true);
      expect(entries.some((entry) => entry.userId === "user-league")).toBe(
        false,
      );
    });
  });
});
