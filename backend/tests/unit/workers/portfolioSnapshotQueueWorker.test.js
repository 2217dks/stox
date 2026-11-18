const { UnrecoverableError } = require("bullmq");

const {
  handleSnapshotJob,
  handleGeneratePortfolioSnapshots,
  handlePruneSnapshotRetention,
} = require("../../../src/workers/portfolioSnapshotQueueWorker");
const {
  captureDailyPortfolioSnapshots,
} = require("../../../src/workers/portfolioSnapshotWorker");
const {
  pruneExpiredSnapshots,
} = require("../../../src/services/snapshotRetentionService");
const { SNAPSHOT_JOB_NAMES } = require("../../../src/queues/definitions");

jest.mock("../../../src/workers/portfolioSnapshotWorker", () => {
  const actual = jest.requireActual("../../../src/workers/portfolioSnapshotWorker");
  return {
    ...actual,
    captureDailyPortfolioSnapshots: jest.fn(),
  };
});

jest.mock("../../../src/services/snapshotRetentionService", () => ({
  pruneExpiredSnapshots: jest.fn(),
}));

describe("portfolioSnapshotQueueWorker unit tests (Task 48.1)", () => {
  let mockClient;

  beforeEach(() => {
    jest.clearAllMocks();

    mockClient = {
      portfolio: {
        findMany: jest.fn(),
      },
      performanceSnapshot: {
        findMany: jest.fn(),
      },
    };
  });

  describe("handleGeneratePortfolioSnapshots", () => {
    test("skips execution idempotently if all active portfolios already have snapshots", async () => {
      mockClient.portfolio.findMany.mockResolvedValue([
        { id: "port-1" },
        { id: "port-2" },
      ]);
      mockClient.performanceSnapshot.findMany.mockResolvedValue([
        { portfolioId: "port-1" },
        { portfolioId: "port-2" },
      ]);

      const job = {
        name: SNAPSHOT_JOB_NAMES.GENERATE_PORTFOLIO_SNAPSHOTS,
        data: { targetDate: "2026-11-17", force: false },
      };

      const result = await handleGeneratePortfolioSnapshots(job, {
        client: mockClient,
        now: () => new Date("2026-11-18T01:00:00.000Z"), // within window
      });

      expect(result).toEqual({
        outcome: "skipped",
        reason: "ALL_PORTFOLIOS_ALREADY_CAPTURED",
        snapshotDate: "2026-11-17",
        totalPortfolios: 2,
      });

      expect(captureDailyPortfolioSnapshots).not.toHaveBeenCalled();
    });

    test("skips execution outside settlement window when not forced", async () => {
      mockClient.portfolio.findMany.mockResolvedValue([{ id: "port-1" }]);
      mockClient.performanceSnapshot.findMany.mockResolvedValue([]);

      const job = {
        name: SNAPSHOT_JOB_NAMES.GENERATE_PORTFOLIO_SNAPSHOTS,
        data: { targetDate: "2026-11-17", force: false },
      };

      // 14:00 UTC is outside window (00:00 - 02:00)
      const result = await handleGeneratePortfolioSnapshots(job, {
        client: mockClient,
        now: () => new Date("2026-11-18T14:00:00.000Z"),
      });

      expect(result).toEqual({
        outcome: "skipped",
        reason: "OUTSIDE_SETTLEMENT_WINDOW",
        targetDate: "2026-11-17",
        missingPortfoliosCount: 1,
        totalPortfolios: 1,
      });

      expect(captureDailyPortfolioSnapshots).not.toHaveBeenCalled();
    });

    test("executes capture within settlement window for missing portfolios", async () => {
      mockClient.portfolio.findMany.mockResolvedValue([
        { id: "port-1" },
        { id: "port-2" },
      ]);
      // Only port-1 has snapshot; port-2 is missing
      mockClient.performanceSnapshot.findMany.mockResolvedValue([
        { portfolioId: "port-1" },
      ]);

      captureDailyPortfolioSnapshots.mockResolvedValue({
        snapshotDate: "2026-11-17",
        totalPortfolios: 2,
        attempted: 1,
        successful: 1,
        failed: 0,
        errors: [],
      });

      const job = {
        name: SNAPSHOT_JOB_NAMES.GENERATE_PORTFOLIO_SNAPSHOTS,
        data: { targetDate: "2026-11-17", force: false },
      };

      const result = await handleGeneratePortfolioSnapshots(job, {
        client: mockClient,
        now: () => new Date("2026-11-18T01:30:00.000Z"),
      });

      expect(result.outcome).toBe("completed");
      expect(result.successful).toBe(1);
      expect(captureDailyPortfolioSnapshots).toHaveBeenCalledWith(
        expect.objectContaining({
          targetDate: "2026-11-17",
          portfolioIds: ["port-2"],
          force: false,
        }),
      );
    });

    test("executes capture when force is true even if outside settlement window", async () => {
      mockClient.portfolio.findMany.mockResolvedValue([{ id: "port-1" }]);
      mockClient.performanceSnapshot.findMany.mockResolvedValue([{ portfolioId: "port-1" }]);

      captureDailyPortfolioSnapshots.mockResolvedValue({
        snapshotDate: "2026-11-17",
        totalPortfolios: 1,
        attempted: 1,
        successful: 1,
        failed: 0,
        errors: [],
      });

      const job = {
        name: SNAPSHOT_JOB_NAMES.GENERATE_PORTFOLIO_SNAPSHOTS,
        data: { targetDate: "2026-11-17", force: true },
      };

      const result = await handleGeneratePortfolioSnapshots(job, {
        client: mockClient,
        now: () => new Date("2026-11-18T15:00:00.000Z"),
      });

      expect(result.outcome).toBe("completed");
      expect(captureDailyPortfolioSnapshots).toHaveBeenCalledWith(
        expect.objectContaining({
          targetDate: "2026-11-17",
          force: true,
        }),
      );
    });

    test("throws an error when snapshot generation experiences failures for operational visibility and retry", async () => {
      mockClient.portfolio.findMany.mockResolvedValue([{ id: "port-fail" }]);
      mockClient.performanceSnapshot.findMany.mockResolvedValue([]);

      captureDailyPortfolioSnapshots.mockResolvedValue({
        snapshotDate: "2026-11-17",
        totalPortfolios: 1,
        attempted: 1,
        successful: 0,
        failed: 1,
        errors: [{ portfolioId: "port-fail", error: "Price provider unavailable" }],
      });

      const job = {
        name: SNAPSHOT_JOB_NAMES.GENERATE_PORTFOLIO_SNAPSHOTS,
        data: { targetDate: "2026-11-17", force: false },
      };

      await expect(
        handleGeneratePortfolioSnapshots(job, {
          client: mockClient,
          now: () => new Date("2026-11-18T01:00:00.000Z"),
        }),
      ).rejects.toThrow("Snapshot generation for 2026-11-17 failed for 1/1 portfolios.");
    });
  });

  describe("handlePruneSnapshotRetention", () => {
    test("delegates to pruneExpiredSnapshots service", async () => {
      pruneExpiredSnapshots.mockResolvedValue({
        pruned: true,
        cutoffDate: "2025-11-18",
        deletedCount: 5,
        retentionDays: 365,
      });

      const job = {
        name: SNAPSHOT_JOB_NAMES.PRUNE_SNAPSHOT_RETENTION,
        data: { retentionDays: 365 },
      };

      const result = await handlePruneSnapshotRetention(job, { client: mockClient });

      expect(result).toEqual({
        outcome: "completed",
        pruned: true,
        cutoffDate: "2025-11-18",
        deletedCount: 5,
        retentionDays: 365,
      });
      expect(pruneExpiredSnapshots).toHaveBeenCalledWith(
        expect.objectContaining({ retentionDays: 365, client: mockClient }),
      );
    });
  });

  describe("handleSnapshotJob router", () => {
    test("throws UnrecoverableError for unrecognized job name", async () => {
      const job = { name: "invalid-job-name", data: {} };

      await expect(handleSnapshotJob(job)).rejects.toThrow(UnrecoverableError);
    });
  });
});
