jest.mock("../../../src/queues/index", () => ({
  getQueue: jest.fn(),
  isQueuesEnabled: jest.fn(),
  closeQueues: jest.fn(),
}));

const { getQueue } = require("../../../src/queues/index");
const {
  enqueuePortfolioSnapshotGeneration,
  enqueueSnapshotRetentionPrune,
  ensurePortfolioSnapshotScheduler,
  ensureSnapshotRetentionScheduler,
  listFailedSnapshotJobs,
  retryFailedSnapshotJob,
} = require("../../../src/queues/portfolioSnapshotQueue");
const { SNAPSHOT_JOB_NAMES, QUEUE_NAMES } = require("../../../src/queues/definitions");

function makeQueue() {
  return {
    add: jest.fn(async (name, data, options) => ({
      id: options?.jobId ?? "job-snap-1",
      name,
      data,
    })),
    getFailed: jest.fn(async () => []),
    getJob: jest.fn(),
    upsertJobScheduler: jest.fn(async () => ({ id: "scheduled-snap-1" })),
  };
}

describe("portfolio snapshot queue (Task 48.1)", () => {
  let queue;

  beforeEach(() => {
    queue = makeQueue();
    getQueue.mockReturnValue(queue);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test("rejects invalid targetDate format in snapshot generation payload", async () => {
    await expect(
      enqueuePortfolioSnapshotGeneration({ targetDate: "invalid-date" }),
    ).rejects.toMatchObject({ code: "INVALID_JOB_PAYLOAD" });

    expect(queue.add).not.toHaveBeenCalled();
  });

  test("enqueues snapshot generation with deduplicated jobId for targetDate", async () => {
    const result = await enqueuePortfolioSnapshotGeneration({
      targetDate: "2026-11-17",
      force: false,
    });

    expect(result).toEqual({ enqueued: true, jobId: "snapshots:2026-11-17" });
    expect(queue.add).toHaveBeenCalledWith(
      SNAPSHOT_JOB_NAMES.GENERATE_PORTFOLIO_SNAPSHOTS,
      expect.objectContaining({ targetDate: "2026-11-17", force: false }),
      expect.objectContaining({ jobId: "snapshots:2026-11-17" }),
    );
  });

  test("enqueues snapshot generation without fixed jobId when force is true", async () => {
    const result = await enqueuePortfolioSnapshotGeneration({
      targetDate: "2026-11-17",
      force: true,
    });

    expect(result.enqueued).toBe(true);
    expect(queue.add).toHaveBeenCalledWith(
      SNAPSHOT_JOB_NAMES.GENERATE_PORTFOLIO_SNAPSHOTS,
      expect.objectContaining({ targetDate: "2026-11-17", force: true }),
      expect.not.objectContaining({ jobId: "snapshots:2026-11-17" }),
    );
  });

  test("enqueues snapshot retention prune job with validated retention days", async () => {
    const result = await enqueueSnapshotRetentionPrune({ retentionDays: 180 });

    expect(result.enqueued).toBe(true);
    expect(queue.add).toHaveBeenCalledWith(
      SNAPSHOT_JOB_NAMES.PRUNE_SNAPSHOT_RETENTION,
      { retentionDays: 180 },
      expect.any(Object),
    );
  });

  test("ensurePortfolioSnapshotScheduler returns QUEUES_DISABLED when queue is null", async () => {
    getQueue.mockReturnValue(null);

    const result = await ensurePortfolioSnapshotScheduler();
    expect(result).toEqual({ scheduled: false, reason: "QUEUES_DISABLED" });
  });

  test("ensurePortfolioSnapshotScheduler registers repeatable job scheduler with UTC timezone", async () => {
    const result = await ensurePortfolioSnapshotScheduler({
      cron: "0 1 * * *",
      tz: "UTC",
    });

    expect(result).toEqual({ scheduled: true, jobId: "scheduled-snap-1" });
    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      "snapshots:daily-generate",
      { pattern: "0 1 * * *", tz: "UTC" },
      expect.objectContaining({
        name: SNAPSHOT_JOB_NAMES.GENERATE_PORTFOLIO_SNAPSHOTS,
      }),
    );
  });

  test("ensureSnapshotRetentionScheduler registers repeatable job scheduler with retention cron", async () => {
    const result = await ensureSnapshotRetentionScheduler({
      cron: "0 3 * * *",
      tz: "UTC",
    });

    expect(result).toEqual({ scheduled: true, jobId: "scheduled-snap-1" });
    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      "snapshots:retention-prune",
      { pattern: "0 3 * * *", tz: "UTC" },
      expect.objectContaining({
        name: SNAPSHOT_JOB_NAMES.PRUNE_SNAPSHOT_RETENTION,
      }),
    );
  });

  test("listFailedSnapshotJobs delegates to getFailed on the snapshots queue", async () => {
    queue.getFailed.mockResolvedValue([
      {
        id: "failed-snap-1",
        name: SNAPSHOT_JOB_NAMES.GENERATE_PORTFOLIO_SNAPSHOTS,
        data: { targetDate: "2026-11-16" },
        attemptsMade: 3,
        failedReason: "Settlement window missed",
        finishedOn: 1793318400000,
        opts: { attempts: 3 },
      },
    ]);

    const failed = await listFailedSnapshotJobs({ start: 0, end: 10 });
    expect(failed).toHaveLength(1);
    expect(failed[0].id).toBe("failed-snap-1");
    expect(failed[0].failedReason).toBe("Settlement window missed");
  });

  test("retryFailedSnapshotJob calls retry on target failed job", async () => {
    const job = {
      getState: jest.fn(async () => "failed"),
      retry: jest.fn(async () => {}),
    };
    queue.getJob.mockResolvedValue(job);

    const result = await retryFailedSnapshotJob("failed-snap-1");
    expect(result).toEqual({ retried: true, jobId: "failed-snap-1" });
    expect(job.retry).toHaveBeenCalled();
  });
});
