const { getRedis } = require("../config/redis");
const cacheKeys = require("../utils/cacheKeys");
const logger = require("../utils/logger");
const { registry } = require("../observability/metrics");

const { loadCacheConfig } = require("../config/cacheConfig");

const TTL_SECONDS = loadCacheConfig();

function recordCacheSignal({
  resource = "default",
  outcome = "hit",
  assetClass,
  error,
  reason,
} = {}) {
  const normalizedResource = String(resource || "default").trim().toLowerCase();
  const normalizedOutcome = String(outcome || "hit").trim().toLowerCase();

  // 1. Prometheus metric with low-cardinality labels (resource, outcome)
  registry.increment("cache_operations_total", {
    resource: normalizedResource,
    outcome: normalizedOutcome,
  });

  // 2. Structured log with low-cardinality metadata; strictly no user secrets or payloads
  const logMeta = {
    resource: normalizedResource,
    outcome: normalizedOutcome,
  };
  if (assetClass) {
    logMeta.assetClass = String(assetClass).trim().toUpperCase();
  }
  if (reason) {
    logMeta.reason = String(reason);
  }
  if (error) {
    logMeta.errorMessage = error.message || String(error);
  }

  if (normalizedOutcome === "error") {
    if (typeof logger.warn === "function") {
      logger.warn("Cache operation error", logMeta);
    }
  } else if (normalizedOutcome === "bypass") {
    if (typeof logger.debug === "function") {
      logger.debug("Cache operation bypassed", logMeta);
    }
  } else {
    if (typeof logger.debug === "function") {
      logger.debug(`Cache ${normalizedOutcome}`, logMeta);
    }
  }
}

function isBypassRequested(options = {}) {
  return Boolean(
    options &&
      (options.bypass === true ||
        options.bypassCache === true ||
        options.skipCache === true ||
        options.noCache === true),
  );
}

const CACHE_PORTFOLIO_SUMMARY_IF_GENERATION_MATCHES = `
  if redis.call("GET", KEYS[1]) == ARGV[1] then
    redis.call("SET", KEYS[2], ARGV[2], "EX", ARGV[3])
    return 1
  end

  return 0
`;

const CACHE_ANALYTICS_IF_GENERATION_MATCHES = `
  if redis.call("GET", KEYS[1]) == ARGV[1] then
    redis.call("SET", KEYS[2], ARGV[2], "EX", ARGV[3])
    return 1
  end

  return 0
`;

const INVALIDATE_PORTFOLIO_SUMMARY = `
  redis.call("INCR", KEYS[1])
  return redis.call("DEL", KEYS[2])
`;

async function safe(operation, fallback, options = {}) {
  const resource = options.resource || "default";
  const assetClass = options.assetClass;

  try {
    const redis = await getRedis();
    return await operation(redis);
  } catch (error) {
    recordCacheSignal({
      resource,
      outcome: "error",
      assetClass,
      error,
    });
    logger.warn("Redis cache operation failed", {
      resource,
      outcome: "error",
      message: error.message,
    });

    if (resource !== "metrics_error_incr" && resource !== "metrics") {
      try {
        const redis = await getRedis();
        if (redis && typeof redis.incr === "function") {
          await redis.incr(cacheKeys.metric("errors"));
        }
      } catch (_) {
        // Best-effort metric increment; do not disrupt error fallback
      }
    }

    return fallback;
  }
}

async function get(key, options = {}) {
  const resource = options.resource || "default";
  const assetClass = options.assetClass;

  if (isBypassRequested(options)) {
    recordCacheSignal({
      resource,
      outcome: "bypass",
      assetClass,
      reason: options.reason || "bypass_requested",
    });
    safe(
      async (redis) => redis.incr(cacheKeys.metric("bypasses")),
      0,
      { resource, assetClass },
    );
    return null;
  }

  return safe(
    async (redis) => {
      const value = await redis.get(key);

      if (value === null) {
        await redis.incr(cacheKeys.metric("misses"));
        recordCacheSignal({ resource, outcome: "miss", assetClass });
        return null;
      }

      await redis.incr(cacheKeys.metric("hits"));
      recordCacheSignal({ resource, outcome: "hit", assetClass });

      return JSON.parse(value);
    },
    null,
    { resource, assetClass },
  );
}

