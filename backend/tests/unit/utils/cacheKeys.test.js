const cacheKeys = require("../../../src/utils/cacheKeys");

describe("cacheKeys", () => {
  const userId1 = "11111111-1111-1111-1111-111111111111";
  const userId2 = "22222222-2222-2222-2222-222222222222";
  const portfolioId1 = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const portfolioId2 = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

  describe("generation keys", () => {
    test("generates portfolio analytics generation key", () => {
      const key = cacheKeys.portfolioAnalyticsGeneration(portfolioId1);
      expect(key).toBe(`stox:v1:analytics:generation:portfolio:${portfolioId1}`);
    });

    test("generates user analytics generation key", () => {
      const key = cacheKeys.userAnalyticsGeneration(userId1);
      expect(key).toBe(`stox:v1:analytics:generation:user:${userId1}`);
    });

    test("throws if portfolioId or userId is missing", () => {
      expect(() => cacheKeys.portfolioAnalyticsGeneration()).toThrow("portfolioId is required");
      expect(() => cacheKeys.userAnalyticsGeneration()).toThrow("userId is required");
    });
  });

  describe("heatmap cache keys", () => {
    test("differentiates owners and portfolios", () => {
      const key1 = cacheKeys.analyticsPortfolioHeatmap(portfolioId1, userId1, { period: "1M" });
      const key2 = cacheKeys.analyticsPortfolioHeatmap(portfolioId1, userId2, { period: "1M" });
      const key3 = cacheKeys.analyticsPortfolioHeatmap(portfolioId2, userId1, { period: "1M" });

      expect(key1).not.toBe(key2);
      expect(key1).not.toBe(key3);
      expect(key1).toContain(`p:${portfolioId1}:u:${userId1}:heatmap:1M:`);
    });

    test("differentiates periods and years", () => {
      const k1 = cacheKeys.analyticsPortfolioHeatmap(portfolioId1, userId1, { period: "1M" });
      const k2 = cacheKeys.analyticsPortfolioHeatmap(portfolioId1, userId1, { period: "1Y" });
      const k3 = cacheKeys.analyticsPortfolioHeatmap(portfolioId1, userId1, { year: 2026 });

      expect(k1).not.toBe(k2);
      expect(k1).not.toBe(k3);
      expect(k3).toContain(":heatmap:1M:2026");
    });
  });

  describe("risk metrics cache keys", () => {
    test("differentiates periods and riskFreeRate", () => {
      const k1 = cacheKeys.analyticsPortfolioRiskMetrics(portfolioId1, userId1, { period: "1M", riskFreeRate: 0.02 });
      const k2 = cacheKeys.analyticsPortfolioRiskMetrics(portfolioId1, userId1, { period: "1M", riskFreeRate: 0.05 });
      const k3 = cacheKeys.analyticsPortfolioRiskMetrics(portfolioId1, userId1, { period: "3M", riskFreeRate: 0.02 });

      expect(k1).not.toBe(k2);
      expect(k1).not.toBe(k3);
    });
  });

  describe("benchmark and comparison cache keys", () => {
    test("normalizes benchmark symbols", () => {
      const k1 = cacheKeys.analyticsPortfolioBenchmark(portfolioId1, userId1, "spy");
      const k2 = cacheKeys.analyticsPortfolioBenchmark(portfolioId1, userId1, "SPY ");
      const k3 = cacheKeys.analyticsPortfolioBenchmark(portfolioId1, userId1, "QQQ");

      expect(k1).toBe(k2);
      expect(k1).not.toBe(k3);
    });

    test("benchmark comparison includes riskFreeRate and period", () => {
      const k1 = cacheKeys.analyticsPortfolioBenchmarkComparison(portfolioId1, userId1, "SPY", { period: "1M", riskFreeRate: 0.02 });
      const k2 = cacheKeys.analyticsPortfolioBenchmarkComparison(portfolioId1, userId1, "SPY", { period: "1M", riskFreeRate: 0.03 });

      expect(k1).not.toBe(k2);
      expect(k1).toContain("benchmark-comparison:SPY:1M:0.02");
    });
  });

  describe("monthly performance cache keys", () => {
    test("handles from and to bounds and years", () => {
      const k1 = cacheKeys.analyticsPortfolioMonthlyPerformance(portfolioId1, userId1, { from: "2026-01", to: "2026-03" });
      const k2 = cacheKeys.analyticsPortfolioMonthlyPerformance(portfolioId1, userId1, { year: 2026 });

      expect(k1).toContain(":monthly::2026-01:2026-03");
      expect(k2).toContain(":monthly:2026::");
    });
  });

  describe("user statistics cache keys", () => {
    test("user statistics are isolated per user", () => {
      const k1 = cacheKeys.analyticsUserStatistics(userId1, {});
      const k2 = cacheKeys.analyticsUserStatistics(userId2, {});

      expect(k1).not.toBe(k2);
      expect(k1).toContain(`stox:v1:analytics:u:${userId1}:stats:`);
    });

    test("includes filters in key and normalizes symbol/side/assetType", () => {
      const k1 = cacheKeys.analyticsUserStatistics(userId1, {
        symbol: "aapl ",
        side: "buy",
        assetType: "stock",
        includeMonthly: true,
      });
      const k2 = cacheKeys.analyticsUserStatistics(userId1, {
        symbol: "AAPL",
        side: "BUY",
        assetType: "STOCK",
        includeMonthly: true,
      });
      const k3 = cacheKeys.analyticsUserStatistics(userId1, {
        symbol: "AAPL",
        side: "BUY",
        assetType: "STOCK",
        includeMonthly: false,
      });

      expect(k1).toBe(k2);
      expect(k1).not.toBe(k3);
      expect(k1).toContain(":stats::AAPL:BUY:STOCK:::1");
    });

    test("user monthly statistics isolation", () => {
      const k1 = cacheKeys.analyticsUserMonthlyStatistics(userId1, { symbol: "MSFT" });
      const k2 = cacheKeys.analyticsUserMonthlyStatistics(userId2, { symbol: "MSFT" });

      expect(k1).not.toBe(k2);
      expect(k1).toContain(`stox:v1:analytics:u:${userId1}:stats-monthly::MSFT`);
    });
  });

  describe("marketSearch and symbolSearch cache keys", () => {
    test("generates expected stable key with default options", () => {
      const key = cacheKeys.marketSearch("apple");
      expect(key).toBe("stox:v1:market:search:ALL:APPLE:ALL");
    });

    test("normalizes query case, surrounding whitespace, and internal spacing", () => {
      const k1 = cacheKeys.marketSearch("apple");
      const k2 = cacheKeys.marketSearch("  APPLE  ");
      const k3 = cacheKeys.marketSearch("  apple  ");
      const k4 = cacheKeys.marketSearch("  apple   inc  ");

      expect(k1).toBe(k2);
      expect(k1).toBe(k3);
      expect(k4).toBe("stox:v1:market:search:ALL:APPLE INC:ALL");
    });

    test("normalizes assetClass and limit filters", () => {
      const k1 = cacheKeys.marketSearch("aapl", { assetClass: "stock", limit: 20 });
      const k2 = cacheKeys.marketSearch("AAPL", { assetClass: "STOCK", limit: "20" });
      const k3 = cacheKeys.marketSearch("btc", { assetClass: "crypto", limit: 50 });

      expect(k1).toBe("stox:v1:market:search:STOCK:AAPL:20");
      expect(k1).toBe(k2);
      expect(k3).toBe("stox:v1:market:search:CRYPTO:BTC:50");
    });

    test("differentiates keys when query, assetClass, or limit differs", () => {
      const base = cacheKeys.marketSearch("apple", { assetClass: "STOCK", limit: 20 });
      const diffQuery = cacheKeys.marketSearch("msft", { assetClass: "STOCK", limit: 20 });
      const diffClass = cacheKeys.marketSearch("apple", { assetClass: "CRYPTO", limit: 20 });
      const diffLimit = cacheKeys.marketSearch("apple", { assetClass: "STOCK", limit: 10 });
      const allClass = cacheKeys.marketSearch("apple", { limit: 20 });

      expect(base).not.toBe(diffQuery);
      expect(base).not.toBe(diffClass);
      expect(base).not.toBe(diffLimit);
      expect(base).not.toBe(allClass);
    });

    test("symbolSearch is an alias for marketSearch", () => {
      const k1 = cacheKeys.symbolSearch("apple", { assetClass: "STOCK", limit: 20 });
      const k2 = cacheKeys.marketSearch("apple", { assetClass: "STOCK", limit: 20 });

      expect(k1).toBe(k2);
    });

    test("throws an error when query is missing or whitespace-only", () => {
      expect(() => cacheKeys.marketSearch()).toThrow("query is required");
      expect(() => cacheKeys.marketSearch("")).toThrow("query is required");
      expect(() => cacheKeys.marketSearch("   ")).toThrow("query is required");
      expect(() => cacheKeys.marketSearch(null)).toThrow("query is required");
      expect(() => cacheKeys.marketSearch(undefined)).toThrow("query is required");
    });
  });
});
