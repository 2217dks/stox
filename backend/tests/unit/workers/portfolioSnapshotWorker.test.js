const {
  DEFAULT_SNAPSHOT_INTERVAL_MS,
  DEFAULT_SETTLEMENT_WINDOW_HOURS,
  toUtcDateString,
  getPreviousUtcDateString,
  getUtcEndOfDay,
  isWithinSettlementWindow,
  captureDailyPortfolioSnapshots,
  startPortfolioSnapshotWorker,
} = require("../../../src/workers/portfolioSnapshotWorker");
const {
  captureAllPortfolioSnapshots,
} = require("../../../src/services/portfolioSnapshotService");

jest.mock("../../../src/services/portfolioSnapshotService", () => ({
  captureAllPortfolioSnapshots: jest.fn(),
  capturePortfolioSnapshot: jest.fn(),
}));

describe("portfolioSnapshotWorker unit tests", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("date and settlement window helpers", () => {
    test("toUtcDateString formats Date objects and string inputs canonically", () => {
      expect(toUtcDateString(new Date("2026-11-14T23:59:59.999Z"))).toBe("2026-11-14");
      expect(toUtcDateString("2026-11-14")).toBe("2026-11-14");
      expect(toUtcDateString("2026-11-14T05:30:00.000Z")).toBe("2026-11-14");
    });

    test("getPreviousUtcDateString calculates yesterday UTC across date, month, and year boundaries", () => {
      // Normal mid-month day
      expect(getPreviousUtcDateString(new Date("2026-11-15T00:05:00.000Z"))).toBe("2026-11-14");
      // First day of month
      expect(getPreviousUtcDateString(new Date("2026-11-01T00:00:00.000Z"))).toBe("2026-10-31");
      // First day of year (year rollover)
      expect(getPreviousUtcDateString(new Date("2026-01-01T00:01:00.000Z"))).toBe("2025-12-31");
    });

    test("getUtcEndOfDay constructs exact 23:59:59.999Z timestamp for target date", () => {
      const eod = getUtcEndOfDay("2026-11-14");
      expect(eod.toISOString()).toBe("2026-11-14T23:59:59.999Z");
    });

    test("isWithinSettlementWindow enforces allowable post-midnight UTC hours", () => {
      // Within 2-hour window: 00:00 to 01:59 UTC
      expect(isWithinSettlementWindow(new Date("2026-11-15T00:05:00.000Z"), 2)).toBe(true);
      expect(isWithinSettlementWindow(new Date("2026-11-15T01:59:59.999Z"), 2)).toBe(true);

      // Outside window: 02:00 UTC and mid-day
      expect(isWithinSettlementWindow(new Date("2026-11-15T02:00:00.000Z"), 2)).toBe(false);
      expect(isWithinSettlementWindow(new Date("2026-11-15T14:30:00.000Z"), 2)).toBe(false);
    });
  });

  describe("snapshot timestamp and date relationship", () => {
    test("captureDailyPortfolioSnapshots sets snapshotDate and EOD asOf timestamp", async () => {
      const mockResult = {
        snapshotDate: "2026-11-14",
        asOf: "2026-11-14T23:59:59.999Z",
        totalPortfolios: 3,
        alreadyCaptured: 0,
        attempted: 3,
        successful: 3,
        failed: 0,
        errors: [],
      };
      captureAllPortfolioSnapshots.mockResolvedValue(mockResult);

      const result = await captureDailyPortfolioSnapshots({
        targetDate: "2026-11-14",
      });

      expect(result).toEqual(mockResult);
      expect(captureAllPortfolioSnapshots).toHaveBeenCalledWith(
        expect.objectContaining({
          targetDate: "2026-11-14",
          asOf: new Date("2026-11-14T23:59:59.999Z"),
        }),
      );
    });

    test("date boundary: execution shortly after midnight UTC captures previous day EOD", async () => {
      const mockClient = {
        portfolio: {
          findMany: jest.fn().mockResolvedValue([{ id: "port-1" }, { id: "port-2" }]),
        },
        performanceSnapshot: {
          findMany: jest.fn().mockResolvedValue([]),
        },
      };

      captureAllPortfolioSnapshots.mockImplementation(async ({ targetDate, asOf }) => ({
        snapshotDate: targetDate,
        asOf: asOf.toISOString(),
        totalPortfolios: 2,
        alreadyCaptured: 0,
        attempted: 2,
        successful: 2,
        failed: 0,
        errors: [],
      }));

      // Worker runs at 00:05 on Nov 15
      const executionTime = new Date("2026-11-15T00:05:00.000Z");
      const worker = startPortfolioSnapshotWorker({
        autoStart: false,
        settlementWindowHours: 2,
        client: mockClient,
      });

      try {
        const result = await worker.run(executionTime);

        // Snapshot is labeled for Nov 14, valued as of Nov 14 23:59:59.999Z
        expect(result.snapshotDate).toBe("2026-11-14");
        expect(result.asOf).toBe("2026-11-14T23:59:59.999Z");
        expect(worker.getLastCapturedDate()).toBe("2026-11-14");

        expect(captureAllPortfolioSnapshots).toHaveBeenCalledWith(
          expect.objectContaining({
            targetDate: "2026-11-14",
            asOf: new Date("2026-11-14T23:59:59.999Z"),
            portfolioIds: ["port-1", "port-2"],
          }),
        );
      } finally {
        worker.stop();
      }
    });
  });

  describe("per-portfolio restart and retry guardrails", () => {
    test("midday restart when all active portfolios already have snapshots skips cleanly", async () => {
      const mockClient = {
        portfolio: {
          findMany: jest.fn().mockResolvedValue([{ id: "port-1" }, { id: "port-2" }]),
        },
        performanceSnapshot: {
          findMany: jest.fn().mockResolvedValue([
            { portfolioId: "port-1" },
            { portfolioId: "port-2" },
          ]),
        },
      };

      // Midday execution at 14:30:00Z (outside 00:00-02:00 window)
      const middayTime = new Date("2026-11-15T14:30:00.000Z");
      const worker = startPortfolioSnapshotWorker({
        autoStart: false,
        settlementWindowHours: 2,
        client: mockClient,
      });

      try {
        const result = await worker.run(middayTime);

        expect(result).toEqual({
          skipped: true,
          reason: "ALL_PORTFOLIOS_ALREADY_CAPTURED",
          snapshotDate: "2026-11-14",
          totalPortfolios: 2,
        });

        // Did not run capture and did not touch today prematurely
        expect(captureAllPortfolioSnapshots).not.toHaveBeenCalled();
        expect(worker.getLastCapturedDate()).toBe("2026-11-14");
      } finally {
        worker.stop();
      }
    });

    test("midday restart when snapshots are missing refuses to capture live prices", async () => {
      const mockClient = {
        portfolio: {
          findMany: jest.fn().mockResolvedValue([{ id: "port-1" }, { id: "port-2" }]),
        },
        performanceSnapshot: {
          // port-1 has snapshot, port-2 is missing!
          findMany: jest.fn().mockResolvedValue([{ portfolioId: "port-1" }]),
        },
      };

      // Midday execution at 14:30:00Z after missed morning run for port-2
      const middayTime = new Date("2026-11-15T14:30:00.000Z");
      const worker = startPortfolioSnapshotWorker({
        autoStart: false,
        settlementWindowHours: 2,
        client: mockClient,
      });

      try {
        const result = await worker.run(middayTime);

        expect(result).toEqual({
          skipped: true,
          reason: "OUTSIDE_SETTLEMENT_WINDOW",
          targetDate: "2026-11-14",
          missingPortfoliosCount: 1,
          totalPortfolios: 2,
        });

        // Refuses to silently substitute live quotes for missed EOD close
        expect(captureAllPortfolioSnapshots).not.toHaveBeenCalled();
        expect(worker.getLastCapturedDate()).toBeNull();
      } finally {
        worker.stop();
      }
    });

    test("mix of successful and failed portfolios: retries target ONLY missing portfolios", async () => {
      let existingInDb = [];

      const mockClient = {
        portfolio: {
          findMany: jest.fn().mockResolvedValue([
            { id: "port-success" },
            { id: "port-fail" },
          ]),
        },
        performanceSnapshot: {
          findMany: jest.fn().mockImplementation(() => Promise.resolve(existingInDb)),
        },
      };

      const worker = startPortfolioSnapshotWorker({
        autoStart: false,
        settlementWindowHours: 2,
        client: mockClient,
      });

      try {
        // Run 1: First attempt at 00:05 UTC (both portfolios missing)
        // Simulate: port-success succeeds, port-fail fails
        captureAllPortfolioSnapshots.mockResolvedValueOnce({
          snapshotDate: "2026-11-14",
          asOf: "2026-11-14T23:59:59.999Z",
          totalPortfolios: 2,
          alreadyCaptured: 0,
          attempted: 2,
          successful: 1,
          failed: 1,
          errors: [{ portfolioId: "port-fail", error: "Quote timeout" }],
        });

        const run1Time = new Date("2026-11-15T00:05:00.000Z");
        const res1 = await worker.run(run1Time);

        expect(res1.attempted).toBe(2);
        expect(res1.failed).toBe(1);
        // Because of partial failure, lastCapturedDate is NOT yet fully finalized
        expect(worker.getLastCapturedDate()).toBeNull();

        // Update DB state: port-success is now stored in DB
        existingInDb = [{ portfolioId: "port-success" }];

        // Run 2: Retry at 00:15 UTC (still within settlement window)
        // Simulate: port-fail now succeeds on retry
        captureAllPortfolioSnapshots.mockResolvedValueOnce({
          snapshotDate: "2026-11-14",
          asOf: "2026-11-14T23:59:59.999Z",
          totalPortfolios: 1,
          alreadyCaptured: 0,
          attempted: 1,
          successful: 1,
          failed: 0,
          errors: [],
        });

        const run2Time = new Date("2026-11-15T00:15:00.000Z");
        const res2 = await worker.run(run2Time);

        // Crucial invariant check: retry targeted ONLY missing portfolio ("port-fail")
        expect(captureAllPortfolioSnapshots).toHaveBeenLastCalledWith(
          expect.objectContaining({
            targetDate: "2026-11-14",
            portfolioIds: ["port-fail"],
          }),
        );
        expect(res2.successful).toBe(1);
        expect(res2.failed).toBe(0);

        // Now that all active portfolios have succeeded, date is finalized
        expect(worker.getLastCapturedDate()).toBe("2026-11-14");

        // Run 3: Subsequent poll at 00:20 UTC
        existingInDb = [
          { portfolioId: "port-success" },
          { portfolioId: "port-fail" },
        ];
        const res3 = await worker.run(new Date("2026-11-15T00:20:00.000Z"));
        expect(res3).toEqual({
          skipped: true,
          reason: "ALREADY_CAPTURED",
          snapshotDate: "2026-11-14",
        });
      } finally {
        worker.stop();
      }
    });

    test("force option bypasses settlement window check and executes on demand", async () => {
      const mockClient = {
        portfolio: {
          findMany: jest.fn().mockResolvedValue([{ id: "port-1" }]),
        },
        performanceSnapshot: {
          findMany: jest.fn().mockResolvedValue([]),
        },
      };

      captureAllPortfolioSnapshots.mockResolvedValue({
        snapshotDate: "2026-11-14",
        asOf: "2026-11-14T23:59:59.999Z",
        totalPortfolios: 1,
        alreadyCaptured: 0,
        attempted: 1,
        successful: 1,
        failed: 0,
        errors: [],
      });

      const middayTime = new Date("2026-11-15T14:30:00.000Z");
      const worker = startPortfolioSnapshotWorker({
        autoStart: false,
        settlementWindowHours: 2,
        client: mockClient,
      });

      try {
        const result = await worker.run(middayTime, { force: true });
        expect(result.snapshotDate).toBe("2026-11-14");
        expect(captureAllPortfolioSnapshots).toHaveBeenCalledTimes(1);
      } finally {
        worker.stop();
      }
    });
  });
});
