const prisma = require("../config/database");
const { Prisma } = require("@prisma/client");
const { AppError } = require("../utils/errors");
const { findSnapshots, findLatestSnapshot } = require("./portfolioSnapshotRepository");

const ZERO = new Prisma.Decimal(0);
const ONE_HUNDRED = new Prisma.Decimal(100);

function toDecimalString(val) {
  if (val === null || val === undefined) return null;
  return val.toString();
}

/**
 * Format a Date to UTC YYYY-MM string.
 */
function toUtcYearMonth(date) {
  const d = date instanceof Date ? date : new Date(date);
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

/**
 * Returns the UTC YYYY-MM string for the calendar month immediately preceding yearMonthStr.
 * E.g. "2026-03" -> "2026-02", "2026-01" -> "2025-12".
 */
function getPreviousUtcYearMonth(yearMonthStr) {
  const [year, month] = yearMonthStr.split("-").map(Number);
  if (month === 1) {
    return `${year - 1}-12`;
  }
  return `${year}-${String(month - 1).padStart(2, "0")}`;
}

/**
 * Get the first UTC millisecond of a month from a YYYY-MM string.
 */
function getUtcMonthStart(yearMonthStr) {
  const [year, month] = yearMonthStr.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
}

/**
 * Get the last UTC millisecond of a month from a YYYY-MM string.
 */
function getUtcMonthEnd(yearMonthStr) {
  const [year, month] = yearMonthStr.split("-").map(Number);
  return new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
}

/**
 * Aggregates portfolio performance into UTC calendar-month buckets.
 *
 * @param {string} portfolioId - Portfolio UUID.
 * @param {string} userId - Authenticated user UUID.
 * @param {Object} options - Optional filters { year, from, to }.
 * @returns {Promise<Object>} Aggregated monthly performance breakdown.
 */
async function getPortfolioMonthlyPerformance(portfolioId, userId, options = {}) {
  // 1. Verify portfolio ownership
  const portfolio = await prisma.portfolio.findFirst({
    where: {
      id: portfolioId,
      userId,
    },
    select: { id: true },
  });

  if (!portfolio) {
    throw AppError.notFound("Portfolio not found.", "PORTFOLIO_NOT_FOUND");
  }

  // 2. Resolve date boundaries
  let fromDate = null;
  let toDate = null;

  if (options.year) {
    fromDate = new Date(Date.UTC(options.year, 0, 1, 0, 0, 0, 0));
    toDate = new Date(Date.UTC(options.year, 11, 31, 23, 59, 59, 999));
  } else {
    if (options.from) {
      if (options.from instanceof Date) {
        fromDate = options.from;
      } else if (typeof options.from === "string" && /^\d{4}-\d{2}$/.test(options.from.trim())) {
        fromDate = getUtcMonthStart(options.from.trim());
      } else {
        fromDate = new Date(options.from);
      }
    }
    if (options.to) {
      if (options.to instanceof Date) {
        toDate = options.to;
      } else if (typeof options.to === "string" && /^\d{4}-\d{2}$/.test(options.to.trim())) {
        toDate = getUtcMonthEnd(options.to.trim());
      } else {
        toDate = new Date(options.to);
      }
    }
  }

  // 3. Query snapshots in range
  const snapshots = await findSnapshots({
    portfolioId,
    fromDate,
    toDate,
  });

  // Query baseline prior to fromDate if range has a start boundary
  let priorSnapshot = null;
  if (fromDate) {
    priorSnapshot = await findLatestSnapshot(portfolioId, fromDate);
  }

  // 4. Query trades in range aggregated by month for realized P&L
  const conditions = [Prisma.sql`t."portfolioId" = ${portfolioId}`];
  if (fromDate) {
    conditions.push(Prisma.sql`t."executedAt" >= ${fromDate}`);
  }
  if (toDate) {
    conditions.push(Prisma.sql`t."executedAt" <= ${toDate}`);
  }

  const tradeMonthlyRows = await prisma.$queryRaw(Prisma.sql`
    SELECT
      TO_CHAR(t."executedAt", 'YYYY-MM') AS "month",
      COALESCE(SUM(t."realizedPnl"), 0)::text AS "realizedPnl"
    FROM "Trade" t
    WHERE ${Prisma.join(conditions, " AND ")}
    GROUP BY "month"
    ORDER BY "month" ASC;
  `);

  const tradePnlByMonth = new Map();
  for (const row of tradeMonthlyRows) {
    tradePnlByMonth.set(row.month, new Prisma.Decimal(row.realizedPnl));
  }

  // 5. Group snapshots and trades by UTC month (YYYY-MM)
  const monthBuckets = new Map();

  function getOrCreateBucket(monthKey) {
    if (!monthBuckets.has(monthKey)) {
      monthBuckets.set(monthKey, {
        month: monthKey,
        snapshots: [],
      });
    }
    return monthBuckets.get(monthKey);
  }

  for (const snapshot of snapshots) {
    const key = toUtcYearMonth(snapshot.snapshotDate);
    getOrCreateBucket(key).snapshots.push(snapshot);
  }

  for (const monthKey of tradePnlByMonth.keys()) {
    getOrCreateBucket(monthKey);
  }

  // Sort months chronologically
  const sortedMonthKeys = Array.from(monthBuckets.keys()).sort();

  const months = [];
  let lastSnapshotMonth = priorSnapshot ? toUtcYearMonth(priorSnapshot.snapshotDate) : null;
  let lastSnapshotEndValue = priorSnapshot ? priorSnapshot.totalValue : null;

  for (const monthKey of sortedMonthKeys) {
    const bucket = monthBuckets.get(monthKey);
    const monthSnapshots = bucket.snapshots;

    // Realized PnL from trades in this month
    const realizedPnl = tradePnlByMonth.get(monthKey) || ZERO;

    if (monthSnapshots.length === 0) {
      // Month with trades but no snapshots: emit realized P&L, null valuation fields
      months.push({
        month: monthKey,
        startValue: null,
        endValue: null,
        netPnl: null,
        returnPct: null,
        realizedPnl: toDecimalString(realizedPnl),
        unrealizedPnl: null,
        snapshotCount: 0,
      });

      // Clear snapshot baseline so subsequent months do not span across missing snapshots
      lastSnapshotMonth = null;
      lastSnapshotEndValue = null;
      continue;
    }

    // Determine startValue:
    // Only use prior ending snapshot if it was recorded in the immediately preceding calendar month
    const expectedPriorMonth = getPreviousUtcYearMonth(monthKey);
    const hasImmediatePriorSnapshot =
      lastSnapshotMonth !== null &&
      lastSnapshotMonth === expectedPriorMonth &&
      lastSnapshotEndValue !== null;

    const startValue = hasImmediatePriorSnapshot
      ? lastSnapshotEndValue
      : monthSnapshots[0].totalValue;

    const endValue = monthSnapshots[monthSnapshots.length - 1].totalValue;
    const netPnl = endValue.minus(startValue);

    let returnPct = null;
    if (startValue.gt(0)) {
      const rawPct = netPnl.dividedBy(startValue).times(ONE_HUNDRED);
      // Format returnPct with 4 decimal places
      returnPct = rawPct.toFixed(4);
    }

    const unrealizedPnl = netPnl.minus(realizedPnl);

    months.push({
      month: monthKey,
      startValue: toDecimalString(startValue),
      endValue: toDecimalString(endValue),
      netPnl: toDecimalString(netPnl),
      returnPct,
      realizedPnl: toDecimalString(realizedPnl),
      unrealizedPnl: toDecimalString(unrealizedPnl),
      snapshotCount: monthSnapshots.length,
    });

    // Update last snapshot baseline for consecutive month tracking
    lastSnapshotMonth = monthKey;
    lastSnapshotEndValue = endValue;
  }

  return {
    portfolioId,
    months,
  };
}

module.exports = {
  getPortfolioMonthlyPerformance,
  toUtcYearMonth,
  getPreviousUtcYearMonth,
  getUtcMonthStart,
  getUtcMonthEnd,
};
