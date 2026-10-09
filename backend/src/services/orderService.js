const prisma = require("../config/database");
const { AppError } = require("../utils/errors");

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

  const order = await prisma.order.create({
    data: {
      portfolioId,
      symbol: normalizedSymbol,
      assetType,
      side,
      type,
      status: "PENDING",
      quantity,
      limitPrice,
      stopPrice,
      source: "MANUAL",
    },
  });

  return serializeOrder(order);
}

module.exports = {
  serializeOrder,
  getOrder,
  createOrder,
  createMarketOrder: createOrder,
};
