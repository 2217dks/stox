const { emitRealtimeEvent } = require("../realtime/eventBus");
const emailService = require("./emailService");
const pushService = require("./pushService");
const { renderNotificationTemplate } = require("./notificationTemplates");
const { registry } = require("../observability/metrics");
const logger = require("../utils/logger");

const NOTIFICATIONS_NAMESPACE = "/notifications";

function serializeNotificationEvent(notification) {
  return {
    notificationId: notification.id,
    userId: notification.userId,
    type: notification.type,
    title: notification.title,
    message: notification.message,
    data: notification.data ?? null,
    createdAt: notification.createdAt
      ? new Date(notification.createdAt).toISOString()
      : null,
  };
}

/**
 * Decide which outbound channels are allowed for this notification.
 *
 * Two independent switches must both agree:
 *
 * - the user-level `UserPreference` row (`emailNotifications`,
 *   `pushNotifications`), which is the settings API's source of truth;
 * - the legacy `User` flags (`emailAlerts`, `pushEnabled`) and destination
 *   fields (`email`, `pushToken`), so an account that predates preferences
 *   still behaves the way its profile says.
 *
 * A `PRICE_ALERT` may additionally carry `data.channels = { email, push }` from
 * the alert's own `sendEmail`/`sendPush` flags. Those can only narrow delivery,
 * never widen it.
 */
function resolveChannels(notification, user, preference) {
  const prefs = preference || {};
  const alertChannels = notification.data?.channels || {};

  return {
    email:
      prefs.emailNotifications !== false &&
      user?.emailAlerts !== false &&
      Boolean(user?.email) &&
      alertChannels.email !== false,
    push:
      prefs.pushNotifications !== false &&
      user?.pushEnabled === true &&
      Boolean(user?.pushToken) &&
      alertChannels.push !== false,
  };
}

function recordChannel(channel, outcome) {
  registry.increment("notification_deliveries_total", {
    channel,
    outcome,
  });
}

/**
 * Deliver one notification through every enabled channel.
 *
 * In-app delivery is the persisted row itself; the Socket.IO emit is a live
 * hint and never required for correctness. Email and push are attempted in
 * order and their per-channel results are returned so the worker can persist
 * them and resume after a partial failure without repeating a successful send.
 *
 * A channel failure throws an Error carrying `channels` (the partial result)
 * and `permanent` (whether BullMQ should retry).
 */
async function deliverNotification(
  notification,
  {
    user,
    preference = null,
    email = emailService,
    push = pushService,
    emit = emitRealtimeEvent,
  } = {},
) {
  const channels = { ...(notification.deliveryChannels || {}) };
  const enabled = resolveChannels(notification, user, preference);
  const template = renderNotificationTemplate(notification);
  const failures = [];

  // In-app: the row already exists. The socket event is best-effort and must
  // not make delivery fail when the namespace/bridge is unavailable. A `false`
  // return means the bus is not configured, so the live hint was not sent; the
  // row is still in the inbox, but it does not count as an outbound channel.
  if (channels.inApp !== "delivered") {
    try {
      const emitted = await emit({
        namespace: NOTIFICATIONS_NAMESPACE,
        room: `user:${notification.userId}`,
        event: "notification",
        payload: serializeNotificationEvent(notification),
      });

      channels.inApp = emitted === false ? "unavailable" : "delivered";
      recordChannel(
        "in_app",
        channels.inApp === "delivered" ? "delivered" : "skipped",
      );
    } catch (error) {
      channels.inApp = "failed";
      recordChannel("in_app", "failed");
      logger.warn("Notification socket emit failed", {
        notificationId: notification.id,
        message: error.message,
      });
    }
  }

  if (
    enabled.email &&
    channels.email !== "delivered" &&
    channels.email !== "skipped"
  ) {
    try {
      const result = await email.sendEmail({
        to: user.email,
        subject: template.subject,
        html: template.html,
        text: template.text,
        idempotencyKey: `${notification.id}:email`,
      });

      channels.email = result.delivered ? "delivered" : "skipped";
      recordChannel("email", channels.email);
    } catch (error) {
      channels.email = "failed";
      recordChannel("email", "failed");
      failures.push({ channel: "email", error });
    }
  }

  if (
    enabled.push &&
    channels.push !== "delivered" &&
    channels.push !== "skipped"
  ) {
    try {
      const result = await push.sendPush({
        token: user.pushToken,
        title: template.subject,
        body: template.text,
        data: {
          notificationId: notification.id,
          type: notification.type,
        },
      });

      channels.push = result.delivered ? "delivered" : "skipped";
      recordChannel("push", channels.push);
    } catch (error) {
      channels.push = "failed";
      recordChannel("push", "failed");
      failures.push({ channel: "push", error });
    }
  }

  // If the user disabled a channel after a previous failure, record it as
  // skipped rather than leaving a stale "failed" entry in the result.
  if (!enabled.email && channels.email && channels.email !== "delivered") {
    channels.email = "skipped";
  }

  if (!enabled.push && channels.push && channels.push !== "delivered") {
    channels.push = "skipped";
  }

  const transientFailures = failures.filter(
    (failure) => !failure.error.permanent,
  );
  const permanentFailures = failures.filter(
    (failure) => failure.error.permanent,
  );

  // A transient failure is worth another attempt even if another channel
  // succeeded: the per-channel guard skips the successful send on the retry.
  if (transientFailures.length > 0) {
    const error = new Error(
      `Notification delivery failed for ${transientFailures
        .map((failure) => failure.channel)
        .join(", ")}.`,
    );
    error.channels = channels;
    error.permanent = false;
    throw error;
  }

  const delivered = Object.values(channels).some(
    (value) => value === "delivered",
  );

  // A permanent rejection with no successful channel is a terminal failure.
  // If another channel delivered, the notification is still useful; record the
  // failed channel and complete without retrying.
  if (permanentFailures.length > 0 && !delivered) {
    const error = new Error(
      `Notification delivery failed for ${permanentFailures
        .map((failure) => failure.channel)
        .join(", ")}.`,
    );
    error.channels = channels;
    error.permanent = true;
    throw error;
  }

  return {
    outcome: delivered ? "delivered" : "skipped",
    reason: delivered ? undefined : "PREFERENCES_OFF",
    channels,
    ...(permanentFailures.length > 0
      ? { failedChannels: permanentFailures.map((failure) => failure.channel) }
      : {}),
  };
}

module.exports = {
  NOTIFICATIONS_NAMESPACE,
  deliverNotification,
  resolveChannels,
  serializeNotificationEvent,
};
