const { Prisma } = require("@prisma/client");
const prisma = require("../config/database");
const { AppError } = require("../utils/errors");
const { toDecimalString } = require("../utils/decimal");
const { resolveDateRange } = require("./portfolioSeriesService");
const { parseUtcDateBoundary } = require("../utils/dateUtils");

const ZERO = new Prisma.Decimal(0);
const ONE_HUNDRED = new Prisma.Decimal(100);

function toIsoDateString(date) {
  if (!date) return null;
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}


/**
 * Expose portfolio performance for a requested period using the approved return methodology.
 *
 * Return methodology & invariants:
 * - Baseline: Valuation is anchored to the latest snapshot strictly prior to period start.
 *   If no prior snapshot exists, falls back to the earliest recorded snapshot in the window
 *   or the portfolio's starting balance.
 * - Time-Weighted Return (TWR): Compounded product of daily snapshot return factors.
 *   When the earliest snapshot in the requested window is itself the baseline (period_start_snapshot),
 *   its daily return occurred at or prior to that baseline valuation and is not compounded into
 *   post-baseline performance, keeping returnPct and timeWeightedReturnPct aligned to identical
 *   period boundaries across presets, custom ranges, and ALL.
 * - Net P&L: endValue - startValue.
 * - Return %: (netPnl / startValue) * 100, formatted to 4 decimal places.
 * - Realized P&L: Aggregated from closed trades executed within [startDate, endDate].
 * - Unrealized P&L: Change in unrealized value (netPnl - realizedPnl).
 * - Cash-flow / Baseline continuity: Cash is tracked inside snapshot totalValue without
 *   distorting trading returns.
 * - Bounded time period: Returns chronological daily snapshots without synthetic gaps.
 *
 * @param {string} userId - Authenticated user UUID
 * @param {string} portfolioId - Target portfolio UUID
 * @param {Object} [options]
 * @param {string} [options.period="1M"] - 1W, 1M, 3M, 6M, 1Y, YTD, ALL
 * @param {string|Date} [options.from] - Custom start date boundary
 * @param {string|Date} [options.to] - Custom end date boundary
 * @param {number|string} [options.year] - Calendar year filter
 * @param {Date} [options.asOf] - Reference evaluation date
 * @param {Object} [options.client] - Prisma client override
 * @returns {Promise<Object>} Detailed portfolio performance summary and return series
 */
