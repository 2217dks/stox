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
  });
});
