const { getRedis } = require("../config/redis");
const cacheKeys = require("../utils/cacheKeys");
const logger = require("../utils/logger");

const TTL_SECONDS = {
  price: 5,
  portfolioSummary: 30,
  leaderboard: 60,
  historicalPrices: 60 * 60,
  symbol: 24 * 60 * 60,
  session: 7 * 24 * 60 * 60,
};

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
  return set(
    cacheKeys.portfolioSummary(portfolioId),
    value,
    TTL_SECONDS.portfolioSummary,
  );
}

async function invalidatePortfolio(portfolioId) {
  return del(cacheKeys.portfolioSummary(portfolioId));
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
  return getOrSet(
    cacheKeys.portfolioSummary(portfolioId),
    loader,
    TTL_SECONDS.portfolioSummary,
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
  getOrSetPortfolioSummary
};
