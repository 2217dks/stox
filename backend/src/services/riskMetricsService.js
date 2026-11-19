const { Prisma } = require("@prisma/client");
const prisma = require("../config/database");
const { getPortfolioReturnSeries } = require("./portfolioSeriesService");

const DEFAULT_ANNUALIZATION_FACTOR = 252;

// Portfolio snapshots exist for every UTC calendar day (weekends carry the
// previous close), so that series holds 365 observations per year. Using 252
// on it understated volatility by ~15% and the annualized mean by 252/365.
const CALENDAR_DAY_ANNUALIZATION_FACTOR = 365;
const DEFAULT_RISK_FREE_RATE = 0.02;

/**
 * Extract clean finite numbers from an array of mixed numeric types (number, string, Prisma.Decimal).
 *
 * @param {Array<number|string|Object>} values
 * @returns {number[]}
 */
function extractNumbers(values) {
  if (!Array.isArray(values)) return [];
  const numbers = [];
  for (const v of values) {
    if (v === null || v === undefined) continue;
    let n;
    if (typeof v === "object" && typeof v.toNumber === "function") {
      n = v.toNumber();
    } else {
      n = Number(v);
    }
    if (Number.isFinite(n)) {
      numbers.push(n);
    }
  }
  return numbers;
}

/**
 * Calculate the sample mean of an array of numbers.
 *
 * @param {number[]} numbers
 * @returns {number|null}
 */
function calculateMean(numbers) {
  if (!numbers || numbers.length === 0) return null;
  const sum = numbers.reduce((acc, val) => acc + val, 0);
  return sum / numbers.length;
}

/**
 * Calculate the sample standard deviation (N - 1 denominator).
 * Returns null if N < 2.
 * Returns 0 if all values are identical.
 *
 * @param {Array<number|string|Object>} values
 * @returns {number|null}
 */
function calculateSampleStdDev(values) {
  const numbers = extractNumbers(values);
  const n = numbers.length;
  if (n < 2) return null;

  const mean = calculateMean(numbers);
  const sumSquaredDiff = numbers.reduce((acc, val) => {
    const diff = val - mean;
    return acc + diff * diff;
  }, 0);

  const variance = sumSquaredDiff / (n - 1);
  if (variance <= 0 || Object.is(variance, -0)) {
    return 0;
  }
  return Math.sqrt(variance);
}

/**
 * Calculate annualized volatility from a series of daily simple returns.
 * Formula: sigma_ann = sigma_daily * sqrt(annualizationFactor)
 *
 * Invariants:
 * - Requires N >= 2 observations. For N < 2, returns null.
 * - For zero-variance series, returns "0.0000".
 * - Bounded and non-negative.
 *
 * @param {Array<number|string|Object>} returns - Array of daily returns
 * @param {Object} [options]
 * @param {number} [options.annualizationFactor=365]
 * @param {number} [options.precision=4]
 * @returns {string|null}
 */
function calculateVolatility(
  returns,
  {
    annualizationFactor = DEFAULT_ANNUALIZATION_FACTOR,
    precision = 4,
  } = {},
) {
  const numbers = extractNumbers(returns);
  if (numbers.length < 2) {
    return null;
  }

  const dailyStdDev = calculateSampleStdDev(numbers);
  if (dailyStdDev === null) {
    return null;
  }
  if (dailyStdDev === 0) {
    return (0).toFixed(precision);
  }

  const annualized = dailyStdDev * Math.sqrt(annualizationFactor);
  return annualized.toFixed(precision);
}

/**
 * Calculate portfolio drawdown statistics across a chronological series.
 *
 * Running Peak: P_t = max_{0 <= s <= t} V_s
 * Drawdown: DD_t = (V_t - P_t) / P_t
 * Max Drawdown: MDD = min_{0 <= t <= T} DD_t
 * Current Drawdown: DD_T
 *
 * @param {Array<{ date: string|Date, totalValue?: number|string|Decimal, value?: number|string|Decimal }>} series
 * @param {Object} [options]
 * @param {number} [options.precision=4]
 * @param {number} [options.valuePrecision=8]
 * @returns {{
 *   maxDrawdown: string|null,
 *   currentDrawdown: string|null,
 *   peakValue: string|null,
 *   peakDate: string|null
 * }}
 */
