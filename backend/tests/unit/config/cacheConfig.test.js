const {
  DEFAULT_TTL_SECONDS,
  loadCacheConfig,
} = require("../../../src/config/cacheConfig");

describe("cacheConfig", () => {
  test("uses existing default TTL values", () => {
    expect(loadCacheConfig({})).toEqual(DEFAULT_TTL_SECONDS);
  });

  test("loads custom TTL values from environment", () => {
    const config = loadCacheConfig({
      CACHE_TTL_PRICE_SECONDS: "10",
      CACHE_TTL_PORTFOLIO_SUMMARY_SECONDS: "45",
      CACHE_TTL_LEADERBOARD_SECONDS: "120",
      CACHE_TTL_HISTORICAL_PRICES_SECONDS: "1800",
      CACHE_TTL_SYMBOL_SECONDS: "3600",
      CACHE_TTL_SYMBOL_SEARCH_SECONDS: "1200",
      CACHE_TTL_SESSION_SECONDS: "86400",
      CACHE_TTL_ANALYTICS_HEATMAP_SECONDS: "600",
      CACHE_TTL_ANALYTICS_RISK_METRICS_SECONDS: "450",
      CACHE_TTL_ANALYTICS_BENCHMARK_SECONDS: "7200",
      CACHE_TTL_ANALYTICS_BENCHMARK_COMPARISON_SECONDS: "500",
      CACHE_TTL_ANALYTICS_MONTHLY_PERFORMANCE_SECONDS: "900",
      CACHE_TTL_USER_STATISTICS_SECONDS: "240",
    });

    expect(config).toEqual({
      price: 10,
      portfolioSummary: 45,
      leaderboard: 120,
      historicalPrices: 1800,
      symbol: 3600,
      symbolSearch: 1200,
      session: 86400,
      analyticsHeatmap: 600,
      analyticsRiskMetrics: 450,
      analyticsBenchmark: 7200,
      analyticsBenchmarkComparison: 500,
      analyticsMonthlyPerformance: 900,
      userStatistics: 240,
    });
  });

  test("uses defaults for unspecified environment variables", () => {
    const config = loadCacheConfig({
      CACHE_TTL_PRICE_SECONDS: "15",
    });

    expect(config.price).toBe(15);
    expect(config.portfolioSummary).toBe(30);
    expect(config.leaderboard).toBe(60);
    expect(config.analyticsHeatmap).toBe(300);
    expect(config.analyticsRiskMetrics).toBe(300);
    expect(config.analyticsBenchmark).toBe(3600);
    expect(config.analyticsBenchmarkComparison).toBe(300);
    expect(config.analyticsMonthlyPerformance).toBe(300);
    expect(config.userStatistics).toBe(120);
    expect(config.symbolSearch).toBe(3600);
  });

  test.each(["0", "-5", "1.5", "abc", "Infinity"])(
    "rejects invalid TTL value: %s",
    (value) => {
      expect(() =>
        loadCacheConfig({
          CACHE_TTL_PRICE_SECONDS: value,
        }),
      ).toThrow(
        "CACHE_TTL_PRICE_SECONDS must be a positive safe integer representing seconds.",
      );
      expect(() =>
        loadCacheConfig({
          CACHE_TTL_ANALYTICS_HEATMAP_SECONDS: value,
        }),
      ).toThrow(
        "CACHE_TTL_ANALYTICS_HEATMAP_SECONDS must be a positive safe integer representing seconds.",
      );
    },
  );

  test("returns an immutable configuration", () => {
    const config = loadCacheConfig({});

    expect(Object.isFrozen(config)).toBe(true);
  });
});
