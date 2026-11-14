const { Prisma } = require("@prisma/client");
const prisma = require("../config/database");
const { getPortfolioReturnSeries } = require("./portfolioSeriesService");
const { getBenchmarkPriceSeries } = require("./benchmarkService");
const {
  DEFAULT_ANNUALIZATION_FACTOR,
  DEFAULT_RISK_FREE_RATE,
} = require("./riskMetricsService");

const ZERO = new Prisma.Decimal(0);

/**
 * Compare portfolio performance against a benchmark symbol over a given period.
 *
 * Rules:
 * - Uses only mutually available dates. Gaps are never fabricated.
 * - Computes covariance, beta, correlation, and alpha across mutual dates.
 * - If mutual observations M < 2 or benchmark variance is zero, returns null for beta/correlation/alpha.
 *
 * @param {string} portfolioId
 * @param {Object} [options]
 * @param {string} [options.symbol="SPY"]
 * @param {string} [options.period="1M"]
 * @param {number} [options.riskFreeRate=0.02]
 * @param {Date} [options.asOf]
 * @param {boolean} [options.ensureToday=true]
 * @param {Object} [options.marketDataProvider]
 * @param {Object} [options.client]
 * @returns {Promise<{
 *   portfolioId: string,
 *   benchmark: string,
 *   period: string,
 *   summary: {
 *     portfolioReturn: string,
 *     benchmarkReturn: string,
 *     alpha: string|null,
 *     beta: string|null,
 *     correlation: string|null
 *   },
 *   comparison: Array<{
 *     date: string,
 *     portfolioValue: string,
 *     portfolioReturn: string,
 *     benchmarkPrice: string,
 *     benchmarkReturn: string
 *   }>
 * }>}
 */
