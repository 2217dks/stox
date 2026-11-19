const { Worker, UnrecoverableError } = require("bullmq");

process.env.QUEUES_ENABLED = "true";
process.env.QUEUE_PREFIX = `stox-test-${process.pid}-${Date.now()}`;

const {
  getQueue,
  closeQueues,
} = require("../../src/queues");
const { createQueueConnection } = require("../../src/queues/connection");
const {
  QUEUE_NAMES,
  ORDER_JOB_NAMES,
} = require("../../src/queues/definitions");
const {
  ensureOrderScanScheduler,
  listFailedOrderJobs,
  retryFailedOrderJob,
} = require("../../src/queues/orderQueue");

const PREFIX = process.env.QUEUE_PREFIX;

// Owned by the tests so `afterEach` can close both the worker and the
// caller-supplied Redis connection (BullMQ does not close it).
const workers = [];

async function waitFor(predicate, { timeoutMs = 8000, intervalMs = 25 } = {}) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (await predicate()) {
      return true;
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error("Timed out waiting for condition.");
}

function startWorker(processor, { prefix = PREFIX } = {}) {
  const connection = createQueueConnection();

  const worker = new Worker(QUEUE_NAMES.ORDERS, processor, {
    connection,
    prefix,
    concurrency: 1,
  });

  // BullMQ does not close a caller-supplied connection, so the test owns it.
  workers.push({ worker, connection });

  return worker;
}

describe("BullMQ queue foundation", () => {
  afterEach(async () => {
    while (workers.length > 0) {
      const { worker, connection } = workers.pop();

      try {
        await worker.close();
      } catch (error) {
        // Already closed.
      }

      if (connection.status !== "end") {
        try {
          await connection.quit();
        } catch (error) {
          connection.disconnect();
        }
      }
    }
  });

  afterAll(async () => {
    const queue = getQueue(QUEUE_NAMES.ORDERS);

    if (queue) {
      await queue.obliterate({ force: true }).catch(() => {});
    }

    await closeQueues();
    process.env.QUEUES_ENABLED = "false";
  });

  test("processes a job end to end with the real Redis backend", async () => {
    const queue = getQueue(QUEUE_NAMES.ORDERS);
    const processed = [];

    startWorker(async (job) => {
      processed.push(job.data);
      return { ok: true };
    });

    const job = await queue.add(ORDER_JOB_NAMES.SCAN_PENDING, { limit: 1 });

    await waitFor(() => processed.length === 1);

    expect(processed[0]).toEqual({ limit: 1 });
    expect(await job.getState()).toBe("completed");
  });

  test("retries a transient failure with backoff and eventually completes", async () => {
    const queue = getQueue(QUEUE_NAMES.ORDERS);
    let attempts = 0;

    startWorker(async () => {
      attempts += 1;

      if (attempts < 3) {
        throw new Error("transient provider timeout");
      }

      return "ok";
    });

    const job = await queue.add(
      ORDER_JOB_NAMES.EXECUTE_ORDER,
      { orderId: "6f1f7c2e-0d7f-4c2a-9b8f-2f9a1d0c3b4e" },
      { attempts: 3, backoff: { type: "fixed", delay: 25 } },
    );

    await waitFor(async () => (await job.getState()) === "completed");

    const completed = await queue.getJob(job.id);

    expect(attempts).toBe(3);
    expect(completed.attemptsMade).toBe(3);
  });

  test("does not retry an UnrecoverableError", async () => {
    const queue = getQueue(QUEUE_NAMES.ORDERS);
    let attempts = 0;

    startWorker(async () => {
      attempts += 1;
      throw new UnrecoverableError("order no longer exists");
    });

    const job = await queue.add(
      ORDER_JOB_NAMES.EXECUTE_ORDER,
      { orderId: "6f1f7c2e-0d7f-4c2a-9b8f-2f9a1d0c3b4e" },
      { attempts: 5, backoff: { type: "fixed", delay: 10 } },
    );

    await waitFor(async () => (await job.getState()) === "failed");

    const failed = await queue.getJob(job.id);

    expect(attempts).toBe(1);
    expect(failed.attemptsMade).toBe(1);
  });

  test("retains failed jobs for inspection and supports replay", async () => {
    const queue = getQueue(QUEUE_NAMES.ORDERS);
    let shouldFail = true;

    startWorker(async () => {
      if (shouldFail) {
        throw new Error("permanent provider rejection");
      }

      return "ok";
    });

    const job = await queue.add(
      ORDER_JOB_NAMES.EXECUTE_ORDER,
      { orderId: "6f1f7c2e-0d7f-4c2a-9b8f-2f9a1d0c3b4e" },
      { attempts: 1, removeOnFail: { count: 100 } },
    );

    await waitFor(async () => (await job.getState()) === "failed");

    const failed = await listFailedOrderJobs();

    expect(failed).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: job.id,
          name: ORDER_JOB_NAMES.EXECUTE_ORDER,
          attemptsMade: 1,
          maxAttempts: 1,
          failedReason: expect.stringContaining("permanent provider rejection"),
        }),
      ]),
    );

    shouldFail = false;
    await expect(retryFailedOrderJob(job.id)).resolves.toEqual({
      retried: true,
      jobId: job.id,
    });

    await waitFor(async () => (await job.getState()) === "completed");
  });

  test("upserts a single repeatable scan scheduler", async () => {
    const queue = getQueue(QUEUE_NAMES.ORDERS);

    await ensureOrderScanScheduler({ every: 60000 });

    const schedulers = await queue.getJobSchedulers();
    const scheduler = schedulers.find(
      (entry) => entry.key === "orders:scan-pending",
    );

    expect(scheduler).toBeDefined();
    expect(scheduler.name).toBe(ORDER_JOB_NAMES.SCAN_PENDING);

    await queue.removeJobScheduler("orders:scan-pending");
  });

  test("is a no-op when queues are disabled", () => {
    const previous = process.env.QUEUES_ENABLED;
    process.env.QUEUES_ENABLED = "false";

    try {
      expect(getQueue(QUEUE_NAMES.ORDERS)).toBeNull();
    } finally {
      process.env.QUEUES_ENABLED = previous;
    }
  });
});
