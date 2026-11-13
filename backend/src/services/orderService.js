const prisma = require("../config/database");
const { isExecutableAssetType } = require("../utils/assetSupport");
const { AppError } = require("../utils/errors");
const { hasEventBus, publishOrderStatus } = require("../realtime/orderEvents");
const { Prisma } = require("@prisma/client");
const marketDataService = require("./marketData");

const ZERO = new Prisma.Decimal(0);
const MAX_MONEY = new Prisma.Decimal("9999999999.99999999");
const MONEY_SCALE = 8;

/**
 * Calculate the cash that must be reserved for a BUY order.
 *
 * MARKET      -> current market quote
 * LIMIT       -> limitPrice
 * STOP_LOSS   -> stopPrice
 * TAKE_PROFIT -> stopPrice
 * SELL        -> zero
 */
async function calculateOrderReservation({
  side,
  type,
  symbol,
  assetType,
  quantity,
  limitPrice,
  stopPrice,
}) {
  if (side !== "BUY") {
    return ZERO;
  }

  let referencePrice;

  if (type === "MARKET") {
    const quote = await marketDataService.getQuote(symbol, {
      assetClass: assetType,
    });

    referencePrice = quote.price;
  } else if (type === "LIMIT") {
    referencePrice = limitPrice;
  } else {
    referencePrice = stopPrice;
  }

  const decimalQuantity = new Prisma.Decimal(quantity);
  const decimalPrice = new Prisma.Decimal(referencePrice);

  if (
    !decimalQuantity.isFinite() ||
    !decimalPrice.isFinite() ||
    decimalQuantity.lte(ZERO) ||
    decimalPrice.lte(ZERO)
  ) {
    throw AppError.badRequest(
      "Unable to calculate the cash reservation for this order.",
      "INVALID_RESERVATION_AMOUNT",
    );
  }

  // Round upward to avoid reserving less than the calculated amount.
  const reservation = decimalQuantity
    .times(decimalPrice)
    .toDecimalPlaces(MONEY_SCALE, Prisma.Decimal.ROUND_UP);

  if (reservation.gt(MAX_MONEY)) {
    throw AppError.badRequest(
      "Order value exceeds the supported portfolio balance.",
      "RESERVATION_AMOUNT_TOO_LARGE",
    );
  }

  return reservation;
}

async function ensureActiveUser(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      isSuspended: true,
    },
  });

  if (!user) {
    throw AppError.notFound("User not found.", "USER_NOT_FOUND");
  }

  if (user.isSuspended) {
    throw AppError.forbidden("Account is suspended.", "ACCOUNT_SUSPENDED");
  }

  return user;
}

async function getOwnedActivePortfolio(userId, portfolioId) {
  const portfolio = await prisma.portfolio.findFirst({
    where: {
      id: portfolioId,
      userId,
    },
    select: {
      id: true,
      isActive: true,
    },
  });

  if (!portfolio) {
    throw AppError.notFound("Portfolio not found.", "PORTFOLIO_NOT_FOUND");
  }

  if (!portfolio.isActive) {
    throw AppError.badRequest("Portfolio is inactive.", "PORTFOLIO_INACTIVE");
  }

  return portfolio;
}

// `createMarketOrder` is kept as a backward-compatible alias; the canonical
// entry point is `createOrder`.
const SERIALIZED_ORDER_FIELDS = {
  id: true,
  portfolioId: true,
  symbol: true,
  assetType: true,
  side: true,
  type: true,
  status: true,
  quantity: true,
  reservedCash: true,
  limitPrice: true,
  stopPrice: true,
  executedPrice: true,
  executedAt: true,
  expiresAt: true,
  notes: true,
  source: true,
  createdAt: true,
  updatedAt: true,
};

