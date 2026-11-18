const prisma = require("../config/database");
const { AppError } = require("../utils/errors");
const { getPortfolioAggregatePnl } = require("./portfolioPnlAggregateService");
const { findLatestSnapshot } = require("./portfolioSnapshotRepository");
const { serializeTrade } = require("./tradeService");

/**
 * Compose a unified dashboard summary for a caller-owned portfolio.
 *
 * Integrates:
 * - Portfolio balances and total market valuation
 * - Aggregate P&L (realized + unrealized + daily snapshot return)
 * - Open positions summary with quote freshness indicators
 * - Recent orders and executed trades
 *
 * Strictly scoped to the authenticated user and portfolio to prevent unauthorized data exposure.
 */
async function getPortfolioDashboard(
  userId,
  portfolioId,
  {
    client = prisma,
    asOf = new Date(),
  } = {},
) {
  const asOfDate = asOf instanceof Date ? asOf : new Date(asOf);
  if (Number.isNaN(asOfDate.getTime())) {
    throw AppError.badRequest("Invalid 'asOf' date parameter.", "INVALID_DATE");
  }

  const db = client || prisma;

  // 1. Verify portfolio exists and ownership
  const portfolio = await db.portfolio.findFirst({
    where: {
      id: portfolioId,
      userId,
    },
    select: {
      id: true,
      name: true,
      description: true,
      currency: true,
      startingBalance: true,
      cashBalance: true,
      isDefault: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  if (!portfolio) {
    throw AppError.notFound("Portfolio not found.", "PORTFOLIO_NOT_FOUND");
  }

  // 2. Fetch aggregate performance, latest snapshot, and recent activity in parallel
  const [aggregatePnl, latestSnapshot, recentTradesRaw, recentOrdersRaw, pendingOrdersCount] =
    await Promise.all([
      getPortfolioAggregatePnl(userId, portfolioId, {
        period: "1M",
        asOf,
        client: db,
      }),
      findLatestSnapshot(portfolioId, null, db),
      db.trade.findMany({
        where: { portfolioId },
        orderBy: { executedAt: "desc" },
        take: 5,
      }),
      db.order.findMany({
        where: { portfolioId },
        orderBy: { createdAt: "desc" },
        take: 5,
        select: {
          id: true,
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
          createdAt: true,
        },
      }),
      db.order.count({
        where: { portfolioId, status: "PENDING" },
      }),
    ]);

  // 3. Extract top positions sorted by market value
  const topPositions = [...(aggregatePnl.unrealized.positions || [])]
    .sort((a, b) => Number(b.marketValue || 0) - Number(a.marketValue || 0))
    .slice(0, 5);

  const formattedOrders = recentOrdersRaw.map((o) => ({
    id: o.id,
    symbol: o.symbol,
    assetType: o.assetType,
    side: o.side,
    type: o.type,
    status: o.status,
    quantity: o.quantity ? o.quantity.toString() : "0",
    limitPrice: o.limitPrice ? o.limitPrice.toString() : null,
    stopPrice: o.stopPrice ? o.stopPrice.toString() : null,
    executedPrice: o.executedPrice ? o.executedPrice.toString() : null,
    executedAt: o.executedAt ? o.executedAt.toISOString() : null,
    createdAt: o.createdAt instanceof Date ? o.createdAt.toISOString() : o.createdAt,
  }));

  const formattedTrades = recentTradesRaw.map(serializeTrade);

  const snapshotDateStr = latestSnapshot
    ? (latestSnapshot.snapshotDate instanceof Date
        ? latestSnapshot.snapshotDate.toISOString().slice(0, 10)
        : String(latestSnapshot.snapshotDate).slice(0, 10))
    : null;

  return {
    portfolio: {
      id: portfolio.id,
      name: portfolio.name,
      description: portfolio.description,
      currency: portfolio.currency,
      startingBalance: aggregatePnl.startingBalance,
      cashBalance: aggregatePnl.cashBalance,
      holdingsValue: aggregatePnl.openHoldingsValue,
      totalValue: aggregatePnl.totalPortfolioValue,
      isDefault: portfolio.isDefault,
      createdAt: portfolio.createdAt,
    },
    performance: {
      totalPnl: aggregatePnl.netPnl,
      totalReturnPct: aggregatePnl.netPnlPct,
      accountPnl: aggregatePnl.accountPnl,
      accountPnlPct: aggregatePnl.accountPnlPct,
      dailyPnl: latestSnapshot ? latestSnapshot.dailyPnl.toString() : "0.00000000",
      dailyReturnPct: latestSnapshot ? latestSnapshot.dailyPnlPct.toString() : "0.0000",
      snapshotDate: snapshotDateStr,
      lastSnapshotDate: snapshotDateStr,
      realizedPnl: aggregatePnl.realized.pnl,
      realizedPnlPct: aggregatePnl.realized.pnlPct,
      unrealizedPnl: aggregatePnl.unrealized.pnl,
      unrealizedPnlPct: aggregatePnl.unrealized.pnlPct,
      winRate: aggregatePnl.realized.winRate,
      winningTrades: aggregatePnl.realized.winningTrades,
      losingTrades: aggregatePnl.realized.losingTrades,
      tradeCount: aggregatePnl.realized.tradeCount,
    },
    positionsSummary: {
      openPositionsCount: aggregatePnl.unrealized.positionCount,
      totalInvested: aggregatePnl.openHoldingsCostBasis,
      marketValue: aggregatePnl.openHoldingsValue,
      isStale: aggregatePnl.unrealized.isStale,
      freshness: aggregatePnl.unrealized.freshness,
      topPositions,
    },
    recentActivity: {
      pendingOrdersCount,
      recentOrders: formattedOrders,
      recentTrades: formattedTrades,
    },
    // Explicitly distinguishes the live market valuation timestamp from historical snapshot valuation date
    asOf: asOfDate.toISOString(),
  };
}

module.exports = {
  getPortfolioDashboard,
};
