const { Worker, UnrecoverableError } = require("bullmq");

const prisma = require("../config/database");
const {
  deliverNotification,
} = require("../services/notificationDeliveryService");
const {
  requeueNotificationDelivery,
} = require("../queues/notificationQueue");
const { createQueueConnection } = require("../queues/connection");
const {
  QUEUE_NAMES,
  NOTIFICATION_JOB_NAMES,
} = require("../queues/definitions");
const { childLogger } = require("../utils/logger");
const { registry } = require("../observability/metrics");

const log = childLogger({
  queue: QUEUE_NAMES.NOTIFICATIONS,
  worker: "notifications",
});

const DEFAULT_CONCURRENCY = 10;
const DEFAULT_BATCH_SIZE = 100;
const DEFAULT_MAX_DELIVERY_ATTEMPTS = 5;
const DEFAULT_DELIVERY_LEASE_MS = 5 * 60 * 1000;

const TERMINAL_DELIVERY_STATUSES = new Set([
  "DELIVERED",
  "SKIPPED",
  "FAILED",
]);

function readPositiveInteger(value, fallback) {
  const number = Number(value);

  return Number.isInteger(number) && number > 0 ? number : fallback;
}

/**
 * Deliver one notification row.
 *
 * The row is the source of truth and is written before this job is enqueued.
 * A deleted row cannot be resurrected by a retry, so it is unrecoverable.
 *
 * Idempotency is a database guard, not a Redis-only promise:
 *
 * 1. a terminal `deliveryStatus` short-circuits a replayed job;
 * 2. `PENDING -> SENDING` is a conditional update, so two workers racing for
 *    the same row produce exactly one winner;
 * 3. per-channel results are persisted, so a retry after a partial failure
 *    does not repeat a successful email or push.
 */
async function handleSendNotification(job, options = {}) {
  const { notificationId } = job.data;

  const notification = await prisma.notification.findUnique({
    where: { id: notificationId },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          emailAlerts: true,
          pushEnabled: true,
          pushToken: true,
        },
      },
    },
  });

  if (!notification) {
    throw new UnrecoverableError(
      `Notification ${notificationId} no longer exists.`,
    );
  }

  if (TERMINAL_DELIVERY_STATUSES.has(notification.deliveryStatus)) {
    return {
      outcome: "skipped",
      reason: "ALREADY_PROCESSED",
      status: notification.deliveryStatus,
    };
  }

  const maxDeliveryAttempts =
    options.maxDeliveryAttempts ??
    readPositiveInteger(
      process.env.NOTIFICATION_MAX_DELIVERY_ATTEMPTS,
      DEFAULT_MAX_DELIVERY_ATTEMPTS,
    );

  // The pending-notification scan re-drives rows left at PENDING. Without a
  // budget, a provider that never recovers would be retried forever because
  // every failed attempt resets the row to PENDING.
  if (notification.deliveryAttempts >= maxDeliveryAttempts) {
    await prisma.notification.updateMany({
      where: {
        id: notificationId,
        deliveryStatus: "PENDING",
      },
      data: {
        deliveryStatus: "FAILED",
        deliveredAt: new Date(),
        deliveryStartedAt: null,
      },
    });

    return {
      outcome: "skipped",
      reason: "DELIVERY_ATTEMPTS_EXHAUSTED",
    };
  }

  const claim = await prisma.notification.updateMany({
    where: {
      id: notificationId,
      deliveryStatus: "PENDING",
    },
    data: {
      deliveryStatus: "SENDING",
      deliveryAttempts: { increment: 1 },
      deliveryStartedAt: new Date(),
    },
  });

  if (claim.count === 0) {
    return { outcome: "skipped", reason: "CLAIMED_BY_ANOTHER_WORKER" };
  }

  const preference = await prisma.userPreference.findUnique({
    where: { userId: notification.userId },
  });

  // The channel results exist only inside the try. Hoist them so a failure of
  // the final status write can still record what was actually delivered;
  // otherwise the retry re-sends the push (FCM has no idempotency key).
  let deliveredChannels;

  try {
    const result = await deliverNotification(notification, {
      user: notification.user,
      preference,
      email: options.emailService,
      push: options.pushService,
      emit: options.emit,
    });

    deliveredChannels = result.channels;

    await prisma.notification.update({
      where: { id: notificationId },
      data: {
        deliveryStatus:
          result.outcome === "delivered" ? "DELIVERED" : "SKIPPED",
        deliveredAt: new Date(),
        deliveryStartedAt: null,
        deliveryChannels: result.channels,
      },
    });

    return result;
  } catch (error) {
    // A permanent provider rejection (bad recipient, invalid token) will not
    // improve on retry. Transient failures go back to PENDING so BullMQ's
    // backoff can reclaim the row.
    try {
      await prisma.notification.updateMany({
        where: {
          id: notificationId,
          deliveryStatus: "SENDING",
        },
        data: {
          deliveryStatus: error.permanent ? "FAILED" : "PENDING",
          deliveryChannels: error.channels ?? deliveredChannels,
          deliveredAt: error.permanent ? new Date() : null,
          deliveryStartedAt: null,
        },
      });
    } catch (resetError) {
      // Preserve the original delivery error. A failed reset is a database
      // outage; the row may stay SENDING, but surfacing the provider failure is
      // more useful for diagnosis than masking it with the reset error.
      log.error("Failed to reset notification delivery status", {
        notificationId,
        message: resetError.message,
      });
    }

    if (error.permanent) {
      throw new UnrecoverableError(error.message);
    }

    throw error;
  }
}