function calculateDrawdown(
  series,
  {
    precision = 4,
    valuePrecision = 8,
  } = {},
) {
  if (!Array.isArray(series) || series.length === 0) {
    return {
      maxDrawdown: null,
      currentDrawdown: null,
      peakValue: null,
      peakDate: null,
    };
  }

  let runningPeak = null;
  let peakDate = null;
  let maxDrawdown = 0;
  let currentDrawdown = 0;

  for (let i = 0; i < series.length; i++) {
    const point = series[i];
    const rawVal = point.totalValue !== undefined ? point.totalValue : point.value;
    if (rawVal === null || rawVal === undefined) continue;

    const val = new Prisma.Decimal(rawVal);
    const date = point.date instanceof Date
      ? point.date.toISOString().slice(0, 10)
      : String(point.date).slice(0, 10);

    if (runningPeak === null || val.gt(runningPeak)) {
      runningPeak = val;
      peakDate = date;
    }

    if (runningPeak.gt(0)) {
      const dd = val.minus(runningPeak).dividedBy(runningPeak).toNumber();
      if (dd < maxDrawdown) {
        maxDrawdown = dd;
      }
      if (i === series.length - 1) {
        currentDrawdown = dd;
      }
    }
  }

  if (runningPeak === null) {
    return {
      maxDrawdown: null,
      currentDrawdown: null,
      peakValue: null,
      peakDate: null,
    };
  }

  const formatDd = (n) => {
    if (n === 0 || Object.is(n, -0) || Math.abs(n) < 1e-12) {
      return (0).toFixed(precision);
    }
    return n.toFixed(precision);
  };

  return {
    maxDrawdown: formatDd(maxDrawdown),
    currentDrawdown: formatDd(currentDrawdown),
    peakValue: runningPeak.toFixed(valuePrecision),
    peakDate,
  };
}

/**
 * Calculate Sharpe-like risk-adjusted performance metric.
 *
 * Formula: Sharpe = (R_ann - Rf) / sigma_ann
 * Where R_ann = mean(R_daily) * F
 *       sigma_ann = sample_stddev(R_daily) * sqrt(F)
 *
 * Invariants:
 * - If N < 2 or sigma_ann = 0, returns null.
 *
 * @param {Array<number|string|Object>} returns
 * @param {Object} [options]
 * @param {number} [options.riskFreeRate=0.02]
 * @param {number} [options.annualizationFactor=365]
 * @param {number} [options.precision=2]
 * @returns {string|null}
 */
function calculateSharpeRatio(
  returns,
  {
    riskFreeRate = DEFAULT_RISK_FREE_RATE,
    annualizationFactor = DEFAULT_ANNUALIZATION_FACTOR,
    precision = 2,
  } = {},
) {
  const numbers = extractNumbers(returns);
  if (numbers.length < 2) return null;

  const dailyStdDev = calculateSampleStdDev(numbers);
  if (dailyStdDev === null || dailyStdDev <= 0) return null;

  const sigmaAnn = dailyStdDev * Math.sqrt(annualizationFactor);
  if (sigmaAnn <= 0) return null;

  const meanDaily = calculateMean(numbers);
  const rAnn = meanDaily * annualizationFactor;
  const rf = Number(riskFreeRate);

  const sharpe = (rAnn - rf) / sigmaAnn;
  return sharpe.toFixed(precision);
}

