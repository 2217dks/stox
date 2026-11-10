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

module.exports = {
  createOrderExecutedNotification,
};
