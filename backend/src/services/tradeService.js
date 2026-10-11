const prisma = require("../config/database");
const { AppError } = require("../utils/errors");

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
      orderBy: sort
        ? [{ [sort]: order ?? "desc" }]
        : DEFAULT_TRADE_ORDER_BY,
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

module.exports = {
  serializeTrade,
  getTrade,
  listTrades,
  TRADE_SORT_FIELDS,
};
