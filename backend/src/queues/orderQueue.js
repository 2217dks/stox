const { z } = require("zod");

const { getQueue } = require("./index");
const {
  QUEUE_NAMES,
  ORDER_JOB_NAMES,
  jobOptionsFor,
} = require("./definitions");
const {
  DEFAULT_ENQUEUE_TIMEOUT_MS,
  enqueue,
  parsePayload,
} = require("./enqueue");
const { listFailedJobs, retryFailedJob } = require("./failedJobs");
const logger = require("../utils/logger");

const executeOrderPayloadSchema = z.object({
  orderId: z.string().uuid("orderId must be a valid UUID."),
  portfolioId: z.string().uuid("portfolioId must be a valid UUID.").optional(),
});

const scanPendingPayloadSchema = z.object({
  portfolioId: z.string().uuid("portfolioId must be a valid UUID.").optional(),
  limit: z.number().int().min(1).max(1000).optional(),
});

/**
 * Schedule execution for one order.
 *
 * `jobId` is the order id, so enqueueing the same order twice while a job is
 * still waiting, active, or delayed returns the existing job instead of
 * stacking duplicate executions. Completed jobs are removed by the
 * execute-order policy, so a resting order can be enqueued again on a later
 * scan; execution itself is conditional on `PENDING`, so even a duplicate
 * would be a harmless no-op.
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
  return listFailedJobs(QUEUE_NAMES.ORDERS, { start, end });
}

async function retryFailedOrderJob(jobId) {
  return retryFailedJob(QUEUE_NAMES.ORDERS, jobId);
}

module.exports = {
  DEFAULT_ENQUEUE_TIMEOUT_MS,
  executeOrderPayloadSchema,
  scanPendingPayloadSchema,
  enqueueOrderExecution,
  enqueuePendingOrderScan,
  ensureOrderScanScheduler,
  listFailedOrderJobs,
  retryFailedOrderJob,
};
