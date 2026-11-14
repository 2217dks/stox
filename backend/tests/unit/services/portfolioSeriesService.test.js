const { Prisma } = require("@prisma/client");
const {
  resolveDateRange,
  getPortfolioReturnSeries,
} = require("../../../src/services/portfolioSeriesService");

jest.mock("../../../src/services/portfolioSnapshotService", () => ({
  capturePortfolioSnapshot: jest.fn(),
}));

const { capturePortfolioSnapshot } = require("../../../src/services/portfolioSnapshotService");

describe("portfolioSeriesService unit tests", () => {
  const portfolioId = "11111111-1111-4111-8111-111111111111";

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("resolveDateRange", () => {
    const fixedAsOf = new Date("2026-11-15T15:30:00.000Z");

    test("resolves 1W period", () => {
      const range = resolveDateRange({ period: "1W", asOf: fixedAsOf });
      expect(range.normalizedPeriod).toBe("1W");
      expect(range.startDate.toISOString()).toBe("2026-11-08T00:00:00.000Z");
      expect(range.endDate.toISOString()).toBe("2026-11-15T23:59:59.999Z");
    });

    test("resolves 1M period", () => {
      const range = resolveDateRange({ period: "1M", asOf: fixedAsOf });
      expect(range.normalizedPeriod).toBe("1M");
      expect(range.startDate.toISOString()).toBe("2026-10-16T00:00:00.000Z");
      expect(range.endDate.toISOString()).toBe("2026-11-15T23:59:59.999Z");
    });

    test("resolves YTD period", () => {
      const range = resolveDateRange({ period: "YTD", asOf: fixedAsOf });
      expect(range.normalizedPeriod).toBe("YTD");
      expect(range.startDate.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    });

    test("resolves ALL period", () => {
      const range = resolveDateRange({ period: "ALL", asOf: fixedAsOf });
      expect(range.normalizedPeriod).toBe("ALL");
      expect(range.startDate).toBeNull();
      expect(range.endDate.toISOString()).toBe("2026-11-15T23:59:59.999Z");
    });

    test("resolves specific year param", () => {
      const range = resolveDateRange({ year: 2025, asOf: fixedAsOf });
      expect(range.normalizedPeriod).toBe("2025");
      expect(range.startDate.toISOString()).toBe("2025-01-01T00:00:00.000Z");
      expect(range.endDate.toISOString()).toBe("2025-12-31T23:59:59.999Z");
    });
  });

  describe("getPortfolioReturnSeries", () => {
    test("retrieves snapshot series and computes cumulative return", async () => {
      const mockSnapshots = [
        {
          snapshotDate: new Date("2026-11-10T00:00:00.000Z"),
          totalValue: new Prisma.Decimal("10000"),
          cashBalance: new Prisma.Decimal("5000"),
          holdingsValue: new Prisma.Decimal("5000"),
          dailyPnl: new Prisma.Decimal("0"),
          dailyPnlPct: new Prisma.Decimal("0"),
        },
        {
          snapshotDate: new Date("2026-11-11T00:00:00.000Z"),
          totalValue: new Prisma.Decimal("10200"),
          cashBalance: new Prisma.Decimal("5000"),
          holdingsValue: new Prisma.Decimal("5200"),
          dailyPnl: new Prisma.Decimal("200"),
          dailyPnlPct: new Prisma.Decimal("0.02"),
        },
        {
          snapshotDate: new Date("2026-11-12T00:00:00.000Z"),
          totalValue: new Prisma.Decimal("10500"),
          cashBalance: new Prisma.Decimal("5000"),
          holdingsValue: new Prisma.Decimal("5500"),
          dailyPnl: new Prisma.Decimal("300"),
          dailyPnlPct: new Prisma.Decimal("0.0294"),
        },
      ];

      const mockClient = {
        performanceSnapshot: {
          findMany: jest.fn().mockResolvedValue(mockSnapshots),
        },
      };

      const asOf = new Date("2026-11-12T12:00:00.000Z");
      const result = await getPortfolioReturnSeries(portfolioId, {
        period: "1W",
        asOf,
        ensureToday: false,
        client: mockClient,
      });

      expect(result.portfolioId).toBe(portfolioId);
      expect(result.period).toBe("1W");
      expect(result.series).toHaveLength(3);
      expect(result.series[0].date).toBe("2026-11-10");
      expect(result.series[2].date).toBe("2026-11-12");
      // Cumulative return: (10500 - 10000) / 10000 = 0.05
      expect(result.cumulativeReturn.toString()).toBe("0.05");
    });

    test("handles single snapshot series by returning cumulativeReturn 0", async () => {
      const mockSnapshots = [
        {
          snapshotDate: new Date("2026-11-12T00:00:00.000Z"),
          totalValue: new Prisma.Decimal("10000"),
          cashBalance: new Prisma.Decimal("10000"),
          holdingsValue: new Prisma.Decimal("0"),
          dailyPnl: new Prisma.Decimal("0"),
          dailyPnlPct: new Prisma.Decimal("0"),
        },
      ];

      const mockClient = {
        performanceSnapshot: {
          findMany: jest.fn().mockResolvedValue(mockSnapshots),
        },
      };

      const result = await getPortfolioReturnSeries(portfolioId, {
        period: "1M",
        asOf: new Date("2026-11-12T12:00:00.000Z"),
        ensureToday: false,
        client: mockClient,
      });

      expect(result.series).toHaveLength(1);
      expect(result.cumulativeReturn.toString()).toBe("0");
    });

    test("attempts to capture today's snapshot when ensureToday is true and today is missing", async () => {
      const asOf = new Date("2026-11-15T10:00:00.000Z");

      const mockClient = {
        performanceSnapshot: {
          findMany: jest
            .fn()
            // First call: checking today's snapshot
            .mockResolvedValueOnce([])
            // Second call: fetching series range
            .mockResolvedValueOnce([
              {
                snapshotDate: new Date("2026-11-15T00:00:00.000Z"),
                totalValue: new Prisma.Decimal("10000"),
                cashBalance: new Prisma.Decimal("10000"),
                holdingsValue: new Prisma.Decimal("0"),
                dailyPnl: new Prisma.Decimal("0"),
                dailyPnlPct: new Prisma.Decimal("0"),
              },
            ]),
        },
      };

      capturePortfolioSnapshot.mockResolvedValue({});

      await getPortfolioReturnSeries(portfolioId, {
        period: "1M",
        asOf,
        ensureToday: true,
        client: mockClient,
      });

      expect(capturePortfolioSnapshot).toHaveBeenCalledTimes(1);
      expect(capturePortfolioSnapshot).toHaveBeenCalledWith(
        portfolioId,
        expect.objectContaining({ asOf }),
      );
    });
  });
});

