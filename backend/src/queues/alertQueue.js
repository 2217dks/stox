const { z } = require("zod");

const { getQueue } = require("./index");
const {
  QUEUE_NAMES,
  ALERT_JOB_NAMES,
  jobOptionsFor,
} = require("./definitions");
const { enqueue, parsePayload } = require("./enqueue");
const { listFailedJobs, retryFailedJob } = require("./failedJobs");
const logger = require("../utils/logger");

const evaluateAlertPayloadSchema = z.object({
  alertId: z.string().uuid("alertId must be a valid UUID."),
});

const scanAlertsPayloadSchema = z.object({
  symbol: z
    .string()
    .trim()
    .min(1, "symbol must not be empty.")
    .max(20, "symbol is too long.")
    .transform((value) => value.toUpperCase())
    .optional(),
  limit: z.number().int().min(1).max(1000).optional(),
});

/**
 * Evaluate one alert now.
 *
 * `jobId` is the alert id. Completed jobs are removed by the queue policy so
 * the same alert can be evaluated again later; the conditional
 * `ACTIVE -> TRIGGERED` update is the real guard against a double trigger.
 */
async function enqueueAlertEvaluation(payload) {
  const data = parsePayload(evaluateAlertPayloadSchema, payload);

  return enqueue(QUEUE_NAMES.ALERTS, ALERT_JOB_NAMES.EVALUATE_ALERT, data, {
    jobId: data.alertId,
  });
}

async function enqueueAlertScan(payload = {}) {
  const data = parsePayload(scanAlertsPayloadSchema, payload);

  return enqueue(QUEUE_NAMES.ALERTS, ALERT_JOB_NAMES.SCAN_ALERTS, data);
}

/**
 * Re-drive an alert evaluation that was left behind by a retained job.
 *
 * Mirrors `requeueNotificationDelivery`: a failed job is retried in place, a
 * completed job is removed before a fresh attempt, and waiting/active jobs are
 * left alone. The conditional `ACTIVE -> TRIGGERED` update remains the real
 * double-trigger guard.
 */
async function requeueAlertEvaluation({ alertId }) {
  const data = parsePayload(evaluateAlertPayloadSchema, { alertId });
  const queue = getQueue(QUEUE_NAMES.ALERTS);

  if (!queue) {
    return { enqueued: false, reason: "QUEUES_DISABLED" };
  }

  const existing = await queue.getJob(data.alertId);

  if (existing) {
    const state = await existing.getState();

    if (state === "failed") {
      const result = await retryFailedJob(QUEUE_NAMES.ALERTS, data.alertId);

      return result.retried
        ? { enqueued: true, jobId: data.alertId, retried: true }
        : {
            enqueued: false,
            reason: result.reason,
            state: result.state,
          };
    }

    if (state === "completed") {
      try {
        await existing.remove();
      } catch (error) {
        return { enqueued: false, reason: "ALREADY_QUEUED", state };
      }

      return enqueueAlertEvaluation({ alertId: data.alertId });
    }

    return { enqueued: false, reason: "ALREADY_QUEUED", state };
  }

  return enqueueAlertEvaluation({ alertId: data.alertId });
}

/**
 * Register the repeatable alert scan.
 *
 * A single scheduler id (`alerts:scan`) guarantees one schedule even when
 * several worker processes start at once. BullMQ deduplicates by id, so calling
 * it again just updates the interval.
 */
async function ensureAlertScanScheduler({ every = 15000, ...payload } = {}) {
  const queue = getQueue(QUEUE_NAMES.ALERTS);

  if (!queue) {
    return { scheduled: false, reason: "QUEUES_DISABLED" };
  }

  try {
    const data = parsePayload(scanAlertsPayloadSchema, payload);

    const job = await queue.upsertJobScheduler(
      "alerts:scan",
      { every },
      {
        name: ALERT_JOB_NAMES.SCAN_ALERTS,
        data,
        opts: jobOptionsFor(QUEUE_NAMES.ALERTS, ALERT_JOB_NAMES.SCAN_ALERTS),
      },
    );

    return { scheduled: true, jobId: job?.id ?? null };
  } catch (error) {
    logger.error("Alert scan scheduler registration failed", {
      queue: QUEUE_NAMES.ALERTS,
      message: error.message,
    });

    return { scheduled: false, reason: "SCHEDULE_FAILED" };
  }
}

async function listFailedAlertJobs({ start = 0, end = 49 } = {}) {
  return listFailedJobs(QUEUE_NAMES.ALERTS, { start, end });
}

async function retryFailedAlertJob(jobId) {
  return retryFailedJob(QUEUE_NAMES.ALERTS, jobId);
}

module.exports = {
  evaluateAlertPayloadSchema,
  scanAlertsPayloadSchema,
  enqueueAlertEvaluation,
  enqueueAlertScan,
  ensureAlertScanScheduler,
  listFailedAlertJobs,
  requeueAlertEvaluation,
  retryFailedAlertJob,
};
