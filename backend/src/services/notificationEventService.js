const prisma = require("../config/database");
const { enqueueNotificationDelivery } = require("../queues/notificationQueue");
const logger = require("../utils/logger");

/**
 * Persist one notification for a domain event. A stable event key makes the
 * producer idempotent as well as the queue/worker delivery path.
 *
 * Pass a transaction client and `enqueue: false` when the source event and
 * notification row must commit atomically. Enqueue only after that transaction
 * commits; the pending-row scan recovers delivery if Redis is unavailable.
 */
async function createNotificationEvent(
  { eventKey, userId, type, title, message, data = null },
  { db = prisma, enqueue = true } = {},
) {
  if (typeof eventKey !== "string" || !eventKey.trim()) {
    throw new TypeError("A stable notification eventKey is required.");
  }

  const notification = await db.notification.upsert({
    where: { eventKey },
    create: {
      eventKey,
      userId,
      type,
      title,
      message,
      data,
    },
    update: {},
  });

  if (enqueue) {
    await enqueueNotificationEvent(notification.id);
  }

  return notification;
}

function enqueueNotificationEvent(notificationId) {
  // The database row is the source of truth. Queue errors are logged and
  // recovered by the periodic scan of PENDING notifications.
  return enqueueNotificationDelivery({ notificationId }).catch((error) => {
    logger.warn("Notification delivery enqueue failed", {
      notificationId,
      message: error.message,
    });
  });
}

module.exports = {
  createNotificationEvent,
  enqueueNotificationEvent,
};
