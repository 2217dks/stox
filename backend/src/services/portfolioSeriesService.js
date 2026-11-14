const { Prisma } = require("@prisma/client");
const prisma = require("../config/database");
const {
  findSnapshots,
  findLatestSnapshot,
} = require("./portfolioSnapshotRepository");

const ZERO = new Prisma.Decimal(0);

/**
 * Resolve start and end UTC Date boundaries for a specified period or calendar year.
 *
 * @param {Object} options
 * @param {string} [options.period="1M"] - 1W, 1M, 3M, 6M, 1Y, YTD, ALL
 * @param {number|string} [options.year] - e.g. 2026
 * @param {Date} [options.asOf] - Reference date (defaults to current date)
 * @returns {{ startDate: Date|null, endDate: Date, normalizedPeriod: string }}
 */
function resolveDateRange({ period = "1M", year = null, asOf = new Date() } = {}) {
  const reference = asOf instanceof Date ? asOf : new Date(asOf);

  if (year !== null && year !== undefined && String(year).trim() !== "") {
    const y = parseInt(year, 10);
    const startDate = new Date(Date.UTC(y, 0, 1, 0, 0, 0, 0));
    const endDate = new Date(Date.UTC(y, 11, 31, 23, 59, 59, 999));
    return { startDate, endDate, normalizedPeriod: String(y) };
  }

  const normalizedPeriod = (period || "1M").toUpperCase();
  const endDate = new Date(Date.UTC(
    reference.getUTCFullYear(),
    reference.getUTCMonth(),
    reference.getUTCDate(),
    23,
    59,
    59,
    999,
  ));

  let startDate = new Date(Date.UTC(
    reference.getUTCFullYear(),
    reference.getUTCMonth(),
    reference.getUTCDate(),
    0,
    0,
    0,
    0,
  ));

  switch (normalizedPeriod) {
    case "1W":
      startDate.setUTCDate(startDate.getUTCDate() - 7);
      break;
    case "1M":
      startDate.setUTCDate(startDate.getUTCDate() - 30);
      break;
    case "3M":
      startDate.setUTCDate(startDate.getUTCDate() - 90);
      break;
    case "6M":
      startDate.setUTCDate(startDate.getUTCDate() - 180);
      break;
    case "1Y":
      startDate.setUTCDate(startDate.getUTCDate() - 365);
      break;
    case "YTD":
      startDate = new Date(Date.UTC(reference.getUTCFullYear(), 0, 1, 0, 0, 0, 0));
      break;
    case "ALL":
      startDate = null;
      break;
    default:
      // Fallback default to 30 days (1M)
      startDate.setUTCDate(startDate.getUTCDate() - 30);
      break;
  }

  return { startDate, endDate, normalizedPeriod };
}

/**
 * Fetch and normalize the chronological performance return series for a portfolio.
 *
 * Invariant: Read-only query over finalized PerformanceSnapshot records. Never
 * fabricates or captures intraday snapshots for unfinished calendar days.
 *
 * @param {string} portfolioId
 * @param {Object} options
 * @param {string} [options.period="1M"]
 * @param {number|string} [options.year]
 * @param {Date} [options.asOf]
 * @param {Object} [options.client]
 * @returns {Promise<{
 *   portfolioId: string,
 *   period: string,
 *   startDate: Date|null,
 *   endDate: Date,
 *   series: Array<{
 *     date: string,
 *     totalValue: Prisma.Decimal,
 *     cashBalance: Prisma.Decimal,
 *     holdingsValue: Prisma.Decimal,
 *     dailyPnl: Prisma.Decimal,
 *     dailyReturn: Prisma.Decimal
 *   }>,
 *   cumulativeReturn: Prisma.Decimal
 * }>}
 */
async function getPortfolioReturnSeries(portfolioId, {
  period = "1M",
  year = null,
  asOf = new Date(),
  client = prisma,
} = {}) {
  const reference = asOf instanceof Date ? asOf : new Date(asOf);

  const { startDate, endDate, normalizedPeriod } = resolveDateRange({
    period,
    year,
    asOf: reference,
  });

  const snapshots = await findSnapshots({
    portfolioId,
    fromDate: startDate,
    toDate: endDate,
  }, client);

  const series = snapshots.map((s) => {
    const dateStr = s.snapshotDate instanceof Date
      ? s.snapshotDate.toISOString().slice(0, 10)
      : String(s.snapshotDate).slice(0, 10);

    return {
      date: dateStr,
      totalValue: new Prisma.Decimal(s.totalValue),
      cashBalance: new Prisma.Decimal(s.cashBalance),
      holdingsValue: new Prisma.Decimal(s.holdingsValue),
      dailyPnl: new Prisma.Decimal(s.dailyPnl),
      dailyReturn: s.dailyPnlPct !== null && s.dailyPnlPct !== undefined
        ? new Prisma.Decimal(s.dailyPnlPct)
        : null,
    };
  });

  let cumulativeReturn = ZERO;
  if (series.length >= 2) {
    const firstVal = series[0].totalValue;
    const lastVal = series[series.length - 1].totalValue;
    if (firstVal.gt(ZERO)) {
      cumulativeReturn = lastVal.minus(firstVal).dividedBy(firstVal);
    }
  }

  return {
    portfolioId,
    period: normalizedPeriod,
    startDate,
    endDate,
    series,
    cumulativeReturn,
  };
}

module.exports = {
  resolveDateRange,
  getPortfolioReturnSeries,
};
