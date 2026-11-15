const prisma = require("../config/database");
const { Prisma } = require("@prisma/client");
const { getCurrentUser } = require("./authService");
const { AppError } = require("../utils/errors");

// Only the fields needed to build the statistics summary are read from the
// database. Nothing here is user-identifying or sensitive.
const TRADE_STAT_FIELDS = {
  symbol: true,
  realizedPnl: true,
  realizedPnlPct: true,
};

/**
 * Prisma returns Decimal values for Decimal columns. The rest of the Stox API
 * serializes Decimal values as strings (see portfolioService), so statistics
 * follow the same convention to avoid precision loss in JSON.
 */
function toDecimalString(value) {
  if (value === null || value === undefined) {
    return null;
  }

  return value.toString();
}

function serializeTradeSummary(trade) {
  if (!trade) {
    return null;
  }

  return {
    symbol: trade.symbol,
    realizedPnl: toDecimalString(trade.realizedPnl),
    realizedPnlPct: toDecimalString(trade.realizedPnlPct),
  };
}

/**
 * Win rate is the share of *decided* trades that were profitable.
 *
 * Decided = a trade that realized a non-zero profit or loss. This keeps
 * break-even trades and still-open positions from diluting the number.
 * The result is a fraction between 0 and 1, rounded to 4 decimal places.
 */
function computeWinRate(winningTrades, losingTrades) {
  const wins = Math.max(0, Number(winningTrades) || 0);
  const losses = Math.max(0, Number(losingTrades) || 0);
  const decidedTrades = wins + losses;

  if (decidedTrades === 0) {
    return 0;
  }

  return Math.round((wins / decidedTrades) * 10000) / 10000;
}

/**
 * Construct Prisma filter scoped to user's portfolios and optional filters.
 */
function buildTradeFilter(userId, filters = {}) {
  const where = {
    portfolio: {
      userId,
    },
  };

  if (filters.portfolioId) {
    where.portfolioId = filters.portfolioId;
  }

  if (filters.symbol) {
    where.symbol = filters.symbol;
  }

  if (filters.side) {
    where.side = filters.side;
  }

  if (filters.from || filters.to) {
    where.executedAt = {};
    if (filters.from) {
      where.executedAt.gte = filters.from;
    }
    if (filters.to) {
      where.executedAt.lt = filters.to;
    }
  }

  return where;
}

/**
 * Build monthly trade statistics aggregated by UTC calendar month.
 */
async function getMonthlyTradeStatistics(userId, filters = {}, options = {}) {
  if (!options.prevalidated) {
    await getCurrentUser(userId);

    if (filters.portfolioId) {
      const portfolio = await prisma.portfolio.findFirst({
        where: {
          id: filters.portfolioId,
          userId,
        },
        select: { id: true },
      });

      if (!portfolio) {
        throw AppError.notFound("Portfolio not found.", "PORTFOLIO_NOT_FOUND");
      }
    }
  }

  const conditions = [Prisma.sql`p."userId" = ${userId}`];
  if (filters.portfolioId) {
    conditions.push(Prisma.sql`t."portfolioId" = ${filters.portfolioId}`);
  }
  if (filters.symbol) {
    conditions.push(Prisma.sql`t."symbol" = ${filters.symbol}`);
  }
  if (filters.side) {
    conditions.push(Prisma.sql`t."side" = ${filters.side}::"OrderSide"`);
  }
  if (filters.from) {
    conditions.push(Prisma.sql`t."executedAt" >= ${filters.from}`);
  }
  if (filters.to) {
    conditions.push(Prisma.sql`t."executedAt" <= ${filters.to}`);
  }

  const rows = await prisma.$queryRaw(Prisma.sql`
    SELECT
      TO_CHAR(timezone('UTC', t."executedAt"), 'YYYY-MM') AS "month",
      COUNT(*)::int AS "totalTrades",
      COUNT(CASE WHEN t."realizedPnl" > 0 THEN 1 END)::int AS "winningTrades",
      COUNT(CASE WHEN t."realizedPnl" < 0 THEN 1 END)::int AS "losingTrades",
      COALESCE(SUM(t."totalValue"), 0)::text AS "totalVolume",
      COALESCE(SUM(t."realizedPnl"), 0)::text AS "realizedPnl",
      AVG(t."realizedPnlPct")::text AS "avgRealizedPnlPct"
    FROM "Trade" t
    JOIN "Portfolio" p ON t."portfolioId" = p."id"
    WHERE ${Prisma.join(conditions, " AND ")}
    GROUP BY "month"
    ORDER BY "month" ASC;
  `);

  return rows.map((row) => ({
    month: row.month,
    totalTrades: Number(row.totalTrades),
    winningTrades: Number(row.winningTrades),
    losingTrades: Number(row.losingTrades),
    winRate: computeWinRate(Number(row.winningTrades), Number(row.losingTrades)),
    totalVolume: new Prisma.Decimal(row.totalVolume).toString(),
    realizedPnl: new Prisma.Decimal(row.realizedPnl).toString(),
    averageReturn:
      row.avgRealizedPnlPct !== null && row.avgRealizedPnlPct !== undefined
        ? new Prisma.Decimal(row.avgRealizedPnlPct).toFixed(4)
        : null,
  }));
}

