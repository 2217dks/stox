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
async function getMonthlyTradeStatistics(userId, filters = {}) {
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

  const trades = await prisma.trade.findMany({
    where: ownedTradeFilter,
    select: {
      totalValue: true,
      realizedPnl: true,
      realizedPnlPct: true,
      executedAt: true,
    },
    orderBy: {
      executedAt: "asc",
    },
  });

  const monthBuckets = new Map();

  for (const trade of trades) {
    const monthKey = trade.executedAt.toISOString().slice(0, 7);
    if (!monthBuckets.has(monthKey)) {
      monthBuckets.set(monthKey, []);
    }
    monthBuckets.get(monthKey).push(trade);
  }

  const sortedMonthKeys = Array.from(monthBuckets.keys()).sort();
  const monthly = [];

  for (const month of sortedMonthKeys) {
    const monthTrades = monthBuckets.get(month);
    const totalTrades = monthTrades.length;
    let totalVolume = new Prisma.Decimal(0);
    let winningTrades = 0;
    let losingTrades = 0;
    let totalRealizedPnl = new Prisma.Decimal(0);
    let realizedReturnSum = new Prisma.Decimal(0);
    let realizedReturnCount = 0;

    for (const trade of monthTrades) {
      if (trade.totalValue) {
        totalVolume = totalVolume.plus(trade.totalValue);
      }
      if (trade.realizedPnl !== null && trade.realizedPnl !== undefined) {
        totalRealizedPnl = totalRealizedPnl.plus(trade.realizedPnl);
        if (trade.realizedPnl.gt(0)) {
          winningTrades++;
        } else if (trade.realizedPnl.lt(0)) {
          losingTrades++;
        }
      }
      if (trade.realizedPnlPct !== null && trade.realizedPnlPct !== undefined) {
        realizedReturnSum = realizedReturnSum.plus(trade.realizedPnlPct);
        realizedReturnCount++;
      }
    }

    const winRate = computeWinRate(winningTrades, losingTrades);
    const averageReturn = realizedReturnCount > 0
      ? realizedReturnSum.dividedBy(realizedReturnCount).toFixed(4)
      : null;

    monthly.push({
      month,
      totalTrades,
      winningTrades,
      losingTrades,
      winRate,
      totalVolume: totalVolume.toString(),
      realizedPnl: totalRealizedPnl.toString(),
      averageReturn,
    });
  }

  return monthly;
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
    response.monthly = await getMonthlyTradeStatistics(userId, filters);
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
