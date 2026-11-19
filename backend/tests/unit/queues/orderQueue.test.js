jest.mock("../../../src/queues/index", () => ({
  getQueue: jest.fn(),
  isQueuesEnabled: jest.fn(),
  closeQueues: jest.fn(),
}));

const { getQueue } = require("../../../src/queues/index");
const {
  enqueueOrderExecution,
  enqueuePendingOrderScan,
  ensureOrderScanScheduler,
  listFailedOrderJobs,
  retryFailedOrderJob,
} = require("../../../src/queues/orderQueue");
const { QUEUE_NAMES, ORDER_JOB_NAMES } = require("../../../src/queues/definitions");

const ORDER_ID = "6f1f7c2e-0d7f-4c2a-9b8f-2f9a1d0c3b4e";
const PORTFOLIO_ID = "0b6d5a1c-2f3e-4a5b-8c9d-1e2f3a4b5c6d";

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

describe("order queue", () => {
  let queue;

  beforeEach(() => {
    queue = makeQueue();
    getQueue.mockReturnValue(queue);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("enqueueOrderExecution", () => {
    test("validates the payload and rejects a non-UUID order id", async () => {
      await expect(
        enqueueOrderExecution({ orderId: "not-a-uuid" }),
      ).rejects.toMatchObject({
        statusCode: 400,
        code: "INVALID_JOB_PAYLOAD",
      });

      expect(queue.add).not.toHaveBeenCalled();
    });

    test("enqueues an execute-order job keyed by the order id", async () => {
      const result = await enqueueOrderExecution({
        orderId: ORDER_ID,
        portfolioId: PORTFOLIO_ID,
      });

      expect(result).toEqual({ enqueued: true, jobId: ORDER_ID });
      expect(queue.add).toHaveBeenCalledWith(
        ORDER_JOB_NAMES.EXECUTE_ORDER,
        { orderId: ORDER_ID, portfolioId: PORTFOLIO_ID },
        expect.objectContaining({
          jobId: ORDER_ID,
          attempts: 5,
          backoff: { type: "exponential", delay: 1000 },
          // Removed on completion so a later scan can re-enqueue the same
          // order id while the order is still PENDING.
          removeOnComplete: true,
        }),
      );
    });

    test("is a no-op when queues are disabled", async () => {
      getQueue.mockReturnValue(null);

      const result = await enqueueOrderExecution({ orderId: ORDER_ID });

      expect(result).toEqual({ enqueued: false, reason: "QUEUES_DISABLED" });
      expect(queue.add).not.toHaveBeenCalled();
    });

    test("retries a retained failed job instead of being deduplicated by its id", async () => {
      const retry = jest.fn(async () => {});
      queue.getJob.mockResolvedValue({
        id: ORDER_ID,
        getState: async () => "failed",
        retry,
      });

      const result = await enqueueOrderExecution({ orderId: ORDER_ID });

      expect(retry).toHaveBeenCalledTimes(1);
      expect(queue.add).not.toHaveBeenCalled();
      expect(result).toEqual({
        enqueued: true,
        jobId: ORDER_ID,
        retried: true,
      });
    });

    test("removes a completed job so the order can be enqueued again", async () => {
      const remove = jest.fn(async () => {});
      queue.getJob.mockResolvedValue({
        id: ORDER_ID,
        getState: async () => "completed",
        remove,
      });

      const result = await enqueueOrderExecution({ orderId: ORDER_ID });

      expect(remove).toHaveBeenCalledTimes(1);
      expect(queue.add).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ enqueued: true, jobId: ORDER_ID });
    });

    test("leaves a waiting job alone", async () => {
      queue.getJob.mockResolvedValue({
        id: ORDER_ID,
        getState: async () => "waiting",
      });

      const result = await enqueueOrderExecution({ orderId: ORDER_ID });

      expect(queue.add).not.toHaveBeenCalled();
      expect(result).toEqual({
        enqueued: false,
        reason: "ALREADY_QUEUED",
        state: "waiting",
      });
    });

    test("never throws when Redis rejects the enqueue", async () => {
      queue.add.mockRejectedValue(new Error("redis down"));

      const result = await enqueueOrderExecution({ orderId: ORDER_ID });

      expect(result).toEqual({ enqueued: false, reason: "ENQUEUE_FAILED" });
    });

    test("times out instead of hanging when Redis never answers", async () => {
      const previous = process.env.QUEUE_ENQUEUE_TIMEOUT_MS;
      process.env.QUEUE_ENQUEUE_TIMEOUT_MS = "20";

      try {
        // A disconnected Redis with maxRetriesPerRequest: null never settles.
        queue.add.mockReturnValue(new Promise(() => {}));

        const result = await enqueueOrderExecution({ orderId: ORDER_ID });

        expect(result).toEqual({ enqueued: false, reason: "ENQUEUE_TIMEOUT" });
      } finally {
        if (previous === undefined) {
          delete process.env.QUEUE_ENQUEUE_TIMEOUT_MS;
        } else {
          process.env.QUEUE_ENQUEUE_TIMEOUT_MS = previous;
        }
      }
    });
  });

  describe("enqueuePendingOrderScan", () => {
    test("enqueues a scan job with optional filters", async () => {
      const result = await enqueuePendingOrderScan({
        portfolioId: PORTFOLIO_ID,
        limit: 25,
      });

      expect(result.enqueued).toBe(true);
      expect(queue.add).toHaveBeenCalledWith(
        ORDER_JOB_NAMES.SCAN_PENDING,
        { portfolioId: PORTFOLIO_ID, limit: 25 },
        expect.objectContaining({ attempts: 3 }),
      );
    });

    test("rejects an out-of-range limit", async () => {
      await expect(enqueuePendingOrderScan({ limit: 5000 })).rejects.toMatchObject(
        { code: "INVALID_JOB_PAYLOAD" },
      );
    });
  });

  describe("ensureOrderScanScheduler", () => {
    test("upserts a single repeatable scan scheduler", async () => {
      const result = await ensureOrderScanScheduler({ every: 5000 });

      expect(result).toEqual({ scheduled: true, jobId: "scheduled-1" });
      expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
        "orders:scan-pending",
        { every: 5000 },
        expect.objectContaining({ name: ORDER_JOB_NAMES.SCAN_PENDING }),
      );
    });

    test("reports a scheduling failure without throwing", async () => {
      queue.upsertJobScheduler.mockRejectedValue(new Error("nope"));

      const result = await ensureOrderScanScheduler({ every: 5000 });

      expect(result).toEqual({ scheduled: false, reason: "SCHEDULE_FAILED" });
    });
  });

  describe("failed-job inspection", () => {
    test("maps failed jobs to a safe, serializable summary", async () => {
      queue.getFailed.mockResolvedValue([
        {
          id: "job-1",
          name: ORDER_JOB_NAMES.EXECUTE_ORDER,
          data: { orderId: ORDER_ID },
          attemptsMade: 5,
          opts: { attempts: 5 },
          failedReason: "provider timeout",
          finishedOn: 1700000000000,
        },
      ]);

      const [failed] = await listFailedOrderJobs();

      expect(failed).toEqual({
        id: "job-1",
        name: ORDER_JOB_NAMES.EXECUTE_ORDER,
        data: { orderId: ORDER_ID },
        attemptsMade: 5,
        maxAttempts: 5,
        failedReason: "provider timeout",
        failedAt: new Date(1700000000000).toISOString(),
      });
    });

    test("returns an empty list when queues are disabled", async () => {
      getQueue.mockReturnValue(null);

      await expect(listFailedOrderJobs()).resolves.toEqual([]);
    });

    test("retries a failed job", async () => {
      const job = {
        getState: jest.fn(async () => "failed"),
        retry: jest.fn(async () => {}),
      };
      queue.getJob.mockResolvedValue(job);

      const result = await retryFailedOrderJob("job-1");

      expect(result).toEqual({ retried: true, jobId: "job-1" });
      expect(job.retry).toHaveBeenCalledTimes(1);
    });

    test("does not retry a job that is not failed", async () => {
      queue.getJob.mockResolvedValue({
        getState: jest.fn(async () => "completed"),
        retry: jest.fn(),
      });

      const result = await retryFailedOrderJob("job-1");

      expect(result).toEqual({
        retried: false,
        reason: "NOT_FAILED",
        state: "completed",
      });
    });

    test("reports a missing job", async () => {
      queue.getJob.mockResolvedValue(null);

      await expect(retryFailedOrderJob("missing")).resolves.toEqual({
        retried: false,
        reason: "NOT_FOUND",
      });
    });
  });
});
