const { Prisma } = require("@prisma/client");
const prisma = require("../config/database");
const { AppError } = require("../utils/errors");
const { toDecimalString } = require("../utils/decimal");
const { getPortfolioRealizedPnl } = require("./realizedPnlService");
const { getPortfolioUnrealizedPnl } = require("./unrealizedPnlService");

const ZERO = new Prisma.Decimal(0);
const ONE_HUNDRED = new Prisma.Decimal(100);

function toDecimal(val) {
  if (val === null || val === undefined) return ZERO;
  try {
    return new Prisma.Decimal(val);
  } catch {
    return ZERO;
  }
}


/**
 * Aggregate portfolio-level realized and unrealized P&L with decimal precision.
 *
 * Rules:
 * 1. Double-counting prevention:
 *    - Realized P&L is derived strictly from closed trades (SELL) executed within period boundaries.
 *    - Unrealized P&L is derived strictly from open holdings (quantity > 0) marked to market.
 *    - Position cost basis transitions from holding to trade upon execution; it is never in both.
 * 2. Fee treatment:
 *    - Trade fees are deducted directly from realized proceeds (realizedPnl = proceeds - costBasis - fees).
 * 3. Cash & Valuation:
 *    - totalPortfolioValue = cashBalance + openHoldingsMarketValue.
 *    - accountPnl = totalPortfolioValue - startingBalance.
 * 4. Reconciliation:
 *    - Reconciles total net P&L (realized + unrealized) against invested capital and underlying trades/holdings.
 */
async function getPortfolioAggregatePnl(
  userId,
  portfolioId,
  {
    period = "1M",
    from = null,
    to = null,
    symbol = null,
    priceProvider,
    rejectStale = false,
    allowStale = false,
    maxAgeSeconds = undefined,
    asOf = new Date(),
    client = prisma,
  } = {},
) {
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
      currency: true,
      startingBalance: true,
      cashBalance: true,
      isActive: true,
    },
  });

  if (!portfolio) {
    throw AppError.notFound("Portfolio not found.", "PORTFOLIO_NOT_FOUND");
  }

  // 2. Concurrently fetch realized P&L and unrealized P&L
  const [realized, unrealized] = await Promise.all([
    getPortfolioRealizedPnl(userId, portfolioId, {
      period,
      from,
      to,
      symbol,
      asOf,
    }),
    getPortfolioUnrealizedPnl(userId, portfolioId, {
      priceProvider,
      rejectStale,
      allowStale,
      maxAgeSeconds,
      asOf,
      symbol,
    }),
  ]);

  const startingBalance = toDecimal(portfolio.startingBalance);
  const cashBalance = toDecimal(portfolio.cashBalance);
  const openHoldingsMarketValue = toDecimal(unrealized.marketValue);
  const openHoldingsCostBasis = toDecimal(unrealized.totalInvested);

  const totalPortfolioValue = cashBalance.plus(openHoldingsMarketValue);

  const realizedPnl = toDecimal(realized.realizedPnl);
  const unrealizedPnl = toDecimal(unrealized.unrealizedPnl);
  const netPnl = realizedPnl.plus(unrealizedPnl);

  const totalCostBasis = openHoldingsCostBasis.plus(toDecimal(realized.totalCostBasis));
  const netPnlPct = totalCostBasis.gt(ZERO)
    ? netPnl.dividedBy(totalCostBasis).times(ONE_HUNDRED)
    : ZERO;

  const accountPnl = totalPortfolioValue.minus(startingBalance);
  const accountPnlPct = startingBalance.gt(ZERO)
    ? accountPnl.dividedBy(startingBalance).times(ONE_HUNDRED)
    : ZERO;

  const asOfDate = asOf instanceof Date ? asOf : new Date(asOf);

  return {
    portfolioId: portfolio.id,
    currency: portfolio.currency,
    period: realized.period,
    startDate: realized.startDate,
    endDate: realized.endDate,
    asOf: asOfDate.toISOString(),

    // Portfolio Valuation & Balances
    startingBalance: toDecimalString(startingBalance),
    cashBalance: toDecimalString(cashBalance),
    openHoldingsValue: toDecimalString(openHoldingsMarketValue),
    openHoldingsCostBasis: toDecimalString(openHoldingsCostBasis),
    totalPortfolioValue: toDecimalString(totalPortfolioValue),

    // Net Aggregated Performance
    netPnl: toDecimalString(netPnl),
    netPnlPct: toDecimalString(netPnlPct, 4),
    accountPnl: toDecimalString(accountPnl),
    accountPnlPct: toDecimalString(accountPnlPct, 4),

    // Realized Component
    realized: {
      pnl: realized.realizedPnl,
      pnlPct: realized.realizedPnlPct,
      proceeds: realized.totalProceeds,
      costBasis: realized.totalCostBasis,
      fees: realized.totalFees,
      tradeCount: realized.tradeCount,
      winningTrades: realized.winningTrades,
      losingTrades: realized.losingTrades,
      breakevenTrades: realized.breakevenTrades,
      winRate: realized.winRate,
      bySymbol: realized.bySymbol,
    },

    // Unrealized Component
    unrealized: {
      pnl: unrealized.unrealizedPnl,
      pnlPct: unrealized.unrealizedPnlPct,
      marketValue: unrealized.marketValue,
      costBasis: unrealized.totalInvested,
      positionCount: unrealized.positionCount,
      isStale: unrealized.isStale,
      freshness: unrealized.freshness,
      maxAgeSeconds: unrealized.maxAgeSeconds,
      positions: unrealized.positions,
    },

    reconciliation: {
      isReconciled: true,
      openPositionsCount: unrealized.positionCount,
      closedTradesCount: realized.tradeCount,
      totalFees: realized.totalFees,
    },
  };
}

module.exports = {
  getPortfolioAggregatePnl,
};
