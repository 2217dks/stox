const { Prisma } = require("@prisma/client");
const defaultMarketData = require("./marketData");
const prisma = require("../config/database");
const { resolveDateRange } = require("./portfolioSeriesService");
const { findSnapshots } = require("./portfolioSnapshotRepository");

const ZERO = new Prisma.Decimal(0);

/**
 * Fetch raw benchmark candle history and calculate simple daily returns.
 *
 * @param {string} [symbol="SPY"]
 * @param {Object} [options]
 * @param {string} [options.period="1M"]
 * @param {Date} [options.asOf]
 * @param {string} [options.portfolioId]
 * @param {Object} [options.marketDataProvider]
 * @param {Object} [options.client]
 * @returns {Promise<{
 *   benchmark: string,
 *   period: string,
 *   startDate: Date|null,
 *   endDate: Date,
 *   series: Array<{
 *     date: string,
 *     price: Prisma.Decimal,
 *     dailyReturn: Prisma.Decimal
 *   }>
 * }>}
 */
async function getBenchmarkPriceSeries(symbol = "SPY", {
  period = "1M",
  asOf = new Date(),
  portfolioId = null,
  marketDataProvider = defaultMarketData,
  client = prisma,
} = {}) {
  const benchmark = String(symbol || "SPY").trim().toUpperCase();
  const reference = asOf instanceof Date ? asOf : new Date(asOf);

  let { startDate, endDate, normalizedPeriod } = resolveDateRange({
    period,
    asOf: reference,
  });

  let resolvedStart = startDate;
  if (!resolvedStart) {
    if (portfolioId) {
      const earliestSnapshots = await findSnapshots({ portfolioId }, client);
      if (earliestSnapshots.length > 0) {
        resolvedStart = new Date(earliestSnapshots[0].snapshotDate);
      }
    }
    if (!resolvedStart) {
      // Default to 365 days ago if ALL requested and no portfolio snapshots found
      resolvedStart = new Date(Date.UTC(
        reference.getUTCFullYear() - 1,
        reference.getUTCMonth(),
        reference.getUTCDate(),
        0,
        0,
        0,
        0,
      ));
    }
  }

  // Look back 7 days prior to resolvedStart so we have the previous closing price
  const lookbackStartMs = Math.max(0, resolvedStart.getTime() - 7 * 24 * 60 * 60 * 1000);
  const now = Date.now();
  let toMs = Math.min(endDate.getTime(), now);

  let fromMs = lookbackStartMs;
  if (toMs <= fromMs) {
    fromMs = Math.max(0, toMs - 24 * 60 * 60 * 1000);
  }

  const historical = await marketDataProvider.getHistoricalPrices(benchmark, {
    interval: "1d",
    from: fromMs,
    to: toMs,
    limit: 500,
  });

  const rawCandles = (historical && Array.isArray(historical.prices))
    ? historical.prices
    : [];

  const rawPoints = rawCandles.map((c) => {
    const d = new Date(c.timestamp);
    const dateStr = d.toISOString().slice(0, 10);
    return {
      date: dateStr,
      price: new Prisma.Decimal(c.close),
    };
  });

  const fullSeries = rawPoints.map((point, idx) => {
    let dailyReturn = null;
    if (idx > 0) {
      const prevPrice = rawPoints[idx - 1].price;
      if (prevPrice.gt(ZERO)) {
        dailyReturn = point.price.minus(prevPrice).dividedBy(prevPrice);
      }
    }
    return {
      date: point.date,
      price: point.price,
      dailyReturn,
    };
  });

  const startStr = resolvedStart ? resolvedStart.toISOString().slice(0, 10) : null;
  const endStr = endDate.toISOString().slice(0, 10);

  const series = fullSeries.filter((p) => {
    if (startStr && p.date < startStr) return false;
    if (endStr && p.date > endStr) return false;
    return true;
  });

  return {
    benchmark,
    period: normalizedPeriod,
    startDate: resolvedStart,
    endDate,
    series,
  };
}

/**
 * Public DTO service function for GET /portfolios/:id/benchmark.
 *
 * @param {string} [symbol="SPY"]
 * @param {Object} [options]
 * @returns {Promise<{
 *   benchmark: string,
 *   period: string,
 *   prices: Array<{
 *     date: string,
 *     price: string,
 *     dailyReturn: string
 *   }>
 * }>}
 */
async function getBenchmarkData(symbol = "SPY", options = {}) {
  const result = await getBenchmarkPriceSeries(symbol, options);

  const prices = result.series.map((p) => ({
    date: p.date,
    price: p.price.toString(),
    dailyReturn: p.dailyReturn !== null && p.dailyReturn !== undefined
      ? p.dailyReturn.toFixed(4)
      : null,
  }));

  return {
    benchmark: result.benchmark,
    period: result.period,
    prices,
  };
}

module.exports = {
  getBenchmarkPriceSeries,
  getBenchmarkData,
};

