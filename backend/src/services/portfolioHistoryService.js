const { Prisma } = require("@prisma/client");
const prisma = require("../config/database");
const { AppError } = require("../utils/errors");
const { toUtcDateString, parseUtcDateBoundary } = require("../utils/dateUtils");

const ZERO = new Prisma.Decimal(0);
const MAX_RANGE_DAYS = 365;

function toDecimalString(val, decimals = 8) {
  if (val === null || val === undefined) return null;
  const d = val instanceof Prisma.Decimal ? val : new Prisma.Decimal(val);
  return d.toFixed(decimals);
}

/**
 * Expose historical portfolio state for a requested time range using stored snapshots
 * and existing trade/position data where appropriate.
 *
 * Rules:
 * - Date Range: Validates format and ensures `from <= to`, capped at a max of 365 days.
 * - Ownership: Ensures authenticated user owns the portfolio.
 * - Data Consistency: Combines verified daily valuation snapshots with daily executed trade metrics.
 * - Gap Tracking: Identifies and records contiguous missing date ranges where no snapshot exists
 *   without inventing fabricated values.
 *
 * @param {string} userId - Authenticated user UUID
 * @param {string} portfolioId - Target portfolio UUID
 * @param {Object} options
 * @param {string|Date} [options.from] - Start date (defaults to 30 days ago)
 * @param {string|Date} [options.to] - End date (defaults to current date)
 * @param {Object} [options.client] - Prisma client override
 * @returns {Promise<Object>} Chronological historical portfolio state with gap metadata
 */
async function getPortfolioHistoricalState(
  userId,
  portfolioId,
  {
    from = null,
    to = null,
    client = prisma,
  } = {},
) {
  // 1. Ownership check
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

  // 2. Date resolution and bounds validation
  const now = new Date();
  const defaultFrom = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() - 30,
    0,
    0,
    0,
    0,
  ));

  const startDate = from ? parseUtcDateBoundary(from, false) : defaultFrom;
  const endDate = to ? parseUtcDateBoundary(to, true) : parseUtcDateBoundary(now, true);

  if (startDate > endDate) {
    throw AppError.badRequest("'from' date cannot be after 'to' date.", "INVALID_DATE_RANGE");
  }

  const msPerDay = 24 * 60 * 60 * 1000;
  // endDate is 23:59:59.999 of the final day, so the difference is already one
  // day short of the inclusive count. Rounding up added an extra day and made
  // an exact 365-day request report 366.
  const requestedDays =
    Math.floor((endDate.getTime() - startDate.getTime()) / msPerDay) + 1;

  if (requestedDays > MAX_RANGE_DAYS) {
    throw AppError.badRequest(
      `Requested date range (${requestedDays} days) exceeds maximum allowed window of ${MAX_RANGE_DAYS} days.`,
      "DATE_RANGE_TOO_LARGE",
    );
  }

  // 3. Query snapshots in range
  const snapshots = await client.performanceSnapshot.findMany({
    where: {
      portfolioId,
      snapshotDate: {
        gte: startDate,
        lte: endDate,
      },
    },
    orderBy: {
      snapshotDate: "asc",
    },
  });

  // 4. Query and aggregate trades in range by UTC date
  const trades = await client.trade.findMany({
    where: {
      portfolioId,
      executedAt: {
        gte: startDate,
        lte: endDate,
      },
    },
    select: {
      executedAt: true,
      totalValue: true,
    },
  });

  const tradesByDate = new Map();
  for (const trade of trades) {
    const dateStr = toUtcDateString(trade.executedAt);
    const existing = tradesByDate.get(dateStr) || { count: 0, volume: ZERO };
    existing.count += 1;
    existing.volume = existing.volume.plus(new Prisma.Decimal(trade.totalValue));
    tradesByDate.set(dateStr, existing);
  }

  // 5. Index recorded snapshot dates and deduplicate by distinct UTC date
  const snapshotDateSet = new Set();
  const historyByDate = new Map();

  for (const s of snapshots) {
    const dateStr = toUtcDateString(s.snapshotDate);
    snapshotDateSet.add(dateStr);

    const tradeActivity = tradesByDate.get(dateStr) || { count: 0, volume: ZERO };

    // In the event of duplicate snapshot records on the same date, latest row prevails
    historyByDate.set(dateStr, {
      date: dateStr,
      totalValue: toDecimalString(s.totalValue),
      cashBalance: toDecimalString(s.cashBalance),
      holdingsValue: toDecimalString(s.holdingsValue),
      dailyPnl: toDecimalString(s.dailyPnl),
      dailyPnlPct: s.dailyPnlPct !== null && s.dailyPnlPct !== undefined
        ? new Prisma.Decimal(s.dailyPnlPct).times(100).toFixed(4)
        : "0.0000",
      tradesCount: tradeActivity.count,
      tradeVolume: toDecimalString(tradeActivity.volume),
    });
  }

  const history = Array.from(historyByDate.values());

  // 6. Identify gaps where no reliable snapshot record exists
  const gaps = [];
  let currentGap = null;

  const curDate = new Date(Date.UTC(
    startDate.getUTCFullYear(),
    startDate.getUTCMonth(),
    startDate.getUTCDate(),
  ));
  const endCompare = new Date(Date.UTC(
    endDate.getUTCFullYear(),
    endDate.getUTCMonth(),
    endDate.getUTCDate(),
  ));

  let totalCalendarDays = 0;
  while (curDate <= endCompare) {
    totalCalendarDays += 1;
    const dateStr = toUtcDateString(curDate);

    if (!snapshotDateSet.has(dateStr)) {
      if (!currentGap) {
        currentGap = {
          from: dateStr,
          to: dateStr,
          missingDays: 1,
        };
      } else {
        currentGap.to = dateStr;
        currentGap.missingDays += 1;
      }
    } else if (currentGap) {
      gaps.push(currentGap);
      currentGap = null;
    }

    curDate.setUTCDate(curDate.getUTCDate() + 1);
  }

  if (currentGap) {
    gaps.push(currentGap);
  }

  // Derive gap metadata from distinct recorded UTC dates
  const recordedDays = snapshotDateSet.size;
  const missingDays = Math.max(0, totalCalendarDays - recordedDays);

  return {
    portfolioId,
    metadata: {
      requestedRange: {
        from: toUtcDateString(startDate),
        to: toUtcDateString(endDate),
      },
      totalDays: totalCalendarDays,
      recordedDays,
      missingDays,
      hasGaps: gaps.length > 0,
      gaps,
    },
    history,
  };
}

module.exports = {
  getPortfolioHistoricalState,
  parseUtcDateBoundary,
  MAX_RANGE_DAYS,
};
