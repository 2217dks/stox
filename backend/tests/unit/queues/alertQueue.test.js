jest.mock("../../../src/queues/index", () => ({
  getQueue: jest.fn(),
  isQueuesEnabled: jest.fn(),
  closeQueues: jest.fn(),
}));

const { getQueue } = require("../../../src/queues/index");
const {
  enqueueAlertEvaluation,
  enqueueAlertScan,
  ensureAlertScanScheduler,
  listFailedAlertJobs,
  requeueAlertEvaluation,
  retryFailedAlertJob,
} = require("../../../src/queues/alertQueue");
const { ALERT_JOB_NAMES } = require("../../../src/queues/definitions");

const ALERT_ID = "8a2e6b4d-1c3f-4d5e-9a7b-0c1d2e3f4a5b";

function makeQueue() {
  return {
    add: jest.fn(async (name, data, options) => ({
      id: options?.jobId ?? "job-1",
      name,
      data,
    })),
    getFailed: jest.fn(async () => []),
    getJob: jest.fn(),
    upsertJobScheduler: jest.fn(async () => ({ id: "scheduled-1" })),
  };
}

describe("alert queue", () => {
  let queue;

  beforeEach(() => {
    queue = makeQueue();
    getQueue.mockReturnValue(queue);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test("rejects a payload without a UUID alert id", async () => {
    await expect(
      enqueueAlertEvaluation({ alertId: "not-a-uuid" }),
    ).rejects.toMatchObject({ code: "INVALID_JOB_PAYLOAD" });

    expect(queue.add).not.toHaveBeenCalled();
  });

  test("enqueues evaluate-alert keyed by the alert id", async () => {
    const result = await enqueueAlertEvaluation({ alertId: ALERT_ID });

    expect(result).toEqual({ enqueued: true, jobId: ALERT_ID });
    expect(queue.add).toHaveBeenCalledWith(
      ALERT_JOB_NAMES.EVALUATE_ALERT,
      { alertId: ALERT_ID },
      expect.objectContaining({
        jobId: ALERT_ID,
        attempts: 2,
        removeOnComplete: true,
      }),
    );
  });

  test("normalizes a scan symbol and validates the limit", async () => {
    await enqueueAlertScan({ symbol: " aapl ", limit: 25 });

    expect(queue.add).toHaveBeenCalledWith(
      ALERT_JOB_NAMES.SCAN_ALERTS,
      { symbol: "AAPL", limit: 25 },
      expect.objectContaining({ attempts: 2 }),
    );

    await expect(enqueueAlertScan({ limit: 5000 })).rejects.toMatchObject({
      code: "INVALID_JOB_PAYLOAD",
    });
  });

  test("upserts a single repeatable alert scan scheduler", async () => {
    const result = await ensureAlertScanScheduler({ every: 5000 });

    expect(result).toEqual({ scheduled: true, jobId: "scheduled-1" });
    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      "alerts:scan",
      { every: 5000 },
      expect.objectContaining({ name: ALERT_JOB_NAMES.SCAN_ALERTS }),
    );
  });

  test("reports a scheduling failure without throwing", async () => {
    queue.upsertJobScheduler.mockRejectedValue(new Error("nope"));

    const result = await ensureAlertScanScheduler({ every: 5000 });

    expect(result).toEqual({ scheduled: false, reason: "SCHEDULE_FAILED" });
  });

  test("is a no-op when queues are disabled", async () => {
    getQueue.mockReturnValue(null);

    await expect(
      enqueueAlertEvaluation({ alertId: ALERT_ID }),
    ).resolves.toEqual({ enqueued: false, reason: "QUEUES_DISABLED" });
    await expect(ensureAlertScanScheduler()).resolves.toEqual({
      scheduled: false,
      reason: "QUEUES_DISABLED",
    });
  });

  test("maps failed jobs and retries one", async () => {
    queue.getFailed.mockResolvedValue([
      {
        id: ALERT_ID,
        name: ALERT_JOB_NAMES.EVALUATE_ALERT,
        data: { alertId: ALERT_ID },
        attemptsMade: 2,
        opts: { attempts: 2 },
        failedReason: "provider timeout",
        finishedOn: 1700000000000,
      },
    ]);

    const [failed] = await listFailedAlertJobs();
    expect(failed).toEqual(
      expect.objectContaining({
        id: ALERT_ID,
        attemptsMade: 2,
        maxAttempts: 2,
        failedReason: "provider timeout",
      }),
    );

    const job = {
      getState: jest.fn(async () => "failed"),
      retry: jest.fn(async () => {}),
    };
    queue.getJob.mockResolvedValue(job);

    await expect(retryFailedAlertJob(ALERT_ID)).resolves.toEqual({
      retried: true,
      jobId: ALERT_ID,
    });
  });

  describe("requeueAlertEvaluation", () => {
    test("adds a job when none exists", async () => {
      queue.getJob.mockResolvedValue(null);

      await expect(
        requeueAlertEvaluation({ alertId: ALERT_ID }),
      ).resolves.toEqual({ enqueued: true, jobId: ALERT_ID });
      expect(queue.add).toHaveBeenCalledTimes(1);
    });

    test("retries an existing failed job", async () => {
      const job = {
        getState: jest.fn(async () => "failed"),
        retry: jest.fn(async () => {}),
      };
      queue.getJob.mockResolvedValue(job);

      await expect(
        requeueAlertEvaluation({ alertId: ALERT_ID }),
      ).resolves.toEqual({
        enqueued: true,
        jobId: ALERT_ID,
        retried: true,
      });
      expect(job.retry).toHaveBeenCalledTimes(1);
      expect(queue.add).not.toHaveBeenCalled();
    });

    test("removes a completed job and adds a new one", async () => {
      const job = {
        getState: jest.fn(async () => "completed"),
        remove: jest.fn(async () => {}),
      };
      queue.getJob.mockResolvedValue(job);

      await expect(
        requeueAlertEvaluation({ alertId: ALERT_ID }),
      ).resolves.toEqual({ enqueued: true, jobId: ALERT_ID });
      expect(job.remove).toHaveBeenCalledTimes(1);
      expect(queue.add).toHaveBeenCalledTimes(1);
    });

    test("leaves a waiting job alone", async () => {
      queue.getJob.mockResolvedValue({
        getState: jest.fn(async () => "waiting"),
      });

      await expect(
        requeueAlertEvaluation({ alertId: ALERT_ID }),
      ).resolves.toEqual({
        enqueued: false,
        reason: "ALREADY_QUEUED",
        state: "waiting",
      });
      expect(queue.add).not.toHaveBeenCalled();
    });
  });
});
