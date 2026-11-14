const { z } = require("zod");

const { getQueue } = require("./index");
const {
  QUEUE_NAMES,
  ORDER_JOB_NAMES,
  jobOptionsFor,
} = require("./definitions");
const { AppError } = require("../utils/errors");
const { registry } = require("../observability/metrics");
const logger = require("../utils/logger");

const executeOrderPayloadSchema = z.object({
  orderId: z.string().uuid("orderId must be a valid UUID."),
  portfolioId: z.string().uuid("portfolioId must be a valid UUID.").optional(),
});

const scanPendingPayloadSchema = z.object({
  portfolioId: z.string().uuid("portfolioId must be a valid UUID.").optional(),
  limit: z.number().int().min(1).max(1000).optional(),
});

function parsePayload(schema, payload) {
  const parsed = schema.safeParse(payload ?? {});

  if (!parsed.success) {
    throw AppError.badRequest(
      "Invalid queue job payload.",
      "INVALID_JOB_PAYLOAD",
      parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    );
  }

  return parsed.data;
}

/**
 * Add a job with the queue's retry policy.
 *
 * Enqueue failures are logged and counted, never thrown: the persisted order
 * (or alert, or notification) is the source of truth, and a Redis outage must
 * not turn a successful API call into a 500. The polling fallback and the
 * repeatable scan still pick the work up once Redis returns.
 */
async function enqueue(queueName, jobName, data, options = {}) {
  const queue = getQueue(queueName);

  if (!queue) {
    return { enqueued: false, reason: "QUEUES_DISABLED" };
  }

  try {
    const job = await queue.add(jobName, data, {
      ...jobOptionsFor(queueName, jobName),
      ...options,
    });

    registry.increment("queue_jobs_enqueued_total", {
      queue: queueName,
      job: jobName,
    });

    return { enqueued: true, jobId: job.id };
  } catch (error) {
    registry.increment("queue_enqueue_failures_total", {
      queue: queueName,
      job: jobName,
    });

    logger.error("Queue enqueue failed", {
      queue: queueName,
      job: jobName,
      message: error.message,
    });

    return { enqueued: false, reason: "ENQUEUE_FAILED" };
  }
}

/**
 * Schedule execution for one order.
 *
 * `jobId` is the order id, so enqueueing the same order twice while a job is
 * still known to BullMQ returns the existing job instead of stacking duplicate
 * executions. The execution path is also conditional on `PENDING`, so a
 * duplicate would be a harmless no-op anyway.
 */
async function enqueueOrderExecution(payload) {
  const data = parsePayload(executeOrderPayloadSchema, payload);

  return enqueue(
    QUEUE_NAMES.ORDERS,
    ORDER_JOB_NAMES.EXECUTE_ORDER,
    data,
    { jobId: data.orderId },
  );
}

async function enqueuePendingOrderScan(payload = {}) {
  const data = parsePayload(scanPendingPayloadSchema, payload);

  return enqueue(QUEUE_NAMES.ORDERS, ORDER_JOB_NAMES.SCAN_PENDING, data);
}

/**
 * Register the repeatable scan.
 *
 * A single scheduler id (`orders:scan-pending`) guarantees one schedule even
 * when several API/worker processes call this at startup. BullMQ deduplicates
 * by id, so calling it again just updates the interval.
 */
async function ensureOrderScanScheduler({ every = 5000, ...payload } = {}) {
  const queue = getQueue(QUEUE_NAMES.ORDERS);

  if (!queue) {
    return { scheduled: false, reason: "QUEUES_DISABLED" };
  }

  try {
    const data = parsePayload(scanPendingPayloadSchema, payload);

    const job = await queue.upsertJobScheduler(
      "orders:scan-pending",
      { every },
      {
        name: ORDER_JOB_NAMES.SCAN_PENDING,
        data,
        opts: jobOptionsFor(
          QUEUE_NAMES.ORDERS,
          ORDER_JOB_NAMES.SCAN_PENDING,
        ),
      },
    );

    return { scheduled: true, jobId: job?.id ?? null };
  } catch (error) {
    logger.error("Queue scheduler registration failed", {
      queue: QUEUE_NAMES.ORDERS,
      message: error.message,
    });

    return { scheduled: false, reason: "SCHEDULE_FAILED" };
  }
}

/**
 * Operational view of failed order jobs.
 *
 * Failed jobs are retained by `removeOnFail` in Redis and carry the payload,
 * attempt count, and failure reason — enough to diagnose without a separate
 * failure table. Payloads contain only identifiers, never credentials.
 */
async function listFailedOrderJobs({ start = 0, end = 49 } = {}) {
  const queue = getQueue(QUEUE_NAMES.ORDERS);

  if (!queue) {
    return [];
  }

  const jobs = await queue.getFailed(start, end);

  return jobs.map((job) => ({
    id: job.id,
    name: job.name,
    data: job.data,
    attemptsMade: job.attemptsMade,
    maxAttempts: job.opts?.attempts ?? null,
    failedReason: job.failedReason,
    failedAt: job.finishedOn
      ? new Date(job.finishedOn).toISOString()
      : null,
  }));
}

/**
 * Replay a failed job in place.
 *
 * `job.retry()` re-queues the same job with its original payload and attempt
 * budget, which is safer than adding a new job: it preserves the audit trail
 * and cannot double-enqueue while the failed job still exists under the same
 * `jobId`.
 */
async function retryFailedOrderJob(jobId) {
  const queue = getQueue(QUEUE_NAMES.ORDERS);

  if (!queue) {
    return { retried: false, reason: "QUEUES_DISABLED" };
  }

  const job = await queue.getJob(jobId);

  if (!job) {
    return { retried: false, reason: "NOT_FOUND" };
  }

  const state = await job.getState();

  if (state !== "failed") {
    return { retried: false, reason: "NOT_FAILED", state };
  }

  await job.retry();

  return { retried: true, jobId };
}

module.exports = {
  executeOrderPayloadSchema,
  scanPendingPayloadSchema,
  enqueueOrderExecution,
  enqueuePendingOrderScan,
  ensureOrderScanScheduler,
  listFailedOrderJobs,
  retryFailedOrderJob,
};
