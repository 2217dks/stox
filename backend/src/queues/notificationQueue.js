const { z } = require("zod");

const { getQueue } = require("./index");
const {
  QUEUE_NAMES,
  NOTIFICATION_JOB_NAMES,
  jobOptionsFor,
} = require("./definitions");
const { enqueue, parsePayload } = require("./enqueue");
const { listFailedJobs, retryFailedJob } = require("./failedJobs");
const logger = require("../utils/logger");

const sendNotificationPayloadSchema = z.object({
  notificationId: z.string().uuid("notificationId must be a valid UUID."),
});

const scanPendingPayloadSchema = z.object({
  limit: z.number().int().min(1).max(1000).optional(),
});

/**
 * Schedule delivery for a notification row.
 *
 * `jobId` is the notification id. The row is written before this is called and
 * is the source of truth, so a duplicate enqueue is a no-op rather than a
 * second email. The worker also re-checks the row's delivery status, which
 * covers the window after the completed job has been trimmed from Redis.
 */
async function enqueueNotificationDelivery(payload) {
  const data = parsePayload(sendNotificationPayloadSchema, payload);

  return enqueue(
    QUEUE_NAMES.NOTIFICATIONS,
    NOTIFICATION_JOB_NAMES.SEND_NOTIFICATION,
    data,
    { jobId: data.notificationId },
  );
}

async function enqueueNotificationScan(payload = {}) {
  const data = parsePayload(scanPendingPayloadSchema, payload);

  return enqueue(
    QUEUE_NAMES.NOTIFICATIONS,
    NOTIFICATION_JOB_NAMES.SCAN_PENDING,
    data,
  );
}

/**
 * Re-drive a notification that the scan found at PENDING.
 *
 * A failed `send-notification` job is retained by `removeOnFail`, and BullMQ
 * deduplicates by `jobId`, so a plain `add` with the same notification id
 * would return the failed job instead of scheduling a new attempt. Retrying
 * the existing job preserves its audit trail and attempt budget. Waiting and
 * active jobs are left alone; a completed job is removed so the row can be
 * retried if a later database update failed. The database claim in the worker
 * makes a duplicate harmless either way.
 */
async function requeueNotificationDelivery({ notificationId }) {
  const data = parsePayload(sendNotificationPayloadSchema, { notificationId });
  const queue = getQueue(QUEUE_NAMES.NOTIFICATIONS);

  if (!queue) {
    return { enqueued: false, reason: "QUEUES_DISABLED" };
  }

  const existing = await queue.getJob(data.notificationId);

  if (existing) {
    const state = await existing.getState();

    if (state === "failed") {
      const result = await retryFailedJob(
        QUEUE_NAMES.NOTIFICATIONS,
        data.notificationId,
      );

      return result.retried
        ? { enqueued: true, jobId: data.notificationId, retried: true }
        : {
            enqueued: false,
            reason: result.reason,
            state: result.state,
          };
    }

    // A completed job with a still-PENDING row can happen if the worker
    // delivered but a later database update failed. Remove the retained job so
    // a fresh attempt can be scheduled; otherwise BullMQ's jobId dedupe would
    // block the scan forever.
    if (state === "completed") {
      try {
        await existing.remove();
      } catch (error) {
        return { enqueued: false, reason: "ALREADY_QUEUED", state };
      }

      return enqueueNotificationDelivery({
        notificationId: data.notificationId,
      });
    }

    return { enqueued: false, reason: "ALREADY_QUEUED", state };
  }

  return enqueueNotificationDelivery({ notificationId: data.notificationId });
}

/**
 * Register the repeatable pending-notification scan.
 *
 * The row is written before the enqueue, so a Redis outage can leave a
 * notification at `PENDING` with no job. This scan is the fallback: it finds
 * those rows and re-enqueues delivery. The database claim in the worker makes
 * the re-enqueue safe even if the original job still exists.
 */
async function ensureNotificationScanScheduler({
  every = 30000,
  ...payload
} = {}) {
  const queue = getQueue(QUEUE_NAMES.NOTIFICATIONS);

  if (!queue) {
    return { scheduled: false, reason: "QUEUES_DISABLED" };
  }

  try {
    const data = parsePayload(scanPendingPayloadSchema, payload);

    const job = await queue.upsertJobScheduler(
      "notifications:scan-pending",
      { every },
      {
        name: NOTIFICATION_JOB_NAMES.SCAN_PENDING,
        data,
        opts: jobOptionsFor(
          QUEUE_NAMES.NOTIFICATIONS,
          NOTIFICATION_JOB_NAMES.SCAN_PENDING,
        ),
      },
    );

    return { scheduled: true, jobId: job?.id ?? null };
  } catch (error) {
    logger.error("Notification scan scheduler registration failed", {
      queue: QUEUE_NAMES.NOTIFICATIONS,
      message: error.message,
    });

    return { scheduled: false, reason: "SCHEDULE_FAILED" };
  }
}

/**
 * Operational view of failed notification jobs.
 *
 * Replaying one is safe because the worker claims delivery in the database
 * before sending: an already-delivered notification is skipped.
 */
async function listFailedNotificationJobs({ start = 0, end = 49 } = {}) {
  return listFailedJobs(QUEUE_NAMES.NOTIFICATIONS, { start, end });
}

async function retryFailedNotificationJob(jobId) {
  return retryFailedJob(QUEUE_NAMES.NOTIFICATIONS, jobId);
}

module.exports = {
  sendNotificationPayloadSchema,
  scanPendingPayloadSchema,
  enqueueNotificationDelivery,
  enqueueNotificationScan,
  ensureNotificationScanScheduler,
  listFailedNotificationJobs,
  requeueNotificationDelivery,
  retryFailedNotificationJob,
};
