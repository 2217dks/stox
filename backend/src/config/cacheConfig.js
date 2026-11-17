const DEFAULT_TTL_SECONDS = Object.freeze({
  price: 5,
  portfolioSummary: 30,
  leaderboard: 60,
  historicalPrices: 60 * 60,
  symbol: 24 * 60 * 60,
  symbolSearch: 3600,
  session: 7 * 24 * 60 * 60,
  analyticsHeatmap: 300,
  analyticsRiskMetrics: 300,
  analyticsBenchmark: 3600,
  analyticsBenchmarkComparison: 300,
  analyticsMonthlyPerformance: 300,
  userStatistics: 120,
});

const TTL_ENV_KEYS = Object.freeze({
  price: "CACHE_TTL_PRICE_SECONDS",
  portfolioSummary: "CACHE_TTL_PORTFOLIO_SUMMARY_SECONDS",
  leaderboard: "CACHE_TTL_LEADERBOARD_SECONDS",
  historicalPrices: "CACHE_TTL_HISTORICAL_PRICES_SECONDS",
  symbol: "CACHE_TTL_SYMBOL_SECONDS",
  symbolSearch: "CACHE_TTL_SYMBOL_SEARCH_SECONDS",
  session: "CACHE_TTL_SESSION_SECONDS",
  analyticsHeatmap: "CACHE_TTL_ANALYTICS_HEATMAP_SECONDS",
  analyticsRiskMetrics: "CACHE_TTL_ANALYTICS_RISK_METRICS_SECONDS",
  analyticsBenchmark: "CACHE_TTL_ANALYTICS_BENCHMARK_SECONDS",
  analyticsBenchmarkComparison: "CACHE_TTL_ANALYTICS_BENCHMARK_COMPARISON_SECONDS",
  analyticsMonthlyPerformance: "CACHE_TTL_ANALYTICS_MONTHLY_PERFORMANCE_SECONDS",
  userStatistics: "CACHE_TTL_USER_STATISTICS_SECONDS",
});

function readTtl(value, fallback, envName) {
  if (value === undefined || value === "") {
    return fallback;
  }

  const ttl = Number(value);

  if (!Number.isSafeInteger(ttl) || ttl <= 0) {
    throw new Error(
      `${envName} must be a positive safe integer representing seconds.`,
    );
  }

  return ttl;
}

function loadCacheConfig(env = process.env) {
  const config = {};

  for (const [resource, envName] of Object.entries(TTL_ENV_KEYS)) {
    config[resource] = readTtl(
      env[envName],
      DEFAULT_TTL_SECONDS[resource],
      envName,
    );
  }

  return Object.freeze(config);
}

module.exports = {
  DEFAULT_TTL_SECONDS,
  TTL_ENV_KEYS,
  loadCacheConfig,
};