/**
 * Build trading statistics for a single user.
 *
 * Statistics are always scoped to the caller's own portfolios. `userId` comes
 * from the verified access token (never from the request), so one user can
 * never read another user's numbers.
 */
async function getUserStatistics(userId, filters = {}) {
  // Reuse the existing auth helper so a deleted or suspended account gets the
  // same 404/403 semantics as GET /auth/me and cannot read statistics.
  await getCurrentUser(userId);

  if (filters.portfolioId) {
    const portfolio = await prisma.portfolio.findFirst({
      where: {
        id: filters.portfolioId,
        userId,
      },
      select: { id: true },
    });

    if (!portfolio) {
      throw AppError.notFound("Portfolio not found.", "PORTFOLIO_NOT_FOUND");
    }
  }

  const ownedTradeFilter = buildTradeFilter(userId, filters);

  const [totals, winningTrades, losingTrades, bestTrade, worstTrade] =
    await Promise.all([
      prisma.trade.aggregate({
        where: ownedTradeFilter,
        _count: true,
        _sum: {
          totalValue: true,
        },
        // SQL AVG ignores NULLs, so trades without a realized return are
        // excluded from the average automatically.
        _avg: {
          realizedPnlPct: true,
        },
      }),
      prisma.trade.count({
        where: {
          ...ownedTradeFilter,
          realizedPnl: {
            gt: 0,
          },
        },
      }),
      prisma.trade.count({
        where: {
          ...ownedTradeFilter,
          realizedPnl: {
            lt: 0,
          },
        },
      }),
      prisma.trade.findFirst({
        where: {
          ...ownedTradeFilter,
          realizedPnl: {
            not: null,
          },
        },
        orderBy: [{ realizedPnl: "desc" }, { executedAt: "desc" }],
        select: TRADE_STAT_FIELDS,
      }),
      prisma.trade.findFirst({
        where: {
          ...ownedTradeFilter,
          realizedPnl: {
            not: null,
          },
        },
        orderBy: [{ realizedPnl: "asc" }, { executedAt: "desc" }],
        select: TRADE_STAT_FIELDS,
      }),
    ]);

  const response = {
    totalTrades: totals._count,
    winningTrades,
    losingTrades,
    winRate: computeWinRate(winningTrades, losingTrades),
    // An empty aggregate sums to null; expose "0" so the shape stays stable.
    totalVolume: toDecimalString(totals._sum.totalValue) ?? "0",
    averageReturn: toDecimalString(totals._avg.realizedPnlPct),
    bestTrade: serializeTradeSummary(bestTrade),
    worstTrade: serializeTradeSummary(worstTrade),
  };

  if (filters.includeMonthly) {
    response.monthly = await getMonthlyTradeStatistics(userId, filters, { prevalidated: true });
  }

  return response;
}

module.exports = {
  toDecimalString,
  serializeTradeSummary,
  computeWinRate,
  buildTradeFilter,
  getMonthlyTradeStatistics,
  getUserStatistics,
};
