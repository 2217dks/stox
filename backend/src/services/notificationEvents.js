const prisma = require("../config/database");
const { enqueueNotificationDelivery } = require("../queues/notificationQueue");
const logger = require("../utils/logger");

/**
 * Create the in-app notification for an executed order.
 *
 * Financial state has already committed before this is called. Delivery
 * failures must therefore never roll back or fail the trade.
 *
 * Kept separate from notificationService so the execution layer does not pull
 * in the auth module (and its startup env validation) just to write one row.
 *
 * The row is written first and is the source of truth. Enqueueing delivery is
 * best-effort: if Redis is unavailable the notification still appears in the
 * inbox, and the periodic pending-notification scan retries the outbound
 * channels once Redis returns.
 */
async function createOrderExecutedNotification({ userId, order, trade }) {
  const notification = await prisma.notification.create({
    data: {
      userId,
      type: "ORDER_EXECUTED",
      title: "Order executed",
      message: `${order.side} ${order.quantity.toString()} ${order.symbol} executed at ${trade.price.toString()}.`,
      data: {
        orderId: order.id,
        tradeId: trade.id,
        symbol: order.symbol,
        side: order.side,
        quantity: order.quantity.toString(),
        price: trade.price.toString(),
        totalValue: trade.totalValue.toString(),
      },
    },
  });

  // Floating on purpose: a slow or disconnected Redis must not delay the trade
  // response. The catch covers payload-validation failures so this can never
  // become an unhandled rejection.
  void enqueueNotificationDelivery({ notificationId: notification.id }).catch(
    (error) => {
      logger.warn("Notification delivery enqueue failed", {
        notificationId: notification.id,
        message: error.message,
      });
    },
  );

  return notification;
}

module.exports = {
  createOrderExecutedNotification,
};