/**
 * Aggregate complete portfolio risk metrics bundle from a chronological series.
 *
 * @param {Array<{ date: string, totalValue?: Object|string|number, value?: Object|string|number, dailyReturn?: Object|string|number }>} series
 * @param {Object} [options]
 * @param {number} [options.riskFreeRate=0.02]
 * @param {number} [options.annualizationFactor=365]
 * @returns {{
 *   annualizedVolatility: string|null,
 *   maxDrawdown: string|null,
 *   currentDrawdown: string|null,
 *   peakValue: string|null,
 *   peakDate: string|null,
 *   sharpeRatio: string|null,
 *   observationCount: number
 * }}
 */
function calculatePortfolioRiskMetrics(
  series,
  {
    riskFreeRate = DEFAULT_RISK_FREE_RATE,
    annualizationFactor = DEFAULT_ANNUALIZATION_FACTOR,
  } = {},
) {
  if (!Array.isArray(series) || series.length === 0) {
    return {
      annualizedVolatility: null,
      maxDrawdown: null,
      currentDrawdown: null,
      peakValue: null,
      peakDate: null,
      sharpeRatio: null,
      observationCount: 0,
    };
  }

  const observationCount = series.length;
  const returns = [];
  for (let i = 0; i < series.length; i++) {
    if (series[i].dailyReturn !== undefined && series[i].dailyReturn !== null) {
      returns.push(series[i].dailyReturn);
    } else if (i > 0) {
      const prev = Number(series[i - 1].totalValue !== undefined ? series[i - 1].totalValue : series[i - 1].value);
      const curr = Number(series[i].totalValue !== undefined ? series[i].totalValue : series[i].value);
      if (prev > 0) {
        returns.push((curr - prev) / prev);
      }
    }
  }

  const drawdown = calculateDrawdown(series);
  const annualizedVolatility = calculateVolatility(returns, { annualizationFactor });
  const sharpeRatio = calculateSharpeRatio(returns, { riskFreeRate, annualizationFactor });

  return {
    annualizedVolatility,
    maxDrawdown: drawdown.maxDrawdown,
    currentDrawdown: drawdown.currentDrawdown,
    peakValue: drawdown.peakValue,
    peakDate: drawdown.peakDate,
    sharpeRatio,
    observationCount,
  };
}

/**
 * High-level orchestration to fetch portfolio history and compute risk metrics bundle.
 *
 * @param {string} portfolioId
 * @param {Object} [options]
 * @param {string} [options.period="1M"]
 * @param {number} [options.riskFreeRate=0.02]
 * @param {Date} [options.asOf]
 * @param {boolean} [options.ensureToday=true]
 * @param {Object} [options.client]
 * @returns {Promise<{
 *   portfolioId: string,
 *   period: string,
 *   metrics: {
 *     annualizedVolatility: string|null,
 *     maxDrawdown: string|null,
 *     currentDrawdown: string|null,
 *     peakValue: string|null,
 *     peakDate: string|null,
 *     sharpeRatio: string|null,
 *     observationCount: number
 *   }
 * }>}
 */
async function getPortfolioRiskMetrics(
  portfolioId,
  {
    period = "1M",
    riskFreeRate = DEFAULT_RISK_FREE_RATE,
    asOf = new Date(),
    client = prisma,
  } = {},
) {
  const seriesResult = await getPortfolioReturnSeries(portfolioId, {
    period,
    asOf,
    client,
  });

  const metrics = calculatePortfolioRiskMetrics(seriesResult.series, {
    riskFreeRate,
    annualizationFactor: CALENDAR_DAY_ANNUALIZATION_FACTOR,
  });

  return {
    portfolioId,
    period: seriesResult.period,
    metrics,
  };
}

module.exports = {
  DEFAULT_ANNUALIZATION_FACTOR,
  CALENDAR_DAY_ANNUALIZATION_FACTOR,
  DEFAULT_RISK_FREE_RATE,
  extractNumbers,
  calculateMean,
  calculateSampleStdDev,
  calculateVolatility,
  calculateDrawdown,
  calculateSharpeRatio,
  calculatePortfolioRiskMetrics,
  getPortfolioRiskMetrics,
};
