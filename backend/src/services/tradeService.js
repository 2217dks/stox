const { randomUUID } = require("crypto");

const { Prisma } = require("@prisma/client");

const prisma = require("../config/database");
const { createOrderExecutedNotification } = require("./notificationEvents");
const { publishExecutionEvents } = require("../realtime/orderEvents");
const { AppError } = require("../utils/errors");
const logger = require("../utils/logger");

const cacheService = require("./cacheService");

const ZERO = new Prisma.Decimal(0);
const ONE_HUNDRED = new Prisma.Decimal(100);

// Matches the Decimal(18, 8) columns in prisma/schema.prisma. The sell path
// rounds the remaining invested amount once, at this scale, so the removed
// basis and the stored remainder always add back to the previous total.
const MONEY_SCALE = 8;

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

function serializeNullableDecimal(value) {
  return value === null || value === undefined ? null : value.toString();
}

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
    // Zero is a valid P&L (a sell at cost), so check for null explicitly
    // instead of relying on a Decimal object's truthiness.
    realizedPnl: serializeNullableDecimal(trade.realizedPnl),
    realizedPnlPct: serializeNullableDecimal(trade.realizedPnlPct),
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

async function applyBuy(tx, order, quantity, price, totalValue, portfolio) {
  const orderReservedCash = new Prisma.Decimal(order.reservedCash ?? ZERO);
  const portfolioReservedCash = new Prisma.Decimal(
    portfolio.reservedCash ?? ZERO,
  );
  const cashBalance = new Prisma.Decimal(portfolio.cashBalance);

  // Only the portion above this order's reservation needs additional
  // unreserved cash.
  const additionalCashRequired = Prisma.Decimal.max(
    totalValue.minus(orderReservedCash),
    ZERO,
  );

  const availableCash = cashBalance.minus(portfolioReservedCash);

  if (availableCash.lt(additionalCashRequired)) {
    throw AppError.badRequest(
      "Insufficient available portfolio cash.",
      "INSUFFICIENT_BALANCE",
      {
        required: additionalCashRequired.toString(),
        available: availableCash.toString(),
      },
    );
  }

  if (portfolioReservedCash.lt(orderReservedCash)) {
    throw AppError.badRequest(
      "Order reservation exceeds portfolio reservation.",
      "RESERVATION_INCONSISTENCY",
    );
  }

  await tx.$executeRaw`
    INSERT INTO "Holding" (
      "id",
      "portfolioId",
      "symbol",
      "assetType",
      "quantity",
      "averageBuyPrice",
      "totalInvested",
      "isShort",
      "createdAt",
      "updatedAt"
    )
    VALUES (
      ${randomUUID()},
      ${order.portfolioId},
      ${order.symbol},
      ${order.assetType}::"AssetType",
      ${quantity},
      ${price},
      ${totalValue},
      false,
      now(),
      now()
    )
    ON CONFLICT ("portfolioId", "symbol") DO UPDATE SET
      "quantity" = "Holding"."quantity" + EXCLUDED."quantity",
      "totalInvested" =
        "Holding"."totalInvested" + EXCLUDED."totalInvested",
      "averageBuyPrice" =
        ("Holding"."totalInvested" + EXCLUDED."totalInvested")
        / ("Holding"."quantity" + EXCLUDED."quantity"),
      "isShort" = false,
      "updatedAt" = now()
  `;

  await tx.portfolio.update({
    where: { id: order.portfolioId },
    data: {
      cashBalance: {
        decrement: totalValue,
      },
      reservedCash: {
        decrement: orderReservedCash,
      },
    },
  });

  await tx.order.update({
    where: { id: order.id },
    data: {
      reservedCash: ZERO,
    },
  });
}

