const fakeRedis = {
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
  incr: jest.fn(),
  eval: jest.fn(),
};

jest.mock("../../../src/config/redis", () => ({
  getRedis: jest.fn(),
}));

jest.mock("../../../src/utils/logger", () => ({
  warn: jest.fn(),
}));

const { getRedis } = require("../../../src/config/redis");
const cacheService = require("../../../src/services/cacheService");
const logger = require("../../../src/utils/logger");

describe("cacheService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getRedis.mockResolvedValue(fakeRedis);
    fakeRedis.eval.mockResolvedValue(1);
  });

  describe("generic cache operations", () => {
    test("sets a JSON value with the requested TTL", async () => {
      const value = { symbol: "AAPL", price: "250.10" };

      const result = await cacheService.set("stox:v1:test:key", value, 30);

      expect(result).toBe(true);
      expect(fakeRedis.set).toHaveBeenCalledWith(
        "stox:v1:test:key",
        JSON.stringify(value),
        "EX",
        30,
      );
    });

    test("returns and parses a cached JSON value", async () => {
      fakeRedis.get.mockResolvedValue(JSON.stringify({ price: "250.10" }));

      const result = await cacheService.get("stox:v1:test:key");

      expect(result).toEqual({ price: "250.10" });
      expect(fakeRedis.incr).toHaveBeenCalledWith("stox:v1:metrics:cache:hits");
    });

    test("returns null and records a miss when the key is absent", async () => {
      fakeRedis.get.mockResolvedValue(null);

      const result = await cacheService.get("stox:v1:test:key");

      expect(result).toBeNull();
      expect(fakeRedis.incr).toHaveBeenCalledWith(
        "stox:v1:metrics:cache:misses",
      );
    });

    test("deletes one or more keys", async () => {
      fakeRedis.del.mockResolvedValue(2);

      const result = await cacheService.del(
        "stox:v1:test:key-one",
        "stox:v1:test:key-two",
      );

      expect(result).toBe(2);
      expect(fakeRedis.del).toHaveBeenCalledWith(
        "stox:v1:test:key-one",
        "stox:v1:test:key-two",
      );
    });
  });

  describe("cache-aside behavior", () => {
    test("loads and caches a value on a cache miss", async () => {
      fakeRedis.get.mockResolvedValue(null);

      const loader = jest.fn().mockResolvedValue({
        id: "portfolio-1",
        cashBalance: "10000",
      });

      const result = await cacheService.getOrSet(
        "stox:v1:portfolio:summary:portfolio-1",
        loader,
        30,
      );

      expect(result).toEqual({
        id: "portfolio-1",
        cashBalance: "10000",
      });

      expect(loader).toHaveBeenCalledTimes(1);
      expect(fakeRedis.set).toHaveBeenCalledWith(
        "stox:v1:portfolio:summary:portfolio-1",
        JSON.stringify({
          id: "portfolio-1",
          cashBalance: "10000",
        }),
        "EX",
        30,
      );
    });

    test("does not call the loader on a cache hit", async () => {
      fakeRedis.get.mockResolvedValue(JSON.stringify({ id: "portfolio-1" }));

      const loader = jest.fn();

      const result = await cacheService.getOrSet(
        "stox:v1:portfolio:summary:portfolio-1",
        loader,
        30,
      );

      expect(result).toEqual({ id: "portfolio-1" });
      expect(loader).not.toHaveBeenCalled();
      expect(fakeRedis.set).not.toHaveBeenCalled();
    });

    test("does not cache null loader results", async () => {
      fakeRedis.get.mockResolvedValue(null);

      const loader = jest.fn().mockResolvedValue(null);

      const result = await cacheService.getOrSet(
        "stox:v1:test:missing",
        loader,
        30,
      );

      expect(result).toBeNull();
      expect(loader).toHaveBeenCalledTimes(1);
      expect(fakeRedis.set).not.toHaveBeenCalled();
    });
  });

  describe("domain helpers", () => {
    test("uses the versioned price key", async () => {
      fakeRedis.get.mockResolvedValue(
        JSON.stringify({
          symbol: "AAPL",
          price: "250.10",
        }),
      );

      const result = await cacheService.getPrice("STOCK", "aapl");

      expect(result).toEqual({
        symbol: "AAPL",
        price: "250.10",
      });

      expect(fakeRedis.get).toHaveBeenCalledWith("stox:v1:price:STOCK:AAPL");
    });

    test("stores a price using the price TTL", async () => {
      const result = await cacheService.setPrice("STOCK", "aapl", {
        symbol: "AAPL",
        price: "250.10",
      });

      expect(result).toBe(true);
      expect(fakeRedis.set).toHaveBeenCalledWith(
        "stox:v1:price:STOCK:AAPL",
        JSON.stringify({
          symbol: "AAPL",
          price: "250.10",
        }),
        "EX",
        cacheService.TTL_SECONDS.price,
      );
    });

    test("atomically invalidates a portfolio summary and advances its generation", async () => {
      fakeRedis.eval.mockResolvedValue(1);

      const result = await cacheService.invalidatePortfolio("portfolio-1");

      expect(result).toBe(1);

      expect(fakeRedis.eval).toHaveBeenCalledWith(
        expect.stringContaining("INCR"),
        2,
        "stox:v1:portfolio:summary:generation:portfolio-1",
        "stox:v1:portfolio:summary:portfolio-1",
      );
    });

    test("loads and caches a portfolio summary on a miss", async () => {
      fakeRedis.get.mockResolvedValue(null);

      const loader = jest.fn().mockResolvedValue({
        id: "portfolio-1",
        cashBalance: "10000",
        totalValue: "12500",
      });

      const result = await cacheService.getOrSetPortfolioSummary(
        "portfolio-1",
        loader,
      );

      expect(result.totalValue).toBe("12500");
      expect(loader).toHaveBeenCalledTimes(1);
      expect(fakeRedis.eval).toHaveBeenCalledWith(
        expect.stringContaining("SET"),
        2,
        "stox:v1:portfolio:summary:generation:portfolio-1",
        "stox:v1:portfolio:summary:portfolio-1",
        "0",
        JSON.stringify({
          id: "portfolio-1",
          cashBalance: "10000",
          totalValue: "12500",
        }),
        cacheService.TTL_SECONDS.portfolioSummary,
      );
    });

    test("does not load a portfolio summary on a cache hit", async () => {
      fakeRedis.get.mockResolvedValue(
        JSON.stringify({
          id: "portfolio-1",
          totalValue: "12500",
        }),
      );

      const loader = jest.fn();

      const result = await cacheService.getOrSetPortfolioSummary(
        "portfolio-1",
        loader,
      );

      expect(result.totalValue).toBe("12500");
      expect(loader).not.toHaveBeenCalled();
    });

    test("loads and caches a quote on a cache miss", async () => {
      fakeRedis.get.mockResolvedValue(null);

      const loader = jest.fn().mockResolvedValue({
        symbol: "AAPL",
        assetClass: "STOCK",
        price: "250.10",
      });

      const result = await cacheService.getOrSetPrice("STOCK", "aapl", loader);

      expect(result).toEqual({
        symbol: "AAPL",
        assetClass: "STOCK",
        price: "250.10",
      });

      expect(loader).toHaveBeenCalledTimes(1);
      expect(fakeRedis.set).toHaveBeenCalledWith(
        "stox:v1:price:STOCK:AAPL",
        JSON.stringify({
          symbol: "AAPL",
          assetClass: "STOCK",
          price: "250.10",
        }),
        "EX",
        cacheService.TTL_SECONDS.price,
      );
    });

    test("does not call the quote loader on a cache hit", async () => {
      fakeRedis.get.mockResolvedValue(
        JSON.stringify({
          symbol: "AAPL",
          assetClass: "STOCK",
          price: "250.10",
        }),
      );

      const loader = jest.fn();

      const result = await cacheService.getOrSetPrice("STOCK", "AAPL", loader);

      expect(result.price).toBe("250.10");
      expect(loader).not.toHaveBeenCalled();
    });

    test("does not cache an in-flight summary after portfolio invalidation", async () => {
      const generationKey = "stox:v1:portfolio:summary:generation:portfolio-1";

      const summaryKey = "stox:v1:portfolio:summary:portfolio-1";

      let generation = "0";
      let cachedSummary = null;
      let resolveLoader;

      let markLoaderStarted;

      const loaderStarted = new Promise((resolve) => {
        markLoaderStarted = resolve;
      });

      fakeRedis.get.mockImplementation(async (key) => {
        if (key === summaryKey) {
          return null;
        }

        if (key === generationKey) {
          return generation;
        }

        return null;
      });

      fakeRedis.eval.mockImplementation(
        async (
          script,
          numberOfKeys,
          genKey,
          cacheKey,
          expectedGeneration,
          value,
        ) => {
          // Simulate atomic invalidation.
          if (script.includes("INCR")) {
            generation = String(Number(generation) + 1);
            cachedSummary = null;

            return 0;
          }

          // Simulate the generation-checked cache write.
          if (generation !== expectedGeneration) {
            return 0;
          }

          cachedSummary = value;

          return 1;
        },
      );

      const loader = jest.fn(() => {
        markLoaderStarted();

        return new Promise((resolve) => {
          resolveLoader = resolve;
        });
      });

      const pendingSummary = cacheService.getOrSetPortfolioSummary(
        "portfolio-1",
        loader,
      );

      // Wait until the loader is running with generation 0.
      await loaderStarted;

      // Simulate a trade updating the portfolio.
      await cacheService.invalidatePortfolio("portfolio-1");

      // The old loader now finishes with stale data.
      resolveLoader({
        id: "portfolio-1",
        totalValue: "10000",
      });

      const result = await pendingSummary;

      // The original request still receives its loader result.
      expect(result.totalValue).toBe("10000");

      // But the stale result must not be written into Redis.
      expect(generation).toBe("1");
      expect(cachedSummary).toBeNull();

      expect(loader).toHaveBeenCalledTimes(1);
    });
  });

  describe("metrics", () => {
    test("returns hit, miss, total, and hit-rate metrics", async () => {
      fakeRedis.get.mockResolvedValueOnce("8").mockResolvedValueOnce("2");

      const result = await cacheService.getMetrics();

      expect(result).toEqual({
        hits: 8,
        misses: 2,
        total: 10,
        hitRate: 0.8,
      });
    });

    test("returns zero metrics when no requests have been recorded", async () => {
      fakeRedis.get.mockResolvedValueOnce(null).mockResolvedValueOnce(null);

      const result = await cacheService.getMetrics();

      expect(result).toEqual({
        hits: 0,
        misses: 0,
        total: 0,
        hitRate: 0,
      });
    });
  });

  describe("Redis failure behavior", () => {
    test("fails open when Redis cannot be reached", async () => {
      getRedis.mockRejectedValue(new Error("Redis is offline"));

      await expect(cacheService.get("stox:v1:test:key")).resolves.toBeNull();

      await expect(
        cacheService.set("stox:v1:test:key", { value: 1 }, 30),
      ).resolves.toBe(false);

      expect(logger.warn).toHaveBeenCalled();
    });

    test("returns fallback metrics when Redis is unavailable", async () => {
      getRedis.mockRejectedValue(new Error("Redis is offline"));

      await expect(cacheService.getMetrics()).resolves.toEqual({
        hits: 0,
        misses: 0,
        total: 0,
        hitRate: 0,
      });
    });

    test("analytics helpers fall back to loader when Redis fails", async () => {
      getRedis.mockRejectedValue(new Error("Redis cluster down"));

      const heatmapLoader = jest.fn().mockResolvedValue({ heatmap: [] });
      const statsLoader = jest.fn().mockResolvedValue({ totalTrades: 5 });

      const heatmap = await cacheService.getOrSetPortfolioHeatmap(
        "p-1",
        "u-1",
        { period: "1M" },
        heatmapLoader,
      );
      expect(heatmap).toEqual({ heatmap: [] });
      expect(heatmapLoader).toHaveBeenCalledTimes(1);

      const stats = await cacheService.getOrSetUserStatistics(
        "u-1",
        { symbol: "AAPL" },
        statsLoader,
      );
      expect(stats).toEqual({ totalTrades: 5 });
      expect(statsLoader).toHaveBeenCalledTimes(1);

      expect(logger.warn).toHaveBeenCalled();
    });
  });

  describe("analytics helpers with generation-based isolation", () => {
    const portfolioId = "port-123";
    const userId = "user-456";

    test("caches heatmap on miss using analyticsHeatmap TTL", async () => {
      fakeRedis.get.mockImplementation(async (key) => {
        if (key.includes("generation:portfolio")) return "1";
        return null;
      });

      const loader = jest.fn().mockResolvedValue({ heatmap: [{ date: "2026-01-01" }] });
      const result = await cacheService.getOrSetPortfolioHeatmap(
        portfolioId,
        userId,
        { period: "1M" },
        loader,
      );

      expect(result).toEqual({ heatmap: [{ date: "2026-01-01" }] });
      expect(loader).toHaveBeenCalledTimes(1);
      expect(fakeRedis.eval).toHaveBeenCalledWith(
        expect.stringContaining("if redis.call(\"GET\", KEYS[1]) == ARGV[1] then"),
        2,
        `stox:v1:analytics:generation:portfolio:${portfolioId}`,
        `stox:v1:analytics:p:${portfolioId}:u:${userId}:g:1:heatmap:1M:`,
        "1",
        JSON.stringify({ heatmap: [{ date: "2026-01-01" }] }),
        cacheService.TTL_SECONDS.analyticsHeatmap,
      );
    });

    test("returns cached heatmap on hit without invoking loader", async () => {
      fakeRedis.get.mockImplementation(async (key) => {
        if (key.includes("generation:portfolio")) return "1";
        if (key.includes("heatmap")) return JSON.stringify({ cached: true });
        return null;
      });

      const loader = jest.fn();
      const result = await cacheService.getOrSetPortfolioHeatmap(
        portfolioId,
        userId,
        { period: "1M" },
        loader,
      );

      expect(result).toEqual({ cached: true });
      expect(loader).not.toHaveBeenCalled();
    });

    test("caches risk metrics using analyticsRiskMetrics TTL", async () => {
      fakeRedis.get.mockImplementation(async (key) => {
        if (key.includes("generation:portfolio")) return "2";
        return null;
      });

      const loader = jest.fn().mockResolvedValue({ annualizedVolatility: "0.1500" });
      const result = await cacheService.getOrSetPortfolioRiskMetrics(
        portfolioId,
        userId,
        { period: "1M", riskFreeRate: 0.02 },
        loader,
      );

      expect(result).toEqual({ annualizedVolatility: "0.1500" });
      expect(fakeRedis.eval).toHaveBeenCalledWith(
        expect.any(String),
        2,
        `stox:v1:analytics:generation:portfolio:${portfolioId}`,
        `stox:v1:analytics:p:${portfolioId}:u:${userId}:g:2:risk-metrics:1M:0.02`,
        "2",
        JSON.stringify({ annualizedVolatility: "0.1500" }),
        cacheService.TTL_SECONDS.analyticsRiskMetrics,
      );
    });

    test("caches benchmark and benchmark-comparison using respective TTLs", async () => {
      fakeRedis.get.mockImplementation(async (key) => {
        if (key.includes("generation:portfolio")) return "0";
        return null;
      });

      const benchLoader = jest.fn().mockResolvedValue({ benchmark: "SPY" });
      await cacheService.getOrSetPortfolioBenchmark(
        portfolioId,
        userId,
        "SPY",
        { period: "1M" },
        benchLoader,
      );
      expect(fakeRedis.eval).toHaveBeenCalledWith(
        expect.any(String),
        2,
        `stox:v1:analytics:generation:portfolio:${portfolioId}`,
        `stox:v1:analytics:p:${portfolioId}:u:${userId}:g:0:benchmark:SPY:1M`,
        "0",
        JSON.stringify({ benchmark: "SPY" }),
        cacheService.TTL_SECONDS.analyticsBenchmark,
      );

      const compLoader = jest.fn().mockResolvedValue({ beta: "1.05" });
      await cacheService.getOrSetPortfolioBenchmarkComparison(
        portfolioId,
        userId,
        "SPY",
        { period: "1M", riskFreeRate: 0.02 },
        compLoader,
      );
      expect(fakeRedis.eval).toHaveBeenCalledWith(
        expect.any(String),
        2,
        `stox:v1:analytics:generation:portfolio:${portfolioId}`,
        `stox:v1:analytics:p:${portfolioId}:u:${userId}:g:0:benchmark-comparison:SPY:1M:0.02`,
        "0",
        JSON.stringify({ beta: "1.05" }),
        cacheService.TTL_SECONDS.analyticsBenchmarkComparison,
      );
    });

    test("caches monthly performance using analyticsMonthlyPerformance TTL", async () => {
      fakeRedis.get.mockImplementation(async (key) => {
        if (key.includes("generation:portfolio")) return "0";
        return null;
      });

      const loader = jest.fn().mockResolvedValue({ months: [] });
      await cacheService.getOrSetPortfolioMonthlyPerformance(
        portfolioId,
        userId,
        { year: 2026 },
        loader,
      );

      expect(fakeRedis.eval).toHaveBeenCalledWith(
        expect.any(String),
        2,
        `stox:v1:analytics:generation:portfolio:${portfolioId}`,
        `stox:v1:analytics:p:${portfolioId}:u:${userId}:g:0:monthly:2026::`,
        "0",
        JSON.stringify({ months: [] }),
        cacheService.TTL_SECONDS.analyticsMonthlyPerformance,
      );
    });

    test("caches user statistics and monthly breakdown using userStatistics TTL", async () => {
      fakeRedis.get.mockImplementation(async (key) => {
        if (key.includes("generation:user")) return "5";
        return null;
      });

      const statsLoader = jest.fn().mockResolvedValue({ totalTrades: 10 });
      await cacheService.getOrSetUserStatistics(
        userId,
        { symbol: "AAPL", side: "BUY" },
        statsLoader,
      );
      expect(fakeRedis.eval).toHaveBeenCalledWith(
        expect.any(String),
        2,
        `stox:v1:analytics:generation:user:${userId}`,
        `stox:v1:analytics:u:${userId}:g:5:stats::AAPL:BUY::::0`,
        "5",
        JSON.stringify({ totalTrades: 10 }),
        cacheService.TTL_SECONDS.userStatistics,
      );

      const monthlyLoader = jest.fn().mockResolvedValue([{ month: "2026-01" }]);
      await cacheService.getOrSetUserMonthlyStatistics(
        userId,
        {},
        monthlyLoader,
      );
      expect(fakeRedis.eval).toHaveBeenCalledWith(
        expect.any(String),
        2,
        `stox:v1:analytics:generation:user:${userId}`,
        `stox:v1:analytics:u:${userId}:g:5:stats-monthly::::::`,
        "5",
        JSON.stringify([{ month: "2026-01" }]),
        cacheService.TTL_SECONDS.userStatistics,
      );
    });

    test("invalidations increment generation keys", async () => {
      await cacheService.invalidatePortfolioAnalytics(portfolioId);
      expect(fakeRedis.incr).toHaveBeenCalledWith(
        `stox:v1:analytics:generation:portfolio:${portfolioId}`,
      );

      await cacheService.invalidateUserAnalytics(userId);
      expect(fakeRedis.incr).toHaveBeenCalledWith(
        `stox:v1:analytics:generation:user:${userId}`,
      );

      await cacheService.invalidateAnalytics({ portfolioId, userId });
      expect(fakeRedis.incr).toHaveBeenCalledTimes(4);
    });

    test("does not cache when loader yields null or undefined", async () => {
      fakeRedis.get.mockResolvedValue(null);
      const nullLoader = jest.fn().mockResolvedValue(null);

      const res = await cacheService.getOrSetPortfolioHeatmap(
        portfolioId,
        userId,
        {},
        nullLoader,
      );

      expect(res).toBeNull();
      expect(fakeRedis.eval).not.toHaveBeenCalled();
    });
  });
});