async function getBenchmarkComparison(portfolioId, {
  symbol = "SPY",
  period = "1M",
  riskFreeRate = DEFAULT_RISK_FREE_RATE,
  asOf = new Date(),
  ensureToday = true,
  marketDataProvider = null,
  client = prisma,
} = {}) {
  const benchmarkSymbol = String(symbol || "SPY").trim().toUpperCase();
  const reference = asOf instanceof Date ? asOf : new Date(asOf);

  // 1. Fetch portfolio series
  const portfolioResult = await getPortfolioReturnSeries(portfolioId, {
    period,
    asOf: reference,
    ensureToday,
    client,
  });

  // 2. Fetch benchmark series
  const benchmarkOptions = {
    period,
    asOf: reference,
    portfolioId,
    client,
  };
  if (marketDataProvider) {
    benchmarkOptions.marketDataProvider = marketDataProvider;
  }
  const benchmarkResult = await getBenchmarkPriceSeries(
    benchmarkSymbol,
    benchmarkOptions,
  );

  // 3. Index series by UTC date string YYYY-MM-DD
  const portfolioMap = new Map();
  for (const p of portfolioResult.series) {
    portfolioMap.set(p.date, p);
  }

  const benchmarkMap = new Map();
  for (const b of benchmarkResult.series) {
    benchmarkMap.set(b.date, b);
  }

  // 4. Align on mutually available dates only
  const mutualDates = [];
  for (const date of portfolioMap.keys()) {
    if (benchmarkMap.has(date)) {
      mutualDates.push(date);
    }
  }
  mutualDates.sort();

  const comparison = [];
  const alignedPairs = [];

  for (const date of mutualDates) {
    const pPoint = portfolioMap.get(date);
    const bPoint = benchmarkMap.get(date);

    const pVal = pPoint.totalValue instanceof Prisma.Decimal
      ? pPoint.totalValue
      : new Prisma.Decimal(pPoint.totalValue || 0);

    const bPrice = bPoint.price instanceof Prisma.Decimal
      ? bPoint.price
      : new Prisma.Decimal(bPoint.price || 0);

    let pRet = null;
    if (pPoint.dailyReturn !== null && pPoint.dailyReturn !== undefined) {
      const dec = pPoint.dailyReturn instanceof Prisma.Decimal
        ? pPoint.dailyReturn
        : new Prisma.Decimal(pPoint.dailyReturn);
      if (!dec.isNaN()) {
        pRet = dec;
      }
    }

    let bRet = null;
    if (bPoint.dailyReturn !== null && bPoint.dailyReturn !== undefined) {
      const dec = bPoint.dailyReturn instanceof Prisma.Decimal
        ? bPoint.dailyReturn
        : new Prisma.Decimal(bPoint.dailyReturn);
      if (!dec.isNaN()) {
        bRet = dec;
      }
    }

    comparison.push({
      date,
      portfolioValue: pVal.toFixed(8),
      portfolioReturn: pRet !== null ? pRet.toFixed(4) : null,
      benchmarkPrice: bPrice.toString(),
      benchmarkReturn: bRet !== null ? bRet.toFixed(4) : null,
    });

    if (pRet !== null && bRet !== null) {
      alignedPairs.push({
        date,
        pRet: pRet.toNumber(),
        bRet: bRet.toNumber(),
      });
    }
  }

  // 5. Calculate cumulative returns over the mutual window
  let portfolioReturnStr = "0.0000";
  let benchmarkReturnStr = "0.0000";

  const m = comparison.length;
  if (m >= 2) {
    const firstPVal = new Prisma.Decimal(comparison[0].portfolioValue);
    const lastPVal = new Prisma.Decimal(comparison[m - 1].portfolioValue);
    if (firstPVal.gt(ZERO)) {
      portfolioReturnStr = lastPVal
        .minus(firstPVal)
        .dividedBy(firstPVal)
        .toFixed(4);
    }

    const firstBPrice = new Prisma.Decimal(comparison[0].benchmarkPrice);
    const lastBPrice = new Prisma.Decimal(comparison[m - 1].benchmarkPrice);
    if (firstBPrice.gt(ZERO)) {
      benchmarkReturnStr = lastBPrice
        .minus(firstBPrice)
        .dividedBy(firstBPrice)
        .toFixed(4);
    }
  }

  // 6. Calculate statistical metrics (alpha, beta, correlation) strictly over mutually defined returns
  let alpha = null;
  let beta = null;
  let correlation = null;

  const validCount = alignedPairs.length;
  if (validCount >= 2) {
    const pReturns = alignedPairs.map((pair) => pair.pRet);
    const bReturns = alignedPairs.map((pair) => pair.bRet);

    const meanP = pReturns.reduce((acc, v) => acc + v, 0) / validCount;
    const meanB = bReturns.reduce((acc, v) => acc + v, 0) / validCount;

    let cov = 0;
    let varP = 0;
    let varB = 0;

    for (let i = 0; i < validCount; i++) {
      const diffP = pReturns[i] - meanP;
      const diffB = bReturns[i] - meanB;
      cov += diffP * diffB;
      varP += diffP * diffP;
      varB += diffB * diffB;
    }

    cov /= (validCount - 1);
    varP /= (validCount - 1);
    varB /= (validCount - 1);

    if (varB > 0) {
      const betaVal = cov / varB;
      beta = betaVal.toFixed(2);

      const rf = Number(riskFreeRate);
      const annP = meanP * DEFAULT_ANNUALIZATION_FACTOR;
      const annB = meanB * DEFAULT_ANNUALIZATION_FACTOR;
      const alphaVal = (annP - rf) - betaVal * (annB - rf);
      alpha = alphaVal.toFixed(4);

      if (varP > 0) {
        const stdP = Math.sqrt(varP);
        const stdB = Math.sqrt(varB);
        let corrVal = cov / (stdP * stdB);
        corrVal = Math.max(-1.0, Math.min(1.0, corrVal));
        correlation = corrVal.toFixed(2);
      }
    }
  }

  return {
    portfolioId,
    benchmark: benchmarkSymbol,
    period: portfolioResult.period,
    summary: {
      portfolioReturn: portfolioReturnStr,
      benchmarkReturn: benchmarkReturnStr,
      alpha,
      beta,
      correlation,
    },
    comparison,
  };
}

module.exports = {
  getBenchmarkComparison,
};
