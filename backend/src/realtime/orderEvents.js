const { emitRealtimeEvent, getEventBus } = require("./eventBus");
const portfolioService = require("../services/portfolioService");
const logger = require("../utils/logger");

const TRADING_NAMESPACE = "/trading";

function hasEventBus() {
  return Boolean(getEventBus());
}

function portfolioRoom(portfolioId) {
  return `portfolio:${portfolioId}`;
}

function decimalString(value) {
  return value === null || value === undefined ? null : String(value);
}

/**
 * `order-status` covers every lifecycle transition: PENDING on placement,
 * CANCELLED, EXPIRED, REJECTED, and EXECUTED. Clients can therefore drive an
 * order list from one event instead of stitching several together.
 */
async function publishOrderStatus(order) {
  return emitRealtimeEvent({
    namespace: TRADING_NAMESPACE,
    room: portfolioRoom(order.portfolioId),
    event: "order-status",
    payload: {
      orderId: order.id,
      portfolioId: order.portfolioId,
      symbol: order.symbol,
      side: order.side,
      type: order.type,
      status: order.status,
      quantity: decimalString(order.quantity),
      price: decimalString(order.executedPrice),
      updatedAt: new Date().toISOString(),
    },
  });
}

async function publishTradeExecuted({ trade, order }) {
  return emitRealtimeEvent({
    namespace: TRADING_NAMESPACE,
    room: portfolioRoom(order.portfolioId),
    event: "trade-executed",
    payload: {
      tradeId: trade.id,
      orderId: order.id,
      portfolioId: order.portfolioId,
      symbol: trade.symbol,
      side: trade.side,
      quantity: decimalString(trade.quantity),
      price: decimalString(trade.price),
      totalValue: decimalString(trade.totalValue),
      realizedPnl: decimalString(trade.realizedPnl),
      executedAt: trade.executedAt
        ? new Date(trade.executedAt).toISOString()
        : null,
    },
  });
}

async function publishPortfolioUpdate(valuation) {
  return emitRealtimeEvent({
    namespace: TRADING_NAMESPACE,
    room: portfolioRoom(valuation.portfolioId),
    event: "portfolio-update",
    payload: valuation,
  });
}

/**
 * Emit the three events produced by a fill.
 *
 * Runs after the transaction has committed and never throws: a socket problem
 * must not turn a successful trade into an error response.
 */
async function publishExecutionEvents({ trade, order }) {
  if (!hasEventBus()) {
    return;
  }

  // Each event is published independently. A portfolio valuation is a
  // supplementary view of state; it must never decide whether a committed
  // trade reaches connected clients. Likewise, one failed publish must not
  // suppress the others.
  try {
    await publishOrderStatus({
      ...order,
      status: "EXECUTED",
      executedPrice: trade.price,
    });
  } catch (error) {
    logger.warn("Failed to publish order status event", {
      orderId: order.id,
      message: error.message,
    });
  }

  try {
    await publishTradeExecuted({ trade, order });
  } catch (error) {
    logger.warn("Failed to publish trade executed event", {
      orderId: order.id,
      message: error.message,
    });
  }

  let valuation;

  try {
    valuation = await portfolioService.getPortfolioValuation(order.portfolioId);
  } catch (error) {
    logger.warn("Failed to load portfolio valuation for realtime update", {
      portfolioId: order.portfolioId,
      orderId: order.id,
      message: error.message,
    });

    return;
  }

  if (!valuation) {
    return;
  }

  try {
    await publishPortfolioUpdate(valuation);
  } catch (error) {
    logger.warn("Failed to publish portfolio update event", {
      portfolioId: order.portfolioId,
      orderId: order.id,
      message: error.message,
    });
  }
}

module.exports = {
  hasEventBus,
  publishOrderStatus,
  publishTradeExecuted,
  publishPortfolioUpdate,
  publishExecutionEvents,
};
