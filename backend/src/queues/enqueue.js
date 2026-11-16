const { AppError } = require("../utils/errors");
const { registry } = require("../observability/metrics");
const { withTimeout } = require("../utils/withTimeout");
const logger = require("../utils/logger");
const { getQueue } = require("./index");
const { jobOptionsFor } = require("./definitions");

// BullMQ requires `maxRetriesPerRequest: null`, so a disconnected Redis makes
// `queue.add` wait indefinitely. The API enqueues best-effort, so it must not
// pin a promise (and an offline command) forever.
const DEFAULT_ENQUEUE_TIMEOUT_MS = 1500;

function enqueueTimeoutMs() {
  const value = Number(process.env.QUEUE_ENQUEUE_TIMEOUT_MS);

  return Number.isInteger(value) && value > 0
    ? value
    : DEFAULT_ENQUEUE_TIMEOUT_MS;
}

function withTimeoutForEnqueue(promise) {
  const timeoutMs = enqueueTimeoutMs();

  return withTimeout(promise, timeoutMs, {
    message: `Queue enqueue timed out after ${timeoutMs}ms.`,
    code: "ENQUEUE_TIMEOUT",
  });
}

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
    const job = await withTimeoutForEnqueue(
      queue.add(jobName, data, {
        ...jobOptionsFor(queueName, jobName),
        ...options,
      }),
    );

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
      reason:
        error.code === "ENQUEUE_TIMEOUT" ? "ENQUEUE_TIMEOUT" : "ENQUEUE_FAILED",
      message: error.message,
    });

    return {
      enqueued: false,
      reason:
        error.code === "ENQUEUE_TIMEOUT" ? "ENQUEUE_TIMEOUT" : "ENQUEUE_FAILED",
    };
  }
}

module.exports = {
  DEFAULT_ENQUEUE_TIMEOUT_MS,
  enqueue,
  enqueueTimeoutMs,
  parsePayload,
  withTimeoutForEnqueue,
};