function serializeOrder(order) {
  return {
    id: order.id,
    portfolioId: order.portfolioId,
    symbol: order.symbol,
    assetType: order.assetType,
    side: order.side,
    type: order.type,
    status: order.status,
    quantity: order.quantity.toString(),
    reservedCash: order.reservedCash.toString(),
    limitPrice: order.limitPrice ? order.limitPrice.toString() : null,
    stopPrice: order.stopPrice ? order.stopPrice.toString() : null,
    executedPrice: order.executedPrice ? order.executedPrice.toString() : null,
    executedAt: order.executedAt,
    expiresAt: order.expiresAt,
    notes: order.notes,
    source: order.source,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  };
}

/**
 * Emit a lifecycle event only when a realtime bus is configured.
 *
 * Unit tests and one-off scripts run without a bus, so the guard avoids both a
 * meaningless publish and (for EXECUTED) the extra valuation query.
 */
function triggerOrderStatus(order) {
  if (hasEventBus()) {
    void publishOrderStatus(order);
  }
}

// Orders are reached through their portfolio; ownership is enforced at the
// query level so foreign orders are indistinguishable from missing ones.
async function getOrder({ userId, orderId }) {
  const order = await prisma.order.findFirst({
    where: {
      id: orderId,
      portfolio: {
        userId,
      },
    },
    select: SERIALIZED_ORDER_FIELDS,
  });

  if (!order) {
    throw AppError.notFound("Order not found.", "ORDER_NOT_FOUND");
  }

  return serializeOrder(order);
}

// Sorting allowlist: the list endpoint currently pins ordering to
// createdAt desc. Exposing sort/order query params later means adding
// entries here (and whitelisting direction), not restructuring the query.
const ORDER_SORT_FIELDS = ["createdAt"];

const ORDER_LIST_ORDER_BY = [{ createdAt: "desc" }];