async function applySell(tx, order, quantity, totalValue) {
  // Lock the holding and read its current quantity and invested amount.
  //
  // The removed cost basis is proportional to `totalInvested`, not derived
  // from the stored average price: `averageBuyPrice` is Decimal(18,8), so a
  // repeating weighted average is rounded on write. Multiplying it back by
  // the quantity can overshoot the invested amount and leave a negative
  // residual (3.02 / 3 stored as 1.00666667 subtracts 3.02000001 on a full
  // close). The division runs in PostgreSQL numeric, and the remainder is
  // rounded once at the column scale here rather than in JS.
  const holdings = await tx.$queryRaw`
    SELECT
      "id",
      "quantity",
      "totalInvested",
      ROUND(
        "totalInvested"
          - (("totalInvested" * ${quantity}) / "quantity"),
        ${MONEY_SCALE}
      ) AS "newTotalInvested"
    FROM "Holding"
    WHERE "portfolioId" = ${order.portfolioId}
      AND "symbol" = ${order.symbol}
      AND "quantity" >= ${quantity}
    FOR UPDATE
  `;

  if (holdings.length === 0) {
    throw AppError.badRequest(
      "Insufficient position to sell.",
      "INSUFFICIENT_POSITION",
    );
  }

  const holding = holdings[0];
  const currentQuantity = new Prisma.Decimal(holding.quantity);
  const currentTotalInvested = new Prisma.Decimal(holding.totalInvested);
  const isFullClose = currentQuantity.equals(quantity);

  const newQuantity = isFullClose ? ZERO : currentQuantity.minus(quantity);
  const newTotalInvested = isFullClose
    ? ZERO
    : new Prisma.Decimal(holding.newTotalInvested);

  // Rounding the stored remainder at the column scale makes the remainder and
  // the removed basis add back to the original total exactly. A full close is
  // forced to zero in the `newTotalInvested` assignment above, so it can never
  // retain a rounded residual. Realized P&L uses this same removed basis, so
  // the trade record and the holding can never disagree about what was sold.
  const removedCostBasis = currentTotalInvested.minus(newTotalInvested);
  const realizedPnl = totalValue.minus(removedCostBasis);

  await tx.holding.update({
    where: { id: holding.id },
    data: {
      quantity: newQuantity,
      totalInvested: newTotalInvested,
    },
  });

  // A sell only credits cash, so an unconditional increment is safe.
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
    realizedPnl,
    realizedPnlPct: removedCostBasis.isZero()
      ? null
      : realizedPnl.dividedBy(removedCostBasis).times(ONE_HUNDRED),
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

  const { trade, order: executedOrder } = await prisma.$transaction(
    async (tx) => {
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

      // Lock the portfolio before changing the order or financial state.
      // A concurrent deactivatePortfolio() update must wait until this
      // transaction commits or rolls back.
      const portfolios = await tx.$queryRaw`
            SELECT "id", "isActive", "cashBalance", "reservedCash"
            FROM "Portfolio"
            WHERE "id" = ${order.portfolioId}
            FOR UPDATE
          `;

      const portfolio = portfolios[0];

      if (!portfolio) {
        throw AppError.notFound("Portfolio not found.", "PORTFOLIO_NOT_FOUND");
      }

      // Leave the order PENDING when the portfolio was already deactivated.
      // ORDER_NOT_EXECUTABLE is already treated as a worker skip.
      if (!portfolio.isActive) {
        throw AppError.badRequest(
          "Order is not executable.",
          "ORDER_NOT_EXECUTABLE",
        );
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

      const quantity = new Prisma.Decimal(order.quantity);
      const totalValue = quantity.times(executionPrice);

      let realizedPnl = null;
      let realizedPnlPct = null;

      if (order.side === "BUY") {
        await applyBuy(
          tx,
          order,
          quantity,
          executionPrice,
          totalValue,
          portfolio,
        );
      } else if (order.side === "SELL") {
        const realized = await applySell(tx, order, quantity, totalValue);

        realizedPnl = realized.realizedPnl;
        realizedPnlPct = realized.realizedPnlPct;
      } else {
        throw AppError.badRequest("Invalid order side.", "INVALID_ORDER");
      }

      const trade = await tx.trade.create({
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

      return { trade, order };
    },
  );

  await cacheService.invalidatePortfolio(executedOrder.portfolioId);

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

  // Realtime fan-out is best-effort and runs after the commit. Awaited here so
  // the worker's next pass observes a consistent event order.
  await publishExecutionEvents({ trade, order: executedOrder });

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
