const prisma = require("../config/database");

/**
 * Format a PerformanceSnapshot database model into a clean DTO with Decimal strings.
 */
function serializeSnapshot(snapshot) {
  if (!snapshot) return null;

  return {
    id: snapshot.id,
    portfolioId: snapshot.portfolioId,
    totalValue: snapshot.totalValue.toString(),
    cashBalance: snapshot.cashBalance.toString(),
    holdingsValue: snapshot.holdingsValue.toString(),
    dailyPnl: snapshot.dailyPnl.toString(),
    dailyPnlPct: snapshot.dailyPnlPct.toString(),
    snapshotDate: snapshot.snapshotDate instanceof Date
      ? snapshot.snapshotDate.toISOString().slice(0, 10)
      : String(snapshot.snapshotDate).slice(0, 10),
    createdAt: snapshot.createdAt,
  };
}

/**
 * Upsert a daily snapshot record for a portfolio.
 */
async function upsertSnapshot(client, {
  portfolioId,
  snapshotDate,
  totalValue,
  cashBalance,
  holdingsValue,
  dailyPnl,
  dailyPnlPct,
}) {
  const db = client || prisma;
  const dateObj = snapshotDate instanceof Date
    ? snapshotDate
    : new Date(`${snapshotDate}T00:00:00.000Z`);

  return db.performanceSnapshot.upsert({
    where: {
      portfolioId_snapshotDate: {
        portfolioId,
        snapshotDate: dateObj,
      },
    },
    create: {
      portfolioId,
      snapshotDate: dateObj,
      totalValue,
      cashBalance,
      holdingsValue,
      dailyPnl,
      dailyPnlPct,
    },
    update: {
      totalValue,
      cashBalance,
      holdingsValue,
      dailyPnl,
      dailyPnlPct,
    },
  });
}

/**
 * Retrieve chronological snapshots for a portfolio within an optional date range.
 */
async function findSnapshots({ portfolioId, fromDate, toDate }, client = prisma) {
  const where = {
    portfolioId,
  };

  if (fromDate || toDate) {
    where.snapshotDate = {};
    if (fromDate) {
      where.snapshotDate.gte = fromDate instanceof Date
        ? fromDate
        : new Date(`${fromDate}T00:00:00.000Z`);
    }
    if (toDate) {
      where.snapshotDate.lte = toDate instanceof Date
        ? toDate
        : new Date(`${toDate}T00:00:00.000Z`);
    }
  }

  return client.performanceSnapshot.findMany({
    where,
    orderBy: {
      snapshotDate: "asc",
    },
  });
}

/**
 * Find the latest snapshot prior to or on a specific date.
 */
async function findLatestSnapshot(portfolioId, beforeDate = null, client = prisma) {
  const where = { portfolioId };

  if (beforeDate) {
    where.snapshotDate = {
      lt: beforeDate instanceof Date
        ? beforeDate
        : new Date(`${beforeDate}T00:00:00.000Z`),
    };
  }

  return client.performanceSnapshot.findFirst({
    where,
    orderBy: {
      snapshotDate: "desc",
    },
  });
}

module.exports = {
  serializeSnapshot,
  upsertSnapshot,
  findSnapshots,
  findLatestSnapshot,
};