/**
 * Find notifications left at PENDING (for example when the original enqueue
 * timed out during a Redis outage) and enqueue delivery for each one.
 *
 * This is a discovery/enqueue mechanism only. Delivery itself happens in
 * `send-notification`, so there is one canonical delivery path.
 */
async function handleScanPending(job, options = {}) {
  const { limit } = job.data;

  const deliveryLeaseMs =
    options.deliveryLeaseMs ??
    readPositiveInteger(
      process.env.NOTIFICATION_DELIVERY_LEASE_MS,
      DEFAULT_DELIVERY_LEASE_MS,
    );

  // Reclaim rows whose worker claimed them and then crashed. Without this the
  // row would stay SENDING forever because the scan only selects PENDING.
  const staleBefore = new Date(Date.now() - deliveryLeaseMs);
  const reclaimed = await prisma.notification.updateMany({
    where: {
      deliveryStatus: "SENDING",
      deliveryStartedAt: { lt: staleBefore },
    },
    data: {
      deliveryStatus: "PENDING",
      deliveryStartedAt: null,
    },
  });

  const notifications = await prisma.notification.findMany({
    where: { deliveryStatus: "PENDING" },
    orderBy: { createdAt: "asc" },
    // A direct handler call may omit `batchSize`; never let that become an
    // unbounded query.
    take: limit ?? options.batchSize ?? DEFAULT_BATCH_SIZE,
    select: { id: true },
  });

  const results = await Promise.all(
    notifications.map((notification) =>
      requeueNotificationDelivery({ notificationId: notification.id }),
    ),
  );

  const enqueued = results.filter((result) => result.enqueued).length;

  return {
    scanned: notifications.length,
    enqueued,
    // Includes rows already queued, disabled queues, and enqueue failures.
    notEnqueued: notifications.length - enqueued,
    reclaimed: reclaimed.count,
  };
}

async function handleNotificationJob(job, options = {}) {
  switch (job.name) {
    case NOTIFICATION_JOB_NAMES.SEND_NOTIFICATION:
      return handleSendNotification(job, options);

    case NOTIFICATION_JOB_NAMES.SCAN_PENDING:
      return handleScanPending(job, options);

    default:
      throw new UnrecoverableError(
        `Unknown notification job "${job.name}".`,
      );
  }
}

function createNotificationQueueWorker({
  connection,
  concurrency = readPositiveInteger(
    process.env.QUEUE_NOTIFICATION_CONCURRENCY,
    DEFAULT_CONCURRENCY,
  ),
  emailService,
  pushService,
  emit,
  batchSize = readPositiveInteger(
    process.env.QUEUE_NOTIFICATION_BATCH_SIZE,
    DEFAULT_BATCH_SIZE,
  ),
  maxDeliveryAttempts = readPositiveInteger(
    process.env.NOTIFICATION_MAX_DELIVERY_ATTEMPTS,
    DEFAULT_MAX_DELIVERY_ATTEMPTS,
  ),
  deliveryLeaseMs = readPositiveInteger(
    process.env.NOTIFICATION_DELIVERY_LEASE_MS,
    DEFAULT_DELIVERY_LEASE_MS,
  ),
  prefix = process.env.QUEUE_PREFIX || "stox",
} = {}) {
  const queueConnection = connection || createQueueConnection();

  const worker = new Worker(
    QUEUE_NAMES.NOTIFICATIONS,
    (job) =>
      handleNotificationJob(job, {
        emailService,
        pushService,
        emit,
        batchSize,
        maxDeliveryAttempts,
        deliveryLeaseMs,
      }),
    {
      connection: queueConnection,
      concurrency,
      prefix,
    },
  );

  worker.queueConnection = queueConnection;

  worker.on("completed", (job) => {
    registry.increment("queue_jobs_completed_total", {
      queue: QUEUE_NAMES.NOTIFICATIONS,
      job: job.name,
    });

    log.info("Queue job completed", {
      jobId: job.id,
      jobName: job.name,
      attemptsMade: job.attemptsMade,
      durationMs:
        job.finishedOn && job.processedOn
          ? job.finishedOn - job.processedOn
          : null,
    });
  });

  worker.on("failed", (job, error) => {
    const maxAttempts = job?.opts?.attempts ?? 1;
    const exhausted = Boolean(job) && job.attemptsMade >= maxAttempts;

    registry.increment("queue_jobs_failed_total", {
      queue: QUEUE_NAMES.NOTIFICATIONS,
      job: job?.name ?? "unknown",
    });

    if (exhausted) {
      registry.increment("queue_jobs_exhausted_total", {
        queue: QUEUE_NAMES.NOTIFICATIONS,
        job: job.name,
      });
    }

    log.error(
      exhausted ? "Queue job exhausted its retries" : "Queue job failed",
      {
        jobId: job?.id ?? null,
        jobName: job?.name ?? null,
        notificationId: job?.data?.notificationId ?? null,
        attemptsMade: job?.attemptsMade ?? null,
        maxAttempts,
        exhausted,
        message: error?.message,
      },
    );
  });

  worker.on("error", (error) => {
    log.error("Queue worker error", {
      message: error.message,
    });
  });

  return worker;
}

module.exports = {
  DEFAULT_BATCH_SIZE,
  DEFAULT_CONCURRENCY,
  createNotificationQueueWorker,
  handleNotificationJob,
  handleScanPending,
  handleSendNotification,
};
