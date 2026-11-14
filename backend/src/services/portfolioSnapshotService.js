const { Prisma } = require("@prisma/client");
const prisma = require("../config/database");
const logger = require("../utils/logger");
const { calculatePortfolioValuation } = require("./portfolioValuationService");
const {
  upsertSnapshot,
  findLatestSnapshot,
  serializeSnapshot,
} = require("./portfolioSnapshotRepository");

const ZERO = new Prisma.Decimal(0);

function toUtcDateString(dateInput) {
  if (!dateInput) {
    return new Date().toISOString().slice(0, 10);
  }
  if (dateInput instanceof Date) {
    return dateInput.toISOString().slice(0, 10);
  }
  const str = String(dateInput);
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    return str;
  }
  return new Date(str).toISOString().slice(0, 10);
}

function getUtcEndOfDay(dateInput) {
  const dateStr = toUtcDateString(dateInput);
  return new Date(`${dateStr}T23:59:59.999Z`);
}

/**
 * Capture and persist a performance snapshot for a portfolio as of a specific UTC date.
 *
 * Rules:
 * 1. Computes live market valuation (throws if prices are unavailable).
 * 2. Compares against the previous snapshot to calculate dailyPnl and dailyPnlPct.
 * 3. If no previous snapshot exists, compares against startingBalance as baseline.
 * 4. Upserts into PerformanceSnapshot idempotently for (portfolioId, snapshotDate).
 */
async function capturePortfolioSnapshot(
  portfolioId,
  {
    asOf = null,
    snapshotDate = null,
    priceProvider,
    client = prisma,
  } = {},
) {
  let snapshotDateStr;
  let asOfDate;

  if (snapshotDate) {
    snapshotDateStr = toUtcDateString(snapshotDate);
    asOfDate = asOf
      ? (asOf instanceof Date ? asOf : new Date(asOf))
      : getUtcEndOfDay(snapshotDateStr);
  } else if (asOf) {
    asOfDate = asOf instanceof Date ? asOf : new Date(asOf);
    snapshotDateStr = toUtcDateString(asOfDate);
  } else {
    asOfDate = new Date();
    snapshotDateStr = toUtcDateString(asOfDate);
  }

  const snapshotDateObj = new Date(`${snapshotDateStr}T00:00:00.000Z`);

  const valuation = await calculatePortfolioValuation(portfolioId, {
    client,
    priceProvider,
    asOf: asOfDate,
  });

  // Find the most recent snapshot strictly before this date
  const previousSnapshot = await findLatestSnapshot(
    portfolioId,
    snapshotDateObj,
    client,
  );

  let dailyPnl = ZERO;
  let dailyPnlPct = ZERO;

  if (previousSnapshot) {
    const prevTotal = new Prisma.Decimal(previousSnapshot.totalValue);
    dailyPnl = valuation.totalValue.minus(prevTotal);
    dailyPnlPct = prevTotal.gt(ZERO)
      ? dailyPnl.dividedBy(prevTotal)
      : ZERO;
  } else {
    // Baseline anchor: compare against portfolio starting balance
    const portfolio = await client.portfolio.findUnique({
      where: { id: portfolioId },
      select: { startingBalance: true },
    });
    if (portfolio) {
      const starting = new Prisma.Decimal(portfolio.startingBalance);
      dailyPnl = valuation.totalValue.minus(starting);
      dailyPnlPct = starting.gt(ZERO)
        ? dailyPnl.dividedBy(starting)
        : ZERO;
    }
  }

  const snapshot = await upsertSnapshot(client, {
    portfolioId,
    snapshotDate: snapshotDateObj,
    totalValue: valuation.totalValue,
    cashBalance: valuation.cashBalance,
    holdingsValue: valuation.holdingsValue,
    dailyPnl,
    dailyPnlPct,
  });

  const serialized = serializeSnapshot(snapshot);
  return {
    ...serialized,
    asOf: asOfDate.toISOString(),
  };
}

/**
 * Capture performance snapshots for all active portfolios as of a specific date.
 * Used by scheduled background workers and batch scripts.
 *
 * @param {Object} [options]
 * @param {string|Date} [options.targetDate]
 * @param {Date} [options.asOf]
 * @param {Object} [options.priceProvider]
 * @param {Object} [options.client]
 * @returns {Promise<{
 *   snapshotDate: string,
 *   asOf: string,
 *   totalPortfolios: number,
 *   successful: number,
 *   failed: number,
 *   errors: Array<{ portfolioId: string, error: string }>
 * }>}
 */
async function captureAllPortfolioSnapshots({
  targetDate = null,
  asOf = null,
  priceProvider,
  client = prisma,
} = {}) {
  const portfolios = await client.portfolio.findMany({
    where: { isActive: true },
    select: { id: true },
  });

  let snapshotDateStr;
  let asOfDate;

  if (targetDate) {
    snapshotDateStr = toUtcDateString(targetDate);
    asOfDate = asOf
      ? (asOf instanceof Date ? asOf : new Date(asOf))
      : getUtcEndOfDay(snapshotDateStr);
  } else if (asOf) {
    asOfDate = asOf instanceof Date ? asOf : new Date(asOf);
    snapshotDateStr = toUtcDateString(asOfDate);
  } else {
    const now = new Date();
    const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1));
    snapshotDateStr = toUtcDateString(prev);
    asOfDate = getUtcEndOfDay(snapshotDateStr);
  }

  const results = {
    snapshotDate: snapshotDateStr,
    asOf: asOfDate.toISOString(),
    totalPortfolios: portfolios.length,
    successful: 0,
    failed: 0,
    errors: [],
  };

  for (const portfolio of portfolios) {
    try {
      await capturePortfolioSnapshot(portfolio.id, {
        asOf: asOfDate,
        snapshotDate: snapshotDateStr,
        priceProvider,
        client,
      });
      results.successful += 1;
    } catch (err) {
      results.failed += 1;
      results.errors.push({
        portfolioId: portfolio.id,
        error: err.message,
      });
      logger.warn(
        `Failed to capture daily snapshot for portfolio ${portfolio.id}: ${err.message}`,
      );
    }
  }

  return results;
}

module.exports = {
  toUtcDateString,
  getUtcEndOfDay,
  capturePortfolioSnapshot,
  captureAllPortfolioSnapshots,
};