// `status` arrives as a validated, deduplicated array from the query schema.
async function listOrders({
  userId,
  page = 1,
  limit = 20,
  status,
  symbol,
  side,
  type,
  portfolioId,
  from,
  to,
}) {
  const where = {
    portfolio: {
      userId,
    },
  };

  if (status) {
    where.status = {
      in: status,
    };
  }

  if (symbol) {
    where.symbol = symbol;
  }

  if (side) {
    where.side = side;
  }

  if (type) {
    where.type = type;
  }

  // Ownership scoping above still applies: a foreign portfolioId simply
  // yields an empty result instead of another user's orders.
  if (portfolioId) {
    where.portfolioId = portfolioId;
  }

  if (from || to) {
    // Half-open window [from, to): from is inclusive, to is exclusive.
    // A date-only `to` was normalized by the validator to midnight of the
    // following day, so the whole selected day is covered without tying
    // these comparisons to any timestamp precision.
    where.createdAt = {};

    if (from) {
      where.createdAt.gte = from;
    }

    if (to) {
      where.createdAt.lt = to;
    }
  }

  const [orders, total] = await Promise.all([
    prisma.order.findMany({
      where,
      select: SERIALIZED_ORDER_FIELDS,
      orderBy: ORDER_LIST_ORDER_BY,
      skip: (page - 1) * limit,
      take: limit,
    }),

    prisma.order.count({
      where,
    }),
  ]);

  return {
    orders: orders.map(serializeOrder),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}

async function cancelOrder({ userId, orderId }) {
  await ensureActiveUser(userId);

  const order = await prisma.order.findFirst({
    where: {
      id: orderId,
      portfolio: {
        userId,
      },
    },
    select: {
      id: true,
      status: true,
    },
  });

  if (!order) {
    throw AppError.notFound("Order not found.", "ORDER_NOT_FOUND");
  }

  // PENDING -> CANCELLED must be atomic: the status condition lives in the
  // UPDATE itself, so a concurrent execution between the eligibility check
  // above and this write cannot be overwritten with CANCELLED. If the
  // conditional update matches no rows, re-read owner-scoped to tell a
  // vanished/foreign order (404) apart from one that is no longer
  // cancellable (400).
  const transition = await prisma.order.updateMany({
    where: {
      id: orderId,
      status: "PENDING",
    },
    data: {
      status: "CANCELLED",
    },
  });

  if (transition.count === 0) {
    const current = await prisma.order.findFirst({
      where: {
        id: orderId,
        portfolio: {
          userId,
        },
      },
      select: {
        status: true,
      },
    });

    if (!current) {
      throw AppError.notFound("Order not found.", "ORDER_NOT_FOUND");
    }

    throw AppError.badRequest(
      "Only pending orders can be cancelled.",
      "ORDER_NOT_CANCELLABLE",
    );
  }

  const updated = await prisma.order.findUnique({
    where: {
      id: orderId,
    },
    select: SERIALIZED_ORDER_FIELDS,
  });

  const serialized = serializeOrder(updated);
  triggerOrderStatus(serialized);

  return serialized;
}

async function createOrder({
  userId,
  portfolioId,
  symbol,
  assetType,
  side,
  type = "MARKET",
  quantity,
  limitPrice = null,
  stopPrice = null,
}) {
  await ensureActiveUser(userId);

  await getOwnedActivePortfolio(userId, portfolioId);

  if (!isExecutableAssetType(assetType)) {
    throw AppError.badRequest(
      `Orders are not supported for the ${assetType} asset class.`,
      "UNSUPPORTED_ASSET_TYPE",
    );
  }

  const normalizedSymbol = symbol.trim().toUpperCase();

  if (!normalizedSymbol) {
    throw AppError.badRequest("Symbol is required.", "SYMBOL_REQUIRED");
  }

  if (!quantity || /^0+(\.0+)?$/.test(quantity)) {
    throw AppError.badRequest(
      "Quantity must be greater than zero.",
      "INVALID_QUANTITY",
    );
  }

  // Calculate the reservation before opening the database transaction.
  // This avoids holding a portfolio row lock while waiting for a market quote.
  const reservation = await calculateOrderReservation({
    side,
    type,
    symbol: normalizedSymbol,
    assetType,
    quantity,
    limitPrice,
    stopPrice,
  });

  const order = await prisma.$transaction(async (tx) => {
    // Serialize financial updates for this portfolio.
    const portfolios = await tx.$queryRaw`
      SELECT
        "id",
        "isActive",
        "cashBalance",
        "reservedCash"
      FROM "Portfolio"
      WHERE "id" = ${portfolioId}
        AND "userId" = ${userId}
      FOR UPDATE
    `;

    const portfolio = portfolios[0];

    if (!portfolio) {
      throw AppError.notFound("Portfolio not found.", "PORTFOLIO_NOT_FOUND");
    }

    if (!portfolio.isActive) {
      throw AppError.badRequest("Portfolio is inactive.", "PORTFOLIO_INACTIVE");
    }

    const cashBalance = new Prisma.Decimal(portfolio.cashBalance);
    const reservedCash = new Prisma.Decimal(portfolio.reservedCash);
    const availableCash = cashBalance.minus(reservedCash);

    if (availableCash.lt(reservation)) {
      throw AppError.badRequest(
        "Insufficient available portfolio cash.",
        "INSUFFICIENT_BALANCE",
        {
          required: reservation.toString(),
          available: availableCash.toString(),
        },
      );
    }

    // Increase the portfolio's aggregate reservation.
    if (reservation.gt(ZERO)) {
      await tx.portfolio.update({
        where: {
          id: portfolioId,
        },
        data: {
          reservedCash: {
            increment: reservation,
          },
        },
      });
    }

    // Create the order and its reservation in the same transaction.
    return tx.order.create({
      data: {
        portfolioId,
        symbol: normalizedSymbol,
        assetType,
        side,
        type,
        status: "PENDING",
        quantity,
        reservedCash: reservation,
        limitPrice,
        stopPrice,
        source: "MANUAL",
      },
    });
  });

  const serialized = serializeOrder(order);
  triggerOrderStatus(serialized);

  return serialized;
}

module.exports = {
  SERIALIZED_ORDER_FIELDS,
  serializeOrder,
  getOrder,
  listOrders,
  cancelOrder,
  createOrder,
  createMarketOrder: createOrder,
};