async function set(key, value, ttlSeconds, options = {}) {
  const resource = options.resource || "default";
  const assetClass = options.assetClass;

  return safe(
    async (redis) => {
      await redis.set(key, JSON.stringify(value), "EX", ttlSeconds);

      return true;
    },
    false,
    { resource, assetClass },
  );
}

async function getPortfolioSummaryGeneration(portfolioId) {
  const generationKey = cacheKeys.portfolioSummaryGeneration(portfolioId);

  return safe(async (redis) => {
    let generation = await redis.get(generationKey);

    if (generation !== null) {
      return generation;
    }

    // Initialize the generation without overwriting a concurrent invalidation.
    await redis.set(generationKey, "0", "NX");

    generation = await redis.get(generationKey);

    return generation ?? "0";
  }, null);
}

async function writePortfolioSummaryIfGenerationMatches(
  portfolioId,
  value,
  generation,
) {
  return safe(async (redis) => {
    const result = await redis.eval(
      CACHE_PORTFOLIO_SUMMARY_IF_GENERATION_MATCHES,
      2,
      cacheKeys.portfolioSummaryGeneration(portfolioId),
      cacheKeys.portfolioSummary(portfolioId),
      generation,
      JSON.stringify(value),
      TTL_SECONDS.portfolioSummary,
    );

    return result === 1;
  }, false);
}

async function del(...keys) {
  return safe(async (redis) => {
    if (keys.length === 0) return 0;
    return redis.del(...keys);
  }, 0);
}

async function getOrSet(key, loader, ttlSeconds, options = {}) {
  const resource = options.resource || "default";
  const assetClass = options.assetClass;

  if (isBypassRequested(options)) {
    recordCacheSignal({
      resource,
      outcome: "bypass",
      assetClass,
      reason: options.reason || "bypass_requested",
    });
    safe(
      async (redis) => redis.incr(cacheKeys.metric("bypasses")),
      0,
      { resource, assetClass },
    );

    return loader();
  }

  const cached = await get(key, { resource, assetClass });

  if (cached !== null) {
    return cached;
  }

  const freshValue = await loader();

  if (freshValue !== null && freshValue !== undefined) {
    await set(key, freshValue, ttlSeconds, { resource, assetClass });
  }

  return freshValue;
}

async function getPrice(assetClass, symbol, options = {}) {
  return get(cacheKeys.price(assetClass, symbol), {
    resource: "price",
    assetClass,
    ...options,
  });
}

async function setPrice(assetClass, symbol, value) {
  return set(cacheKeys.price(assetClass, symbol), value, TTL_SECONDS.price, {
    resource: "price",
    assetClass,
  });
}

async function getOrSetPrice(assetClass, symbol, loader, options = {}) {
  return getOrSet(
    cacheKeys.price(assetClass, symbol),
    loader,
    TTL_SECONDS.price,
    { resource: "price", assetClass, ...options },
  );
}

async function getPortfolioSummary(portfolioId) {
  return get(cacheKeys.portfolioSummary(portfolioId));
}

async function setPortfolioSummary(portfolioId, value) {
  const generation = await getPortfolioSummaryGeneration(portfolioId);

  if (generation === null) {
    return false;
  }

  return writePortfolioSummaryIfGenerationMatches(
    portfolioId,
    value,
    generation,
  );
}

