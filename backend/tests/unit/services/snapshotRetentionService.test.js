const { Prisma } = require("@prisma/client");
const {
  DEFAULT_RETENTION_DAYS,
  pruneExpiredSnapshots,
} = require("../../../src/services/snapshotRetentionService");
const { getPortfolioPerformance } = require("../../../src/services/portfolioPerformanceService");

describe("Snapshot Retention Service (Task 48.1)", () => {
  let mockClient;

  beforeEach(() => {
    mockClient = {
      performanceSnapshot: {
        deleteMany: jest.fn(),
      },
    };
  });

  describe("retention pruning execution and defaults", () => {
    test("uses default retention days (365) and correctly filters older snapshots of inactive portfolios", async () => {
      const fixedNow = new Date("2026-11-18T10:00:00.000Z");
      mockClient.performanceSnapshot.deleteMany.mockResolvedValue({ count: 12 });

      const result = await pruneExpiredSnapshots({
        asOf: fixedNow,
        client: mockClient,
      });

      expect(result.pruned).toBe(true);
      expect(result.retentionDays).toBe(DEFAULT_RETENTION_DAYS);
      expect(result.deletedCount).toBe(12);

      // 2026-11-18 minus 365 days is 2025-11-18
      expect(result.cutoffDate).toBe("2025-11-18");

      expect(mockClient.performanceSnapshot.deleteMany).toHaveBeenCalledWith({
        where: {
          snapshotDate: {
            lt: new Date("2025-11-18T00:00:00.000Z"),
          },
          portfolio: {
            isActive: false,
          },
        },
      });
    });

    test("supports custom retentionDays and correctly prunes older snapshots", async () => {
      const fixedNow = new Date("2026-11-18T00:00:00.000Z");
      mockClient.performanceSnapshot.deleteMany.mockResolvedValue({ count: 4 });

      const result = await pruneExpiredSnapshots({
        retentionDays: 90,
        asOf: fixedNow,
        client: mockClient,
      });

      expect(result.pruned).toBe(true);
      expect(result.retentionDays).toBe(90);
      expect(result.deletedCount).toBe(4);

      // 2026-11-18 minus 90 days = 2026-08-20
      expect(result.cutoffDate).toBe("2026-08-20");

      expect(mockClient.performanceSnapshot.deleteMany).toHaveBeenCalledWith({
        where: {
          snapshotDate: {
            lt: new Date("2026-08-20T00:00:00.000Z"),
          },
          portfolio: {
            isActive: false,
          },
        },
      });
    });

    test("handles zero deleted snapshots gracefully", async () => {
      mockClient.performanceSnapshot.deleteMany.mockResolvedValue({ count: 0 });

      const result = await pruneExpiredSnapshots({
        retentionDays: 180,
        client: mockClient,
      });

      expect(result.pruned).toBe(true);
      expect(result.deletedCount).toBe(0);
    });
  });

  describe("strict retention parameter validation", () => {
    test("rejects retentionDays = 0", async () => {
      await expect(
        pruneExpiredSnapshots({ retentionDays: 0, client: mockClient }),
      ).rejects.toThrow("retentionDays must be a positive integer");
    });

    test("rejects retentionDays = -1", async () => {
      await expect(
        pruneExpiredSnapshots({ retentionDays: -1, client: mockClient }),
      ).rejects.toThrow("retentionDays must be a positive integer");
    });

    test("rejects fractional retention values", async () => {
      await expect(
        pruneExpiredSnapshots({ retentionDays: 30.5, client: mockClient }),
      ).rejects.toThrow("retentionDays must be a positive integer");
    });

    test("rejects non-numeric retention values", async () => {
      await expect(
        pruneExpiredSnapshots({ retentionDays: "not-a-number", client: mockClient }),
      ).rejects.toThrow("retentionDays must be a positive integer");
    });

    test("rejects retentionDays exceeding max allowed (3650)", async () => {
      await expect(
        pruneExpiredSnapshots({ retentionDays: 5000, client: mockClient }),
      ).rejects.toThrow("retentionDays must be a positive integer between 1 and 3650");
    });

    test("rejects invalid asOf date", async () => {
      await expect(
        pruneExpiredSnapshots({ asOf: "invalid-date-string", client: mockClient }),
      ).rejects.toThrow("asOf must be a valid date.");
    });
  });

  describe("ALL-time performance preservation across retention pruning", () => {
    test("preserves complete historical snapshots and guarantees ALL-time performance, baseline, TWR, and series remain intact", async () => {
      const portfolioId = "port-all-time-retention";
      const userId = "usr-all-time-retention";

      const portfolioRecord = {
        id: portfolioId,
        userId,
        name: "Historical Multi-Year Portfolio",
        startingBalance: new Prisma.Decimal("10000.00000000"),
        cashBalance: new Prisma.Decimal("5000.00000000"),
        isActive: true,
        createdAt: new Date("2025-01-01T00:00:00.000Z"),
      };

      // Create snapshots spanning > 365 days:
      // Day 1: 500 days ago (2025-07-06), totalValue = 10,000
      // Day 250: 250 days ago (2026-03-13), totalValue = 12,000, dailyPnlPct = 0.05
      // Day 500: today (2026-11-18), totalValue = 15,000, dailyPnlPct = 0.02
      const historicalSnapshots = [
        {
          id: "snap-day-1",
          portfolioId,
          snapshotDate: new Date("2025-07-06T00:00:00.000Z"),
          totalValue: new Prisma.Decimal("10000.00000000"),
          cashBalance: new Prisma.Decimal("5000.00000000"),
          holdingsValue: new Prisma.Decimal("5000.00000000"),
          dailyPnl: new Prisma.Decimal("0.00000000"),
          dailyPnlPct: new Prisma.Decimal("0.0000"),
        },
        {
          id: "snap-day-250",
          portfolioId,
          snapshotDate: new Date("2026-03-13T00:00:00.000Z"),
          totalValue: new Prisma.Decimal("12000.00000000"),
          cashBalance: new Prisma.Decimal("5000.00000000"),
          holdingsValue: new Prisma.Decimal("7000.00000000"),
          dailyPnl: new Prisma.Decimal("500.00000000"),
          dailyPnlPct: new Prisma.Decimal("0.0500"),
        },
        {
          id: "snap-day-500",
          portfolioId,
          snapshotDate: new Date("2026-11-18T00:00:00.000Z"),
          totalValue: new Prisma.Decimal("15000.00000000"),
          cashBalance: new Prisma.Decimal("5000.00000000"),
          holdingsValue: new Prisma.Decimal("10000.00000000"),
          dailyPnl: new Prisma.Decimal("300.00000000"),
          dailyPnlPct: new Prisma.Decimal("0.0200"),
        },
      ];

      let storedSnapshots = [...historicalSnapshots];

      const client = {
        portfolio: {
          findFirst: jest.fn().mockResolvedValue(portfolioRecord),
        },
        performanceSnapshot: {
          findMany: jest.fn().mockImplementation(() => Promise.resolve(storedSnapshots)),
          findFirst: jest.fn().mockResolvedValue(null),
          deleteMany: jest.fn().mockImplementation(({ where }) => {
            // Pruning only targets inactive portfolios by default
            if (where?.portfolio?.isActive === false) {
              return Promise.resolve({ count: 0 });
            }
            if (where?.snapshotDate?.lt) {
              const cutoff = where.snapshotDate.lt;
              const remaining = storedSnapshots.filter((s) => s.snapshotDate >= cutoff);
              const deleted = storedSnapshots.length - remaining.length;
              storedSnapshots = remaining;
              return Promise.resolve({ count: deleted });
            }
            return Promise.resolve({ count: 0 });
          }),
        },
        trade: {
          aggregate: jest.fn().mockResolvedValue({
            _sum: {
              realizedPnl: new Prisma.Decimal("800.00000000"),
              fees: new Prisma.Decimal("15.00000000"),
            },
            _count: { id: 2 },
          }),
        },
      };

      // 1. Record ALL-time performance before pruning
      const beforePerf = await getPortfolioPerformance(userId, portfolioId, {
        period: "ALL",
        asOf: new Date("2026-11-18T10:00:00.000Z"),
        client,
      });

      expect(beforePerf.baseline.source).toBe("period_start_snapshot");
      expect(beforePerf.baseline.date).toBe("2025-07-06");
      expect(beforePerf.baseline.totalValue).toBe("10000.00000000");
      expect(beforePerf.performance.startValue).toBe("10000.00000000");
      expect(beforePerf.performance.endValue).toBe("15000.00000000");
      expect(beforePerf.performance.netPnl).toBe("5000.00000000");
      expect(beforePerf.performance.returnPct).toBe("50.0000");
      expect(beforePerf.performance.realizedPnl).toBe("800.00000000");
      expect(beforePerf.series).toHaveLength(3);

      // 2. Run retention pruning (365 days cutoff)
      const pruneResult = await pruneExpiredSnapshots({
        retentionDays: 365,
        asOf: new Date("2026-11-18T10:00:00.000Z"),
        client,
      });
      expect(pruneResult.pruned).toBe(true);

      // 3. Request ALL-time performance again after pruning
      const afterPerf = await getPortfolioPerformance(userId, portfolioId, {
        period: "ALL",
        asOf: new Date("2026-11-18T10:00:00.000Z"),
        client,
      });

      // 4. Verify historical baseline, total return, realized P&L, TWR, and complete series remain intact
      expect(afterPerf.baseline).toEqual(beforePerf.baseline);
      expect(afterPerf.performance.startValue).toBe(beforePerf.performance.startValue);
      expect(afterPerf.performance.endValue).toBe(beforePerf.performance.endValue);
      expect(afterPerf.performance.netPnl).toBe(beforePerf.performance.netPnl);
      expect(afterPerf.performance.returnPct).toBe(beforePerf.performance.returnPct);
      expect(afterPerf.performance.realizedPnl).toBe(beforePerf.performance.realizedPnl);
      expect(afterPerf.performance.timeWeightedReturnPct).toBe(beforePerf.performance.timeWeightedReturnPct);
      expect(afterPerf.series).toHaveLength(beforePerf.series.length);
      expect(afterPerf.series[0].date).toBe("2025-07-06");
    });
  });
});
