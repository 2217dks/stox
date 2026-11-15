const { getRedis } = require("../config/redis");
const cacheKeys = require("../utils/cacheKeys");
const logger = require("../utils/logger");

const { loadCacheConfig } = require("../config/cacheConfig");

const TTL_SECONDS = loadCacheConfig();

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

async function safe(operation, fallback) {
  try {
    const redis = await getRedis();
    return await operation(redis);
  } catch (error) {
    logger.warn("Redis cache operation failed", {
      message: error.message,
    });

    return fallback;
  }
}

async function get(key) {
  return safe(async (redis) => {
    const value = await redis.get(key);

    if (value === null) {
      await redis.incr(cacheKeys.metric("misses"));
      return null;
    }

    await redis.incr(cacheKeys.metric("hits"));

    return JSON.parse(value);
  }, null);
}

async function set(key, value, ttlSeconds) {
  return safe(async (redis) => {
    await redis.set(key, JSON.stringify(value), "EX", ttlSeconds);

    return true;
  }, false);
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

async function getOrSet(key, loader, ttlSeconds) {
  const cached = await get(key);

  if (cached !== null) {
    return cached;
  }

  const freshValue = await loader();

  if (freshValue !== null && freshValue !== undefined) {
    await set(key, freshValue, ttlSeconds);
  }

  return freshValue;
}

async function getPrice(assetClass, symbol) {
  return get(cacheKeys.price(assetClass, symbol));
}

async function setPrice(assetClass, symbol, value) {
  return set(cacheKeys.price(assetClass, symbol), value, TTL_SECONDS.price);
}

async function getOrSetPrice(assetClass, symbol, loader) {
  return getOrSet(
    cacheKeys.price(assetClass, symbol),
    loader,
    TTL_SECONDS.price,
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
) {
  return get(
    cacheKeys.historicalPrices(assetClass, symbol, interval, from, to, limit),
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
  );
}

async function getMetrics() {
  return safe(
    async (redis) => {
      const hits = Number((await redis.get(cacheKeys.metric("hits"))) || 0);
      const misses = Number((await redis.get(cacheKeys.metric("misses"))) || 0);
      const total = hits + misses;

      return {
        hits,
        misses,
        total,
        hitRate: total === 0 ? 0 : Number((hits / total).toFixed(4)),
      };
    },
    {
      hits: 0,
      misses: 0,
      total: 0,
      hitRate: 0,
    },
  );
}

async function getOrSetPortfolioSummary(portfolioId, loader) {
  const key = cacheKeys.portfolioSummary(portfolioId);

  const cached = await get(key);

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

async function getOrSetPortfolioAnalytics(portfolioId, userId, keyBuilder, loader, ttlSeconds) {
  const generation = await getPortfolioAnalyticsGeneration(portfolioId);
  const key = keyBuilder(generation);

  const cached = await get(key);
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

async function getOrSetUserAnalytics(userId, keyBuilder, loader, ttlSeconds) {
  const generation = await getUserAnalyticsGeneration(userId);
  const key = keyBuilder(generation);

  const cached = await get(key);
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
};
