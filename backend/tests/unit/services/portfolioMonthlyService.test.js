const { Prisma } = require("@prisma/client");

jest.mock("../../../src/config/database", () => ({
  portfolio: {
    findFirst: jest.fn(),
  },
  trade: {
    findMany: jest.fn(),
  },
  $disconnect: jest.fn(),
}));

jest.mock("../../../src/services/portfolioSnapshotRepository", () => ({
  findSnapshots: jest.fn(),
  findLatestSnapshot: jest.fn(),
}));

const prisma = require("../../../src/config/database");
const {
  findSnapshots,
  findLatestSnapshot,
} = require("../../../src/services/portfolioSnapshotRepository");
const {
  getPortfolioMonthlyPerformance,
  toUtcYearMonth,
  getPreviousUtcYearMonth,
  getUtcMonthStart,
  getUtcMonthEnd,
} = require("../../../src/services/portfolioMonthlyService");

describe("portfolioMonthlyService", () => {
  const portfolioId = "port-uuid-1111";
  const userId = "user-uuid-1111";

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("UTC date helpers", () => {
    test("toUtcYearMonth formats Date to YYYY-MM in UTC", () => {
      expect(toUtcYearMonth(new Date("2026-05-15T12:00:00.000Z"))).toBe("2026-05");
      expect(toUtcYearMonth("2026-11-01T00:00:00.000Z")).toBe("2026-11");
    });

    test("getUtcMonthStart returns first millisecond of UTC month", () => {
      const start = getUtcMonthStart("2026-02");
      expect(start.toISOString()).toBe("2026-02-01T00:00:00.000Z");
    });

    test("getUtcMonthEnd returns last millisecond of UTC month, handling leap years", () => {
      // 2026 is not a leap year (28 days)
      const feb2026 = getUtcMonthEnd("2026-02");
      expect(feb2026.toISOString()).toBe("2026-02-28T23:59:59.999Z");

      // 2024 was a leap year (29 days)
      const feb2024 = getUtcMonthEnd("2024-02");
      expect(feb2024.toISOString()).toBe("2024-02-29T23:59:59.999Z");

      // 31-day month
      const jan2026 = getUtcMonthEnd("2026-01");
      expect(jan2026.toISOString()).toBe("2026-01-31T23:59:59.999Z");
    });

    test("getPreviousUtcYearMonth returns immediately preceding calendar month", () => {
      expect(getPreviousUtcYearMonth("2026-03")).toBe("2026-02");
      expect(getPreviousUtcYearMonth("2026-01")).toBe("2025-12");
      expect(getPreviousUtcYearMonth("2026-12")).toBe("2026-11");
    });
  });

  describe("getPortfolioMonthlyPerformance", () => {
    test("throws PORTFOLIO_NOT_FOUND if portfolio does not belong to user", async () => {
      prisma.portfolio.findFirst.mockResolvedValue(null);

      await expect(
        getPortfolioMonthlyPerformance(portfolioId, userId),
      ).rejects.toMatchObject({
        statusCode: 404,
        code: "PORTFOLIO_NOT_FOUND",
      });

      expect(prisma.portfolio.findFirst).toHaveBeenCalledWith({
        where: { id: portfolioId, userId },
        select: { id: true },
      });
    });

    test("returns empty months array when portfolio has no snapshots or trades", async () => {
      prisma.portfolio.findFirst.mockResolvedValue({ id: portfolioId });
      findSnapshots.mockResolvedValue([]);
      prisma.trade.findMany.mockResolvedValue([]);

      const result = await getPortfolioMonthlyPerformance(portfolioId, userId);

      expect(result).toEqual({
        portfolioId,
        months: [],
      });
    });

    test("aggregates monthly performance across consecutive months with snapshots and trades", async () => {
      prisma.portfolio.findFirst.mockResolvedValue({ id: portfolioId });

      // Snapshots for Jan 2026 and Feb 2026
      findSnapshots.mockResolvedValue([
        {
          snapshotDate: new Date("2026-01-05T00:00:00.000Z"),
          totalValue: new Prisma.Decimal("10000"),
        },
        {
          snapshotDate: new Date("2026-01-31T00:00:00.000Z"),
          totalValue: new Prisma.Decimal("10500"),
        },
        {
          snapshotDate: new Date("2026-02-15T00:00:00.000Z"),
          totalValue: new Prisma.Decimal("10800"),
        },
        {
          snapshotDate: new Date("2026-02-28T00:00:00.000Z"),
          totalValue: new Prisma.Decimal("11000"),
        },
      ]);

      // Trades in Jan and Feb
      prisma.trade.findMany.mockResolvedValue([
        {
          realizedPnl: new Prisma.Decimal("200"),
          executedAt: new Date("2026-01-10T12:00:00.000Z"),
        },
        {
          realizedPnl: new Prisma.Decimal("300"),
          executedAt: new Date("2026-02-20T12:00:00.000Z"),
        },
      ]);

      const result = await getPortfolioMonthlyPerformance(portfolioId, userId);

      expect(result.portfolioId).toBe(portfolioId);
      expect(result.months).toHaveLength(2);

      // Month 1: Jan 2026
      // Start: 10000, End: 10500, NetPnL: 500, ReturnPct: 5.0000%, Realized: 200, Unrealized: 300
      expect(result.months[0]).toEqual({
        month: "2026-01",
        startValue: "10000",
        endValue: "10500",
        netPnl: "500",
        returnPct: "5.0000",
        realizedPnl: "200",
        unrealizedPnl: "300",
        snapshotCount: 2,
      });

      // Month 2: Feb 2026
      // Start (from Jan end): 10500, End: 11000, NetPnL: 500, ReturnPct: 4.7619%, Realized: 300, Unrealized: 200
      expect(result.months[1]).toEqual({
        month: "2026-02",
        startValue: "10500",
        endValue: "11000",
        netPnl: "500",
        returnPct: "4.7619",
        realizedPnl: "300",
        unrealizedPnl: "200",
        snapshotCount: 2,
      });
    });

    test("uses prior month snapshot as baseline when filtering by from date", async () => {
      prisma.portfolio.findFirst.mockResolvedValue({ id: portfolioId });

      findLatestSnapshot.mockResolvedValue({
        snapshotDate: new Date("2026-01-31T00:00:00.000Z"),
        totalValue: new Prisma.Decimal("10500"),
      });

      findSnapshots.mockResolvedValue([
        {
          snapshotDate: new Date("2026-02-28T00:00:00.000Z"),
          totalValue: new Prisma.Decimal("11000"),
        },
      ]);

      prisma.trade.findMany.mockResolvedValue([]);

      const result = await getPortfolioMonthlyPerformance(portfolioId, userId, {
        from: "2026-02",
      });

      expect(findLatestSnapshot).toHaveBeenCalled();
      expect(result.months).toHaveLength(1);
      expect(result.months[0].month).toBe("2026-02");
      expect(result.months[0].startValue).toBe("10500");
      expect(result.months[0].endValue).toBe("11000");
      expect(result.months[0].netPnl).toBe("500");
    });

    test("does not span snapshot gaps when a month has trades but no snapshots", async () => {
      prisma.portfolio.findFirst.mockResolvedValue({ id: portfolioId });

      // January snapshots: Jan 5 = 10000, Jan 31 = 10500
      // March snapshots: Mar 10 = 11200, Mar 31 = 11800
      // February has NO snapshots
      findSnapshots.mockResolvedValue([
        {
          snapshotDate: new Date("2026-01-05T00:00:00.000Z"),
          totalValue: new Prisma.Decimal("10000"),
        },
        {
          snapshotDate: new Date("2026-01-31T00:00:00.000Z"),
          totalValue: new Prisma.Decimal("10500"),
        },
        {
          snapshotDate: new Date("2026-03-10T00:00:00.000Z"),
          totalValue: new Prisma.Decimal("11200"),
        },
        {
          snapshotDate: new Date("2026-03-31T00:00:00.000Z"),
          totalValue: new Prisma.Decimal("11800"),
        },
      ]);

      // February has a trade with realized P&L, March has a trade
      prisma.trade.findMany.mockResolvedValue([
        {
          realizedPnl: new Prisma.Decimal("300"),
          executedAt: new Date("2026-02-15T12:00:00.000Z"),
        },
        {
          realizedPnl: new Prisma.Decimal("150"),
          executedAt: new Date("2026-03-20T12:00:00.000Z"),
        },
      ]);

      const result = await getPortfolioMonthlyPerformance(portfolioId, userId);

      expect(result.months).toHaveLength(3);

      // January 2026: normal start 10000, end 10500
      expect(result.months[0]).toEqual({
        month: "2026-01",
        startValue: "10000",
        endValue: "10500",
        netPnl: "500",
        returnPct: "5.0000",
        realizedPnl: "0",
        unrealizedPnl: "500",
        snapshotCount: 2,
      });

      // February 2026: no snapshots, trade realized P&L is preserved
      expect(result.months[1]).toEqual({
        month: "2026-02",
        startValue: null,
        endValue: null,
        netPnl: null,
        returnPct: null,
        realizedPnl: "300",
        unrealizedPnl: null,
        snapshotCount: 0,
      });

      // March 2026: must NOT use January's end value (10500) as start baseline!
      // Must use March's first snapshot (11200) instead.
      expect(result.months[2].month).toBe("2026-03");
      expect(result.months[2].startValue).not.toBe("10500");
      expect(result.months[2].startValue).toBe("11200");
      expect(result.months[2].endValue).toBe("11800");
      expect(result.months[2].netPnl).toBe("600");
      expect(result.months[2].returnPct).toBe("5.3571");
      expect(result.months[2].realizedPnl).toBe("150");
      expect(result.months[2].unrealizedPnl).toBe("450");
      expect(result.months[2].snapshotCount).toBe(2);
    });

    test("does not use prior snapshot across a gap when requested range begins after a snapshot gap", async () => {
      prisma.portfolio.findFirst.mockResolvedValue({ id: portfolioId });

      // Requesting from=2026-03
      // findLatestSnapshot before 2026-03-01 finds Jan 31 snapshot (gap: February had no snapshot)
      findLatestSnapshot.mockResolvedValue({
        snapshotDate: new Date("2026-01-31T00:00:00.000Z"),
        totalValue: new Prisma.Decimal("10500"),
      });

      // March snapshots
      findSnapshots.mockResolvedValue([
        {
          snapshotDate: new Date("2026-03-10T00:00:00.000Z"),
          totalValue: new Prisma.Decimal("11200"),
        },
        {
          snapshotDate: new Date("2026-03-31T00:00:00.000Z"),
          totalValue: new Prisma.Decimal("11800"),
        },
      ]);

      prisma.trade.findMany.mockResolvedValue([]);

      const result = await getPortfolioMonthlyPerformance(portfolioId, userId, {
        from: "2026-03",
      });

      expect(result.months).toHaveLength(1);
      expect(result.months[0].month).toBe("2026-03");
      // Must NOT use Jan 31 snapshot (10500) because Jan is not the immediate prior month to March
      expect(result.months[0].startValue).not.toBe("10500");
      expect(result.months[0].startValue).toBe("11200");
      expect(result.months[0].endValue).toBe("11800");
      expect(result.months[0].netPnl).toBe("600");
    });
  });
});