async function getPortfolioPerformance(
  userId,
  portfolioId,
  {
    period = "1M",
    from = null,
    to = null,
    year = null,
    asOf = new Date(),
    client = prisma,
  } = {},
) {
  // 1. Verify portfolio ownership
  const portfolio = await client.portfolio.findFirst({
    where: {
      id: portfolioId,
      userId,
    },
    select: {
      id: true,
      name: true,
      startingBalance: true,
      cashBalance: true,
      createdAt: true,
      isActive: true,
    },
  });

  if (!portfolio) {
    throw AppError.notFound("Portfolio not found.", "PORTFOLIO_NOT_FOUND");
  }

  // 2. Resolve date boundaries
  let startDate = null;
  let endDate = null;
  let normalizedPeriod = (period || "1M").toUpperCase();

  if (from || to) {
    normalizedPeriod = "CUSTOM";
    if (from) {
      startDate = parseUtcDateBoundary(from, false, "INVALID_DATE_RANGE");
    }
    if (to) {
      endDate = parseUtcDateBoundary(to, true, "INVALID_DATE_RANGE");
    } else {
      endDate = asOf instanceof Date ? asOf : new Date(asOf);
    }

    if (startDate && endDate && startDate > endDate) {
      throw AppError.badRequest("'from' date cannot be after 'to' date.", "INVALID_DATE_RANGE");
    }
  } else {
    const resolved = resolveDateRange({ period: normalizedPeriod, year, asOf });
    startDate = resolved.startDate;
    endDate = resolved.endDate;
    normalizedPeriod = resolved.normalizedPeriod;
  }

  // 3. Query performance snapshots in the requested window
  const snapshotWhere = { portfolioId };
  if (startDate && endDate) {
    snapshotWhere.snapshotDate = { gte: startDate, lte: endDate };
  } else if (startDate) {
    snapshotWhere.snapshotDate = { gte: startDate };
  } else if (endDate) {
    snapshotWhere.snapshotDate = { lte: endDate };
  }

  const snapshots = await client.performanceSnapshot.findMany({
    where: snapshotWhere,
    orderBy: { snapshotDate: "asc" },
  });

  // 4. Determine baseline valuation
  let priorSnapshot = null;
  if (startDate) {
    priorSnapshot = await client.performanceSnapshot.findFirst({
      where: {
        portfolioId,
        snapshotDate: { lt: startDate },
      },
      orderBy: { snapshotDate: "desc" },
    });
  }

  let baseline = null;
  let startValue = ZERO;

  if (priorSnapshot) {
    startValue = new Prisma.Decimal(priorSnapshot.totalValue);
    baseline = {
      date: toIsoDateString(priorSnapshot.snapshotDate),
      source: "prior_snapshot",
      totalValue: toDecimalString(priorSnapshot.totalValue),
      cashBalance: toDecimalString(priorSnapshot.cashBalance),
      holdingsValue: toDecimalString(priorSnapshot.holdingsValue),
    };
  } else if (snapshots.length > 0) {
    const firstSnap = snapshots[0];
    startValue = new Prisma.Decimal(firstSnap.totalValue);
    baseline = {
      date: toIsoDateString(firstSnap.snapshotDate),
      source: "period_start_snapshot",
      totalValue: toDecimalString(firstSnap.totalValue),
      cashBalance: toDecimalString(firstSnap.cashBalance),
      holdingsValue: toDecimalString(firstSnap.holdingsValue),
    };
  } else {
    const startingBal = new Prisma.Decimal(portfolio.startingBalance);
    startValue = startingBal;
    baseline = {
      date: toIsoDateString(portfolio.createdAt),
      source: "starting_balance",
      totalValue: toDecimalString(startingBal),
      cashBalance: toDecimalString(portfolio.cashBalance),
      holdingsValue: toDecimalString(ZERO),
    };
  }

  // 5. Ending / Current valuation
  let current = null;
  let endValue = startValue;

  if (snapshots.length > 0) {
    const lastSnap = snapshots[snapshots.length - 1];
    endValue = new Prisma.Decimal(lastSnap.totalValue);
    current = {
      date: toIsoDateString(lastSnap.snapshotDate),
      totalValue: toDecimalString(lastSnap.totalValue),
      cashBalance: toDecimalString(lastSnap.cashBalance),
      holdingsValue: toDecimalString(lastSnap.holdingsValue),
    };
  } else {
    current = {
      date: toIsoDateString(endDate || asOf),
      totalValue: toDecimalString(endValue),
      cashBalance: toDecimalString(portfolio.cashBalance),
      holdingsValue: toDecimalString(ZERO),
    };
  }

  // 6. Query realized trades & fees in date range
  const tradeConditions = { portfolioId };
  if (startDate && endDate) {
    tradeConditions.executedAt = { gte: startDate, lte: endDate };
  } else if (startDate) {
    tradeConditions.executedAt = { gte: startDate };
  } else if (endDate) {
    tradeConditions.executedAt = { lte: endDate };
  }

  const tradeAggregate = await client.trade.aggregate({
    where: tradeConditions,
    _sum: {
      realizedPnl: true,
      fees: true,
    },
    _count: {
      id: true,
    },
  });

  const realizedPnl = tradeAggregate._sum.realizedPnl
    ? new Prisma.Decimal(tradeAggregate._sum.realizedPnl)
    : ZERO;
  const realizedFees = tradeAggregate._sum.fees
    ? new Prisma.Decimal(tradeAggregate._sum.fees)
    : ZERO;
  const tradesCount = tradeAggregate._count.id || 0;

  // 7. Calculate P&L and Returns
  const netPnl = endValue.minus(startValue);
  const unrealizedPnl = netPnl.minus(realizedPnl);

  const returnPct = startValue.gt(ZERO)
    ? netPnl.dividedBy(startValue).times(ONE_HUNDRED).toFixed(4)
    : "0.0000";

  // 8. Analyze return series, best/worst day, and time-weighted compounding
  let bestDay = null;
  let worstDay = null;
  let twrProduct = new Prisma.Decimal(1);

  const isBaselineFirstSnapshot = baseline?.source === "period_start_snapshot";

  const series = snapshots.map((s, idx) => {
    const sDate = toIsoDateString(s.snapshotDate);
    const dailyPnl = new Prisma.Decimal(s.dailyPnl);
    const dailyReturn = s.dailyPnlPct !== null && s.dailyPnlPct !== undefined
      ? new Prisma.Decimal(s.dailyPnlPct)
      : ZERO;

    // Compound daily returns for TWR: (1 + r_1) * (1 + r_2)...
    // When the earliest snapshot is itself the baseline, its return occurred at or before
    // the baseline valuation and is not compounded into performance after the baseline.
    if (!isBaselineFirstSnapshot || idx > 0) {
      twrProduct = twrProduct.times(new Prisma.Decimal(1).plus(dailyReturn));
    }

    if (!bestDay || dailyPnl.gt(new Prisma.Decimal(bestDay.pnl))) {
      bestDay = {
        date: sDate,
        pnl: toDecimalString(dailyPnl),
        returnPct: dailyReturn.times(ONE_HUNDRED).toFixed(4),
      };
    }

    if (!worstDay || dailyPnl.lt(new Prisma.Decimal(worstDay.pnl))) {
      worstDay = {
        date: sDate,
        pnl: toDecimalString(dailyPnl),
        returnPct: dailyReturn.times(ONE_HUNDRED).toFixed(4),
      };
    }

    return {
      date: sDate,
      totalValue: toDecimalString(s.totalValue),
      cashBalance: toDecimalString(s.cashBalance),
      holdingsValue: toDecimalString(s.holdingsValue),
      dailyPnl: toDecimalString(dailyPnl),
      dailyReturnPct: dailyReturn.times(ONE_HUNDRED).toFixed(4),
    };
  });

  const timeWeightedReturnPct = snapshots.length > 0
    ? twrProduct.minus(new Prisma.Decimal(1)).times(ONE_HUNDRED).toFixed(4)
    : "0.0000";

  return {
    portfolioId,
    period: normalizedPeriod,
    startDate: startDate ? startDate.toISOString() : null,
    endDate: endDate ? endDate.toISOString() : null,
    asOf: asOf instanceof Date ? asOf.toISOString() : new Date(asOf).toISOString(),
    baseline,
    current,
    performance: {
      startValue: toDecimalString(startValue),
      endValue: toDecimalString(endValue),
      netPnl: toDecimalString(netPnl),
      returnPct,
      timeWeightedReturnPct,
      realizedPnl: toDecimalString(realizedPnl),
      unrealizedPnl: toDecimalString(unrealizedPnl),
      fees: toDecimalString(realizedFees),
      tradesCount,
      bestDay,
      worstDay,
    },
    series,
  };
}

module.exports = {
  getPortfolioPerformance,
};