async function invalidatePortfolio(portfolioId) {
  return safe(
    async (redis) =>
      redis.eval(
        INVALIDATE_PORTFOLIO_SUMMARY,
        2,
        cacheKeys.portfolioSummaryGeneration(portfolioId),
        cacheKeys.portfolioSummary(portfolioId),
      ),
    0,
  );
}
async function getHistoricalPrices(
  assetClass,
  symbol,
  interval,
  from,
  to,
  limit,
  options = {},
) {
  return get(
    cacheKeys.historicalPrices(assetClass, symbol, interval, from, to, limit),
    { resource: "historical_prices", assetClass, ...options },
  );
}

async function setHistoricalPrices(
  assetClass,
  symbol,
  interval,
  from,
  to,
  limit,
  value,
) {
  return set(
    cacheKeys.historicalPrices(assetClass, symbol, interval, from, to, limit),
    value,
    TTL_SECONDS.historicalPrices,
    { resource: "historical_prices", assetClass },
  );
}

async function getMarketSearch(query, options = {}) {
  return get(cacheKeys.marketSearch(query, options), {
    resource: "market_search",
    ...options,
  });
}

async function setMarketSearch(query, options = {}, value) {
  return set(
    cacheKeys.marketSearch(query, options),
    value,
    TTL_SECONDS.symbolSearch,
    { resource: "market_search", ...options },
  );
}

async function getOrSetMarketSearch(query, options = {}, loader) {
  return getOrSet(
    cacheKeys.marketSearch(query, options),
    loader,
    TTL_SECONDS.symbolSearch,
    { resource: "market_search", ...options },
  );
}

async function invalidateMarketSearch(query, options = {}) {
  return del(cacheKeys.marketSearch(query, options));
}

const getSymbolSearch = getMarketSearch;
const setSymbolSearch = setMarketSearch;
const getOrSetSymbolSearch = getOrSetMarketSearch;
const invalidateSymbolSearch = invalidateMarketSearch;

async function getMetrics(options = {}) {
  return safe(
    async (redis) => {
      const hits = Number((await redis.get(cacheKeys.metric("hits"))) || 0);
      const misses = Number((await redis.get(cacheKeys.metric("misses"))) || 0);
      const total = hits + misses;
      const hitRate = total === 0 ? 0 : Number((hits / total).toFixed(4));

      const metrics = {
        hits,
        misses,
        total,
        hitRate,
      };

      if (options.detailed) {
        metrics.bypasses = Number((await redis.get(cacheKeys.metric("bypasses"))) || 0);
        metrics.errors = Number((await redis.get(cacheKeys.metric("errors"))) || 0);
      }

      return metrics;
    },
    {
      hits: 0,
      misses: 0,
      total: 0,
      hitRate: 0,
      ...(options.detailed ? { bypasses: 0, errors: 0 } : {}),
    },
    { resource: "metrics" },
  );
}

async function getSignals() {
  return getMetrics({ detailed: true });
}

async function getOrSetPortfolioSummary(portfolioId, loader, options = {}) {
  const resource = options.resource || "portfolio_summary";
  if (isBypassRequested(options)) {
    recordCacheSignal({
      resource,
      outcome: "bypass",
      reason: options.reason || "bypass_requested",
    });
    safe(
      async (redis) => redis.incr(cacheKeys.metric("bypasses")),
      0,
      { resource },
    );
    return loader();
  }

  const key = cacheKeys.portfolioSummary(portfolioId);

  const cached = await get(key, { resource, ...options });

  if (cached !== null) {
    return cached;
  }

  // Capture the generation BEFORE starting the database loader.
  const generation = await getPortfolioSummaryGeneration(portfolioId);

  const freshValue = await loader();

  if (freshValue !== null && freshValue !== undefined && generation !== null) {
    await writePortfolioSummaryIfGenerationMatches(
      portfolioId,
      freshValue,
      generation,
    );
  }

  return freshValue;
}

async function getPortfolioAnalyticsGeneration(portfolioId) {
  const generationKey = cacheKeys.portfolioAnalyticsGeneration(portfolioId);

  return safe(async (redis) => {
    let generation = await redis.get(generationKey);

    if (generation !== null) {
      return generation;
    }

    await redis.set(generationKey, "0", "NX");

    generation = await redis.get(generationKey);

    return generation ?? "0";
  }, null);
}

