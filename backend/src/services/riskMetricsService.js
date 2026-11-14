const DEFAULT_ANNUALIZATION_FACTOR = 252;

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
 * @param {number} [options.annualizationFactor=252]
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

module.exports = {
  DEFAULT_ANNUALIZATION_FACTOR,
  extractNumbers,
  calculateMean,
  calculateSampleStdDev,
  calculateVolatility,
};
