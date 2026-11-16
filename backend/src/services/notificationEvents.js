const prisma = require("../config/database");

/**
 * Create the in-app notification for an executed order.
 *
 * Financial state has already committed before this is called. Delivery
 * failures must therefore never roll back or fail the trade.
 *
 * Kept separate from notificationService so the execution layer does not pull
 * in the auth module (and its startup env validation) just to write one row.
 */
async function createOrderExecutedNotification({ userId, order, trade }) {
  return prisma.notification.create({
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
}

async function createOrderCancelledNotification({
  userId,
  order,
  reason = "USER_CANCELLED",
}) {
  const price =
    order.price != null
      ? order.price.toString()
      : order.limitPrice != null
        ? order.limitPrice.toString()
        : null;

  return prisma.notification.create({
    data: {
      userId,
      type: "ORDER_CANCELLED",
      title: "Order cancelled",
      message: `${order.side} ${order.quantity.toString()} ${order.symbol} order was cancelled.`,
      data: {
        orderId: order.id,
        symbol: order.symbol,
        side: order.side,
        quantity: order.quantity.toString(),
        price,
        reason,
      },
    },
  });
}

async function createOrderRejectedNotification({
  userId,
  order,
  reason = "EXECUTION_REJECTED",
}) {
  const reasonText =
    typeof reason === "object" && reason !== null
      ? reason.reason || "EXECUTION_REJECTED"
      : reason;

  const price =
    order.price != null
      ? order.price.toString()
      : order.limitPrice != null
        ? order.limitPrice.toString()
        : null;

  return prisma.notification.create({
    data: {
      userId,
      type: "ORDER_REJECTED",
      title: "Order rejected",
      message: `${order.side} ${order.quantity.toString()} ${order.symbol} order was rejected: ${reasonText}.`,
      data: {
        orderId: order.id,
        symbol: order.symbol,
        side: order.side,
        quantity: order.quantity.toString(),
        price,
        reason: reasonText,
      },
    },
  });
}

async function createOrderExpiredNotification({
  userId,
  order,
  reason = "ORDER_EXPIRED",
}) {
  const price =
    order.price != null
      ? order.price.toString()
      : order.limitPrice != null
        ? order.limitPrice.toString()
        : null;

  return prisma.notification.create({
    data: {
      userId,
      type: "ORDER_EXPIRED",
      title: "Order expired",
      message: `${order.side} ${order.quantity.toString()} ${order.symbol} order expired.`,
      data: {
        orderId: order.id,
        symbol: order.symbol,
        side: order.side,
        quantity: order.quantity.toString(),
        price,
        reason,
      },
    },
  });
}

module.exports = {
  createOrderExecutedNotification,
  createOrderCancelledNotification,
  createOrderRejectedNotification,
  createOrderExpiredNotification,
};