async function getUserAnalyticsGeneration(userId) {
  const generationKey = cacheKeys.userAnalyticsGeneration(userId);

  return safe(async (redis) => {
    let generation = await redis.get(generationKey);

    if (generation !== null) {
      return generation;
    }

    await redis.set(generationKey, "0", "NX");

    generation = await redis.get(generationKey);

    return generation ?? "0";
  }, null);
}

async function invalidatePortfolioAnalytics(portfolioId) {
  return safe(
    async (redis) => redis.incr(cacheKeys.portfolioAnalyticsGeneration(portfolioId)),
    0,
  );
}

async function invalidateUserAnalytics(userId) {
  return safe(
    async (redis) => redis.incr(cacheKeys.userAnalyticsGeneration(userId)),
    0,
  );
}

async function invalidateAnalytics({ portfolioId = null, userId = null } = {}) {
  const tasks = [];
  if (portfolioId) {
    tasks.push(invalidatePortfolioAnalytics(portfolioId));
  }
  if (userId) {
    tasks.push(invalidateUserAnalytics(userId));
  }
  return Promise.all(tasks);
}

async function writeAnalyticsIfGenerationMatches(
  generationKey,
  cacheKey,
  value,
  generation,
  ttlSeconds,
) {
  return safe(async (redis) => {
    const result = await redis.eval(
      CACHE_ANALYTICS_IF_GENERATION_MATCHES,
      2,
      generationKey,
      cacheKey,
      generation,
      JSON.stringify(value),
      ttlSeconds,
    );

    return result === 1;
  }, false);
}

async function getOrSetPortfolioAnalytics(portfolioId, userId, keyBuilder, loader, ttlSeconds, options = {}) {
  const resource = options.resource || "portfolio_analytics";
  if (isBypassRequested(options)) {
    recordCacheSignal({
      resource,
      outcome: "bypass",
      reason: options.reason || "bypass_requested",
    });
    safe(
      async (redis) => redis.incr(cacheKeys.metric("bypasses")),
      0,
      { resource },
    );
    return loader();
  }

  const generation = await getPortfolioAnalyticsGeneration(portfolioId);
  const key = keyBuilder(generation);

  const cached = await get(key, { resource, ...options });
  if (cached !== null) {
    return cached;
  }

  const freshValue = await loader();

  if (freshValue !== null && freshValue !== undefined && generation !== null) {
    await writeAnalyticsIfGenerationMatches(
      cacheKeys.portfolioAnalyticsGeneration(portfolioId),
      key,
      freshValue,
      generation,
      ttlSeconds,
    );
  }

  return freshValue;
}

async function getOrSetUserAnalytics(userId, keyBuilder, loader, ttlSeconds, options = {}) {
  const resource = options.resource || "user_analytics";
  if (isBypassRequested(options)) {
    recordCacheSignal({
      resource,
      outcome: "bypass",
      reason: options.reason || "bypass_requested",
    });
    safe(
      async (redis) => redis.incr(cacheKeys.metric("bypasses")),
      0,
      { resource },
    );
    return loader();
  }

  const generation = await getUserAnalyticsGeneration(userId);
  const key = keyBuilder(generation);

  const cached = await get(key, { resource, ...options });
  if (cached !== null) {
    return cached;
  }

  const freshValue = await loader();

  if (freshValue !== null && freshValue !== undefined && generation !== null) {
    await writeAnalyticsIfGenerationMatches(
      cacheKeys.userAnalyticsGeneration(userId),
      key,
      freshValue,
      generation,
      ttlSeconds,
    );
  }

  return freshValue;
}

