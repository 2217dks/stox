const { Prisma } = require("@prisma/client");

const prisma = require("../config/database");
const { createOrderExecutedNotification } = require("./notificationEvents");
const { AppError } = require("../utils/errors");
const logger = require("../utils/logger");

const ZERO = new Prisma.Decimal(0);
const ONE_HUNDRED = new Prisma.Decimal(100);

const SERIALIZED_TRADE_FIELDS = {
  id: true,
  portfolioId: true,
  orderId: true,
  symbol: true,
  assetType: true,
  side: true,
  quantity: true,
  price: true,
  totalValue: true,
  fees: true,
  realizedPnl: true,
  realizedPnlPct: true,
  executedAt: true,
};

// Mirrors serializeOrder: Decimal columns leave Prisma as Decimal objects,
// so the API contract serializes them as strings to preserve precision.
function serializeTrade(trade) {
  return {
    id: trade.id,
    portfolioId: trade.portfolioId,
    orderId: trade.orderId,
    symbol: trade.symbol,
    assetType: trade.assetType,
    side: trade.side,
    quantity: trade.quantity.toString(),
    price: trade.price.toString(),
    totalValue: trade.totalValue.toString(),
    fees: trade.fees.toString(),
    realizedPnl: trade.realizedPnl ? trade.realizedPnl.toString() : null,
    realizedPnlPct: trade.realizedPnlPct
      ? trade.realizedPnlPct.toString()
      : null,
    executedAt: trade.executedAt,
  };
}

// Trades are reached through their portfolio; ownership is enforced at the
// query level so foreign trades are indistinguishable from missing ones.
async function getTrade({ userId, tradeId }) {
  const trade = await prisma.trade.findFirst({
    where: {
      id: tradeId,
      portfolio: {
        userId,
      },
    },
    select: SERIALIZED_TRADE_FIELDS,
  });

  if (!trade) {
    throw AppError.notFound("Trade not found.", "TRADE_NOT_FOUND");
  }

  return serializeTrade(trade);
}

// Sorting allowlist: sort/order query params map onto orderBy only for
// fields listed here; anything else stays on the default (and the query
// schema rejects unknown values with 400 before the service is reached).
const TRADE_SORT_FIELDS = ["executedAt", "totalValue"];

const DEFAULT_TRADE_ORDER_BY = [{ executedAt: "desc" }];

