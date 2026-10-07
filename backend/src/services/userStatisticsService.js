const prisma = require("../config/database");
const { getCurrentUser } = require("./authService");

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
  const decidedTrades = winningTrades + losingTrades;

  if (decidedTrades === 0) {
    return 0;
  }

  return Math.round((winningTrades / decidedTrades) * 10000) / 10000;
}

/**
 * Build trading statistics for a single user.
 *
 * Statistics are always scoped to the caller's own portfolios. `userId` comes
 * from the verified access token (never from the request), so one user can
 * never read another user's numbers.
 */
async function getUserStatistics(userId) {
  // Reuse the existing auth helper so a deleted or suspended account gets the
  // same 404/403 semantics as GET /auth/me and cannot read statistics.
  await getCurrentUser(userId);

  // `portfolio.userId` ties every trade back to the authenticated user, which
  // is also where the isolation is enforced.
  const ownedTradeFilter = {
    portfolio: {
      userId,
    },
  };

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
        orderBy: {
          realizedPnl: "desc",
        },
        select: TRADE_STAT_FIELDS,
      }),
      prisma.trade.findFirst({
        where: {
          ...ownedTradeFilter,
          realizedPnl: {
            not: null,
          },
        },
        orderBy: {
          realizedPnl: "asc",
        },
        select: TRADE_STAT_FIELDS,
      }),
    ]);

  return {
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
}

module.exports = {
  getUserStatistics,
};