async function getOrSetPortfolioHeatmap(portfolioId, userId, options, loader) {
  return getOrSetPortfolioAnalytics(
    portfolioId,
    userId,
    (generation) =>
      cacheKeys.analyticsPortfolioHeatmap(portfolioId, userId, {
        ...options,
        generation,
      }),
    loader,
    TTL_SECONDS.analyticsHeatmap,
  );
}

async function getOrSetPortfolioRiskMetrics(portfolioId, userId, options, loader) {
  return getOrSetPortfolioAnalytics(
    portfolioId,
    userId,
    (generation) =>
      cacheKeys.analyticsPortfolioRiskMetrics(portfolioId, userId, {
        ...options,
        generation,
      }),
    loader,
    TTL_SECONDS.analyticsRiskMetrics,
  );
}

async function getOrSetPortfolioBenchmark(portfolioId, userId, symbol, options, loader) {
  return getOrSetPortfolioAnalytics(
    portfolioId,
    userId,
    (generation) =>
      cacheKeys.analyticsPortfolioBenchmark(portfolioId, userId, symbol, {
        ...options,
        generation,
      }),
    loader,
    TTL_SECONDS.analyticsBenchmark,
  );
}

async function getOrSetPortfolioBenchmarkComparison(portfolioId, userId, symbol, options, loader) {
  return getOrSetPortfolioAnalytics(
    portfolioId,
    userId,
    (generation) =>
      cacheKeys.analyticsPortfolioBenchmarkComparison(portfolioId, userId, symbol, {
        ...options,
        generation,
      }),
    loader,
    TTL_SECONDS.analyticsBenchmarkComparison,
  );
}

async function getOrSetPortfolioMonthlyPerformance(portfolioId, userId, options, loader) {
  return getOrSetPortfolioAnalytics(
    portfolioId,
    userId,
    (generation) =>
      cacheKeys.analyticsPortfolioMonthlyPerformance(portfolioId, userId, {
        ...options,
        generation,
      }),
    loader,
    TTL_SECONDS.analyticsMonthlyPerformance,
  );
}

async function getOrSetUserStatistics(userId, filters, loader) {
  return getOrSetUserAnalytics(
    userId,
    (generation) =>
      cacheKeys.analyticsUserStatistics(userId, {
        ...filters,
        generation,
      }),
    loader,
    TTL_SECONDS.userStatistics,
  );
}

async function getOrSetUserMonthlyStatistics(userId, filters, loader) {
  return getOrSetUserAnalytics(
    userId,
    (generation) =>
      cacheKeys.analyticsUserMonthlyStatistics(userId, {
        ...filters,
        generation,
      }),
    loader,
    TTL_SECONDS.userStatistics,
  );
}

module.exports = {
  TTL_SECONDS,
  get,
  set,
  del,
  getOrSet,
  getPrice,
  setPrice,
  getPortfolioSummary,
  setPortfolioSummary,
  invalidatePortfolio,
  getHistoricalPrices,
  setHistoricalPrices,
  getMarketSearch,
  setMarketSearch,
  getOrSetMarketSearch,
  invalidateMarketSearch,
  getSymbolSearch,
  setSymbolSearch,
  getOrSetSymbolSearch,
  invalidateSymbolSearch,
  getMetrics,
  getOrSetPrice,
  getOrSetPortfolioSummary,
  getPortfolioAnalyticsGeneration,
  getUserAnalyticsGeneration,
  invalidatePortfolioAnalytics,
  invalidateUserAnalytics,
  invalidateAnalytics,
  writeAnalyticsIfGenerationMatches,
  getOrSetPortfolioAnalytics,
  getOrSetUserAnalytics,
  getOrSetPortfolioHeatmap,
  getOrSetPortfolioRiskMetrics,
  getOrSetPortfolioBenchmark,
  getOrSetPortfolioBenchmarkComparison,
  getOrSetPortfolioMonthlyPerformance,
  getOrSetUserStatistics,
  getOrSetUserMonthlyStatistics,
  recordCacheSignal,
  getSignals,
};