// Filter set mirrors GET /orders minus status/type, which trades cannot
// have: every trade is an executed order by definition. The date window
// applies to executedAt instead of createdAt.
async function listTrades({
  userId,
  page = 1,
  limit = 20,
  symbol,
  side,
  portfolioId,
  from,
  to,
  sort,
  order,
}) {
  const where = {
    portfolio: {
      userId,
    },
  };

  if (symbol) {
    where.symbol = symbol;
  }

  if (side) {
    where.side = side;
  }

  // Ownership scoping above still applies: a foreign portfolioId simply
  // yields an empty result instead of another user's trades.
  if (portfolioId) {
    where.portfolioId = portfolioId;
  }

  if (from || to) {
    // Half-open window [from, to) on executedAt, matching the order list
    // contract: from inclusive, to exclusive (a date-only `to` was
    // normalized by the validator to midnight of the following day).
    where.executedAt = {};

    if (from) {
      where.executedAt.gte = from;
    }

    if (to) {
      where.executedAt.lt = to;
    }
  }

  const [trades, total] = await Promise.all([
    prisma.trade.findMany({
      where,
      select: SERIALIZED_TRADE_FIELDS,
      orderBy: sort ? [{ [sort]: order ?? "desc" }] : DEFAULT_TRADE_ORDER_BY,
      skip: (page - 1) * limit,
      take: limit,
    }),

    prisma.trade.count({
      where,
    }),
  ]);

  return {
    trades: trades.map(serializeTrade),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}

function toDecimal(value) {
  if (value === null || value === undefined) {
    return null;
  }

  try {
    return new Prisma.Decimal(value);
  } catch {
    return null;
  }
}

function toExecutionPrice(price) {
  const decimal = toDecimal(price);

  if (!decimal || !decimal.isFinite() || decimal.lte(ZERO)) {
    throw AppError.badRequest(
      "Execution price must be greater than zero.",
      "INVALID_EXECUTION_PRICE",
    );
  }

  return decimal;
}

/**
 * Decide whether a pending order's trigger condition is satisfied.
 *
 * MARKET orders are always executable by the worker. LIMIT, STOP_LOSS, and
 * TAKE_PROFIT orders need their respective trigger price; a malformed or
 * missing trigger keeps the order pending instead of throwing inside the
 * polling loop.
 */
function evaluateOrder(order, currentPrice) {
  if (!order) {
    return false;
  }

  const price = toDecimal(currentPrice);

  if (!price || !price.isFinite() || price.lte(ZERO)) {
    return false;
  }

  switch (order.type) {
    case "MARKET":
      return true;

    case "LIMIT": {
      const limitPrice = toDecimal(order.limitPrice);

      if (!limitPrice || !limitPrice.isFinite() || limitPrice.lte(ZERO)) {
        return false;
      }

      if (order.side === "BUY") {
        return price.lte(limitPrice);
      }

      if (order.side === "SELL") {
        return price.gte(limitPrice);
      }

      return false;
    }

    case "STOP_LOSS": {
      const stopPrice = toDecimal(order.stopPrice);

      return Boolean(
        stopPrice &&
        stopPrice.isFinite() &&
        stopPrice.gt(ZERO) &&
        price.lte(stopPrice),
      );
    }

    case "TAKE_PROFIT": {
      const stopPrice = toDecimal(order.stopPrice);

      return Boolean(
        stopPrice &&
        stopPrice.isFinite() &&
        stopPrice.gt(ZERO) &&
        price.gte(stopPrice),
      );
    }

    default:
      return false;
  }
}

async function applyBuy(tx, order, holding, quantity, price, totalValue) {
  // The cash condition lives in the UPDATE itself, so two concurrent buys
  // cannot both pass an earlier check and overdraw the portfolio.
  const cashUpdate = await tx.portfolio.updateMany({
    where: {
      id: order.portfolioId,
      cashBalance: {
        gte: totalValue,
      },
    },
    data: {
      cashBalance: {
        decrement: totalValue,
      },
    },
  });

  if (cashUpdate.count === 0) {
    const portfolio = await tx.portfolio.findUnique({
      where: { id: order.portfolioId },
      select: { cashBalance: true },
    });

    if (!portfolio) {
      throw AppError.notFound("Portfolio not found.", "PORTFOLIO_NOT_FOUND");
    }

    throw AppError.badRequest(
      "Insufficient portfolio cash.",
      "INSUFFICIENT_BALANCE",
      {
        required: totalValue.toString(),
        available: portfolio.cashBalance.toString(),
      },
    );
  }

  if (!holding) {
    await tx.holding.create({
      data: {
        portfolioId: order.portfolioId,
        symbol: order.symbol,
        assetType: order.assetType,
        quantity,
        averageBuyPrice: price,
        totalInvested: totalValue,
        isShort: false,
      },
    });

    return;
  }

  const newQuantity = new Prisma.Decimal(holding.quantity).plus(quantity);
  const newTotalInvested = new Prisma.Decimal(holding.totalInvested).plus(
    totalValue,
  );

  await tx.holding.update({
    where: { id: holding.id },
    data: {
      quantity: newQuantity,
      averageBuyPrice: newTotalInvested.dividedBy(newQuantity),
      totalInvested: newTotalInvested,
      isShort: false,
    },
  });
}

async function applySell(tx, order, holding, quantity, price, totalValue) {
  if (!holding || new Prisma.Decimal(holding.quantity).lt(quantity)) {
    throw AppError.badRequest(
      "Insufficient position to sell.",
      "INSUFFICIENT_POSITION",
    );
  }

  const averageBuyPrice = new Prisma.Decimal(holding.averageBuyPrice);
  const costBasis = averageBuyPrice.times(quantity);

  // Match only a holding whose quantity still covers the sale. This keeps
  // two concurrent sells from both passing the read-time check above.
  const holdingUpdate = await tx.holding.updateMany({
    where: {
      id: holding.id,
      quantity: {
        gte: quantity,
      },
    },
    data: {
      quantity: {
        decrement: quantity,
      },
      totalInvested: {
        decrement: costBasis,
      },
    },
  });

  if (holdingUpdate.count === 0) {
    throw AppError.badRequest(
      "Insufficient position to sell.",
      "INSUFFICIENT_POSITION",
    );
  }

  await tx.portfolio.update({
    where: { id: order.portfolioId },
    data: {
      cashBalance: {
        increment: totalValue,
      },
    },
  });

  // Keep the row at quantity 0 for a full close: the trade history and the
  // original cost basis remain auditable.
  return {
    realizedPnl: price.minus(averageBuyPrice).times(quantity),
    realizedPnlPct: averageBuyPrice.isZero()
      ? null
      : price
          .minus(averageBuyPrice)
          .dividedBy(averageBuyPrice)
          .times(ONE_HUNDRED),
  };
}

/**
 * Execute one pending order at the supplied price.
 *
 * The order status transition, trade creation, holding update, and cash
 * movement all happen in one database transaction. The conditional
 * `PENDING -> EXECUTED` update makes execution safe when two workers observe
 * the same order: exactly one transaction wins and the other receives
 * ORDER_NOT_EXECUTABLE, so cash and holdings are never applied twice.
 *
 * `orderOrId` may be an order row (as in the worker) or a UUID, so callers
 * cannot accidentally execute a stale copy.
 */
async function executeOrder(orderOrId, price) {
  const orderId = typeof orderOrId === "string" ? orderOrId : orderOrId?.id;

  if (!orderId) {
    throw AppError.badRequest("Order is required.", "INVALID_ORDER");
  }

  const executionPrice = toExecutionPrice(price);
  let executedOrder = null;

  const trade = await prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      include: {
        portfolio: {
          select: {
            id: true,
            userId: true,
          },
        },
      },
    });

    if (!order) {
      throw AppError.notFound("Order not found.", "ORDER_NOT_FOUND");
    }

    const executedAt = new Date();

    const transition = await tx.order.updateMany({
      where: {
        id: order.id,
        status: "PENDING",
      },
      data: {
        status: "EXECUTED",
        executedPrice: executionPrice,
        executedAt,
      },
    });

    if (transition.count === 0) {
      throw AppError.badRequest(
        "Order is not executable.",
        "ORDER_NOT_EXECUTABLE",
      );
    }

    executedOrder = order;

    const quantity = new Prisma.Decimal(order.quantity);
    const totalValue = quantity.times(executionPrice);
    const holding = await tx.holding.findUnique({
      where: {
        portfolioId_symbol: {
          portfolioId: order.portfolioId,
          symbol: order.symbol,
        },
      },
    });

    let realizedPnl = null;
    let realizedPnlPct = null;

    if (order.side === "BUY") {
      await applyBuy(tx, order, holding, quantity, executionPrice, totalValue);
    } else if (order.side === "SELL") {
      const realized = await applySell(
        tx,
        order,
        holding,
        quantity,
        executionPrice,
        totalValue,
      );

      realizedPnl = realized.realizedPnl;
      realizedPnlPct = realized.realizedPnlPct;
    } else {
      throw AppError.badRequest("Invalid order side.", "INVALID_ORDER");
    }

    return tx.trade.create({
      data: {
        portfolioId: order.portfolioId,
        orderId: order.id,
        symbol: order.symbol,
        assetType: order.assetType,
        side: order.side,
        quantity,
        price: executionPrice,
        totalValue,
        fees: ZERO,
        realizedPnl,
        realizedPnlPct,
        executedAt,
      },
    });
  });

  // Notification delivery is a post-commit side effect: it must never undo a
  // committed trade. Failures are logged and left for the delivery pipeline.
  try {
    await createOrderExecutedNotification({
      userId: executedOrder.portfolio.userId,
      order: executedOrder,
      trade,
    });
  } catch (error) {
    logger.warn("Failed to create order-executed notification", {
      orderId: executedOrder.id,
      error: error.message,
    });
  }

  return trade;
}

module.exports = {
  serializeTrade,
  getTrade,
  listTrades,
  evaluateOrder,
  executeOrder,
  TRADE_SORT_FIELDS,
};
