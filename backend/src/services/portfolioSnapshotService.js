const { Prisma } = require("@prisma/client");
const prisma = require("../config/database");
const { calculatePortfolioValuation } = require("./portfolioValuationService");
const {
  upsertSnapshot,
  findLatestSnapshot,
  serializeSnapshot,
} = require("./portfolioSnapshotRepository");

const ZERO = new Prisma.Decimal(0);

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
    asOf = new Date(),
    priceProvider,
    client = prisma,
  } = {},
) {
  const valuation = await calculatePortfolioValuation(portfolioId, {
    client,
    priceProvider,
    asOf,
  });

  const snapshotDateStr = asOf instanceof Date
    ? asOf.toISOString().slice(0, 10)
    : String(asOf).slice(0, 10);
  const snapshotDateObj = new Date(`${snapshotDateStr}T00:00:00.000Z`);

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

  return serializeSnapshot(snapshot);
}

module.exports = {
  capturePortfolioSnapshot,
};
