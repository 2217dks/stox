const { createMarketDataError } = require("../providers/marketDataErrors");
const {
  DEFAULT_FRESHNESS_THRESHOLDS,
  DEFAULT_MAX_CLOCK_SKEW_SECONDS,
} = require("../config/marketDataConfig");

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

  if (diffMs < -maxClockSkewMs) {
    // Ahead by more than acceptable clock skew -> invalid / future timestamp
    isFuture = true;
    isStale = true;
    freshness = "FUTURE";
    ageSeconds = null;
  } else if (diffMs < 0) {
    // Ahead within acceptable clock skew tolerance (e.g. up to 5s ahead)
    isFuture = false;
    isStale = false;
    freshness = "FRESH";
    ageSeconds = 0;
  } else {
    // Normal past/current timestamp
    isFuture = false;
    const ageMs = diffMs;
    ageSeconds = Math.floor(ageMs / 1000);
    isStale = ageSeconds > thresholdSeconds;
    freshness = isStale ? "STALE" : "FRESH";
  }

  return {
    ...quote,
    isStale,
    isFuture,
    freshness,
    ageSeconds,
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
    const maxAge = Number(options.maxAgeSeconds);
    if (evaluated.ageSeconds === null || evaluated.ageSeconds > maxAge) {
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
