const { createMarketDataError } = require("../providers/marketDataErrors");
const marketDataConfig = require("../config/marketDataConfig");

const FALLBACK_FRESHNESS_THRESHOLDS = Object.freeze({
  CRYPTO: 60,
  STOCK: 300,
  DEFAULT: 120,
});
const FALLBACK_MAX_CLOCK_SKEW_SECONDS = 5;

const DEFAULT_FRESHNESS_THRESHOLDS =
  marketDataConfig.DEFAULT_FRESHNESS_THRESHOLDS || FALLBACK_FRESHNESS_THRESHOLDS;
const DEFAULT_MAX_CLOCK_SKEW_SECONDS =
  marketDataConfig.DEFAULT_MAX_CLOCK_SKEW_SECONDS || FALLBACK_MAX_CLOCK_SKEW_SECONDS;

/**
 * Evaluate the freshness of a normalized market quote based on its provider timestamp
 * and configured freshness thresholds.
 *
 * @param {Object} quote - The normalized quote object.
 * @param {Object} [options]
 * @param {number} [options.thresholdSeconds] - Explicit staleness threshold in seconds.
 * @param {number} [options.maxClockSkewSeconds] - Permissible clock skew in seconds (default 5s).
 * @param {Date|string|number} [options.asOf] - Reference timestamp (defaults to current time).
 * @param {Function} [options.now] - Clock function returning milliseconds epoch.
 * @param {Object} [options.config] - Market data config with freshnessThresholds.
 * @returns {Object} The quote decorated with `isStale`, `freshness`, `ageSeconds`, and `isFuture`.
 */
function evaluateQuoteFreshness(quote, options = {}) {
  if (!quote || typeof quote !== "object" || Array.isArray(quote)) {
    return {
      isStale: true,
      isFuture: false,
      freshness: "STALE",
      ageSeconds: null,
      ageMs: null,
    };
  }

  const quoteTimestamp = quote.timestamp;
  if (!quoteTimestamp) {
    return {
      ...quote,
      isStale: true,
      isFuture: false,
      freshness: "STALE",
      ageSeconds: null,
      ageMs: null,
    };
  }

  const quoteTimeMs = new Date(quoteTimestamp).getTime();
  if (Number.isNaN(quoteTimeMs)) {
    return {
      ...quote,
      isStale: true,
      isFuture: false,
      freshness: "STALE",
      ageSeconds: null,
      ageMs: null,
    };
  }

  const asOfMs = options.asOf
    ? new Date(options.asOf).getTime()
    : options.now
      ? options.now()
      : Date.now();

  const maxClockSkewMs =
    options.maxClockSkewMs !== undefined && options.maxClockSkewMs !== null
      ? Number(options.maxClockSkewMs)
      : options.maxClockSkewSeconds !== undefined &&
          options.maxClockSkewSeconds !== null
        ? Number(options.maxClockSkewSeconds) * 1000
        : (options.config?.maxClockSkewSeconds ??
            DEFAULT_MAX_CLOCK_SKEW_SECONDS) * 1000;

  const diffMs = asOfMs - quoteTimeMs;
  const assetClass = quote.assetClass || "DEFAULT";
  const thresholdSeconds =
    options.thresholdSeconds !== undefined && options.thresholdSeconds !== null
      ? Number(options.thresholdSeconds)
      : (options.config?.freshnessThresholds?.[assetClass] ??
        options.config?.freshnessThresholds?.DEFAULT ??
        DEFAULT_FRESHNESS_THRESHOLDS[assetClass] ??
        DEFAULT_FRESHNESS_THRESHOLDS.DEFAULT);

  let isStale = false;
  let isFuture = false;
  let freshness = "FRESH";
  let ageSeconds = null;
  let ageMs = null;

  if (diffMs < -maxClockSkewMs) {
    // Ahead by more than acceptable clock skew -> invalid / future timestamp
    isFuture = true;
    isStale = true;
    freshness = "FUTURE";
    ageSeconds = null;
    ageMs = null;
  } else if (diffMs < 0) {
    // Ahead within acceptable clock skew tolerance (e.g. up to 5s ahead)
    isFuture = false;
    isStale = false;
    freshness = "FRESH";
    ageSeconds = 0;
    ageMs = 0;
  } else {
    // Normal past/current timestamp
    isFuture = false;
    ageMs = diffMs;
    ageSeconds = Math.floor(ageMs / 1000);
    isStale = ageMs > thresholdSeconds * 1000;
    freshness = isStale ? "STALE" : "FRESH";
  }

  return {
    ...quote,
    isStale,
    isFuture,
    freshness,
    ageSeconds,
    ageMs,
  };
}

/**
 * Evaluate quote freshness and optionally reject stale or future quotes when requested.
 *
 * @throws {AppError} 503 MARKET_DATA_STALE_QUOTE if stale, future, or invalid age when rejection requested.
 */
function assertQuoteFreshness(quote, options = {}) {
  const evaluated = evaluateQuoteFreshness(quote, options);

  const rejectStale = Boolean(options.rejectStale || options.requireFresh);
  if (rejectStale && evaluated.isStale) {
    throw createMarketDataError(
      "Market data quote is stale or delayed.",
      503,
      "MARKET_DATA_STALE_QUOTE",
    );
  }

  if (
    options.maxAgeSeconds !== undefined &&
    options.maxAgeSeconds !== null
  ) {
    const maxAgeMs = Number(options.maxAgeSeconds) * 1000;
    if (
      evaluated.ageSeconds === null ||
      evaluated.ageMs === null ||
      evaluated.ageMs === undefined ||
      evaluated.ageMs > maxAgeMs
    ) {
      throw createMarketDataError(
        "Market data quote is stale or delayed.",
        503,
        "MARKET_DATA_STALE_QUOTE",
      );
    }
  }

  return evaluated;
}

module.exports = {
  evaluateQuoteFreshness,
  assertQuoteFreshness,
};
