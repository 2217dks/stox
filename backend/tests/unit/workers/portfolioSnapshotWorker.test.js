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
      captureAllPortfolioSnapshots.mockImplementation(async ({ targetDate, asOf }) => ({
        snapshotDate: targetDate,
        asOf: asOf.toISOString(),
        totalPortfolios: 2,
        successful: 2,
        failed: 0,
        errors: [],
      }));

      // Worker runs at 00:05 on Nov 15
      const executionTime = new Date("2026-11-15T00:05:00.000Z");
      const worker = startPortfolioSnapshotWorker({
        autoStart: false,
        settlementWindowHours: 2,
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
          }),
        );
      } finally {
        worker.stop();
      }
    });
  });

  describe("restart and missed-run guardrails", () => {
    test("midday restart when previous day snapshot already in DB skips cleanly", async () => {
      const mockClient = {
        performanceSnapshot: {
          findFirst: jest.fn().mockResolvedValue({ id: "snap-yesterday" }),
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
          reason: "ALREADY_CAPTURED_IN_DB",
          snapshotDate: "2026-11-14",
        });

        // Did not run capture and did not touch today prematurely
        expect(captureAllPortfolioSnapshots).not.toHaveBeenCalled();
        expect(worker.getLastCapturedDate()).toBe("2026-11-14");
      } finally {
        worker.stop();
      }
    });

    test("midday restart when previous day snapshot was missed refuses to capture live prices", async () => {
      const mockClient = {
        performanceSnapshot: {
          findFirst: jest.fn().mockResolvedValue(null),
        },
      };

      // Midday execution at 14:30:00Z after missed morning run
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
        });

        // Refuses to silently substitute live quotes for missed EOD close
        expect(captureAllPortfolioSnapshots).not.toHaveBeenCalled();
        expect(worker.getLastCapturedDate()).toBeNull();
      } finally {
        worker.stop();
      }
    });

    test("restart within settlement window when not yet in DB executes capture for previous day", async () => {
      captureAllPortfolioSnapshots.mockResolvedValue({
        snapshotDate: "2026-11-14",
        asOf: "2026-11-14T23:59:59.999Z",
        totalPortfolios: 1,
        successful: 1,
        failed: 0,
        errors: [],
      });

      const earlyMorningTime = new Date("2026-11-15T01:15:00.000Z");
      const worker = startPortfolioSnapshotWorker({
        autoStart: false,
        settlementWindowHours: 2,
      });

      try {
        const result = await worker.run(earlyMorningTime);

        expect(result.snapshotDate).toBe("2026-11-14");
        expect(captureAllPortfolioSnapshots).toHaveBeenCalledTimes(1);
        expect(worker.getLastCapturedDate()).toBe("2026-11-14");

        // Subsequent poll in same window skips
        const secondRun = await worker.run(new Date("2026-11-15T01:30:00.000Z"));
        expect(secondRun).toEqual({
          skipped: true,
          reason: "ALREADY_CAPTURED",
          snapshotDate: "2026-11-14",
        });
        expect(captureAllPortfolioSnapshots).toHaveBeenCalledTimes(1);
      } finally {
        worker.stop();
      }
    });

    test("force option bypasses settlement window check and executes on demand", async () => {
      captureAllPortfolioSnapshots.mockResolvedValue({
        snapshotDate: "2026-11-14",
        asOf: "2026-11-14T23:59:59.999Z",
        totalPortfolios: 1,
        successful: 1,
        failed: 0,
        errors: [],
      });

      const middayTime = new Date("2026-11-15T14:30:00.000Z");
      const worker = startPortfolioSnapshotWorker({
        autoStart: false,
        settlementWindowHours: 2,
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
