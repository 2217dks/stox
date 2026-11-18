const { Prisma } = require("@prisma/client");
const prisma = require("../config/database");
const logger = require("../utils/logger");
const { calculatePortfolioValuation } = require("./portfolioValuationService");
const {
  upsertSnapshot,
  findLatestSnapshot,
  serializeSnapshot,
} = require("./portfolioSnapshotRepository");

const { AppError } = require("../utils/errors");

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
 * 1. Computes market valuation as of asOf (uses historical close for past dates).
 * 2. Compares against the previous snapshot to calculate dailyPnl and dailyPnlPct.
 * 3. If no previous snapshot exists, compares against startingBalance as baseline.
 * 4. Upserts into PerformanceSnapshot idempotently for (portfolioId, snapshotDate).
 */
async function capturePortfolioSnapshot(
  portfolioId,
  {
    asOf = null,
    snapshotDate = null,
    historical = true,
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
    historical,
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
 * Capture performance snapshots for active portfolios as of a specific date.
 * If portfolioIds is specified, only those portfolios are processed.
 * Otherwise, inspects active portfolios and skips those that already have a snapshot
 * for targetDate (unless force: true is specified).
 *
 * @param {Object} [options]
 * @param {string|Date} [options.targetDate]
 * @param {Date} [options.asOf]
 * @param {Array<string>} [options.portfolioIds]
 * @param {boolean} [options.force=false]
 * @param {Object} [options.priceProvider]
 * @param {Object} [options.client]
 * @returns {Promise<{
 *   snapshotDate: string,
 *   asOf: string,
 *   totalPortfolios: number,
 *   alreadyCaptured: number,
 *   attempted: number,
 *   successful: number,
 *   failed: number,
 *   errors: Array<{ portfolioId: string, error: string }>
 * }>}
 */
async function captureAllPortfolioSnapshots({
  targetDate = null,
  asOf = null,
  portfolioIds = null,
  force = false,
  priceProvider,
  client = prisma,
} = {}) {
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

  const snapshotDateObj = new Date(`${snapshotDateStr}T00:00:00.000Z`);

  const portfolioWhere = { isActive: true };
  if (Array.isArray(portfolioIds) && portfolioIds.length > 0) {
    portfolioWhere.id = { in: portfolioIds };
  }

  const activePortfolios = await client.portfolio.findMany({
    where: portfolioWhere,
    select: { id: true },
  });

  // Query existing snapshots for this target date among candidate portfolios
  let existingSnapshots = [];
  if (activePortfolios.length > 0) {
    existingSnapshots = await client.performanceSnapshot.findMany({
      where: {
        snapshotDate: snapshotDateObj,
        portfolioId: { in: activePortfolios.map((p) => p.id) },
      },
      select: { portfolioId: true },
    });
  }

  const existingSet = new Set(existingSnapshots.map((s) => s.portfolioId));
  const portfoliosToCapture = force
    ? activePortfolios
    : activePortfolios.filter((p) => !existingSet.has(p.id));

  const results = {
    snapshotDate: snapshotDateStr,
    asOf: asOfDate.toISOString(),
    totalPortfolios: activePortfolios.length,
    alreadyCaptured: existingSet.size,
    attempted: portfoliosToCapture.length,
    successful: 0,
    failed: 0,
    errors: [],
  };

  for (const portfolio of portfoliosToCapture) {
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

/**
 * Retrieve chronological daily portfolio snapshots for a caller-owned portfolio.
 */
async function getPortfolioDailySnapshots(
  userId,
  portfolioId,
  {
    from = null,
    to = null,
    limit = 100,
    client = prisma,
  } = {},
) {
  // 1. Validate query parameters before querying database
  let parsedLimit = 100;
  if (limit !== null && limit !== undefined) {
    const num = Number(limit);
    if (!Number.isInteger(num) || num <= 0) {
      throw AppError.badRequest("Limit must be a positive integer.", "INVALID_LIMIT");
    }
    if (num > 1000) {
      throw AppError.badRequest("Limit cannot exceed 1000.", "INVALID_LIMIT");
    }
    parsedLimit = num;
  }

  let fromDate = null;
  if (from !== null && from !== undefined) {
    fromDate = from instanceof Date ? from : new Date(from);
    if (Number.isNaN(fromDate.getTime())) {
      throw AppError.badRequest("Invalid 'from' date parameter.", "INVALID_DATE_RANGE");
    }
  }

  let toDate = null;
  if (to !== null && to !== undefined) {
    toDate = to instanceof Date ? to : new Date(to);
    if (Number.isNaN(toDate.getTime())) {
      throw AppError.badRequest("Invalid 'to' date parameter.", "INVALID_DATE_RANGE");
    }
  }

  if (fromDate && toDate && fromDate.getTime() > toDate.getTime()) {
    throw AppError.badRequest("'from' date cannot be after 'to' date.", "INVALID_DATE_RANGE");
  }

  const db = client || prisma;

  // 2. Validate portfolio existence and caller ownership
  const portfolio = await db.portfolio.findFirst({
    where: {
      id: portfolioId,
      userId,
    },
    select: {
      id: true,
      name: true,
      currency: true,
      isActive: true,
    },
  });

  if (!portfolio) {
    throw AppError.notFound("Portfolio not found.", "PORTFOLIO_NOT_FOUND");
  }

  const where = {
    portfolioId,
  };

  if (fromDate || toDate) {
    where.snapshotDate = {};
    if (fromDate) where.snapshotDate.gte = fromDate;
    if (toDate) where.snapshotDate.lte = toDate;
  }

  // 3. Query the latest window of snapshots and return in chronological order (asc)
  const snapshots = await db.performanceSnapshot.findMany({
    where,
    orderBy: {
      snapshotDate: "desc",
    },
    take: parsedLimit,
  });

  snapshots.reverse();

  const serialized = snapshots.map(serializeSnapshot);

  return {
    portfolioId: portfolio.id,
    from: fromDate ? fromDate.toISOString().slice(0, 10) : null,
    to: toDate ? toDate.toISOString().slice(0, 10) : null,
    count: serialized.length,
    snapshots: serialized,
  };
}

module.exports = {
  toUtcDateString,
  getUtcEndOfDay,
  capturePortfolioSnapshot,
  captureAllPortfolioSnapshots,
  getPortfolioDailySnapshots,
};
