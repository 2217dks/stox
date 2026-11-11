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
      CACHE_TTL_SESSION_SECONDS: "86400",
    });

    expect(config).toEqual({
      price: 10,
      portfolioSummary: 45,
      leaderboard: 120,
      historicalPrices: 1800,
      symbol: 3600,
      session: 86400,
    });
  });

  test("uses defaults for unspecified environment variables", () => {
    const config = loadCacheConfig({
      CACHE_TTL_PRICE_SECONDS: "15",
    });

    expect(config.price).toBe(15);
    expect(config.portfolioSummary).toBe(30);
    expect(config.leaderboard).toBe(60);
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
    },
  );

  test("returns an immutable configuration", () => {
    const config = loadCacheConfig({});

    expect(Object.isFrozen(config)).toBe(true);
  });
});
