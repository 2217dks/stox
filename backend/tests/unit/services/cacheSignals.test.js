const { registry } = require("../../../src/observability/metrics");

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
  debug: jest.fn(),
  info: jest.fn(),
  error: jest.fn(),
}));

const { getRedis } = require("../../../src/config/redis");
const cacheService = require("../../../src/services/cacheService");
const logger = require("../../../src/utils/logger");

describe("cacheService signals and metrics", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    registry.reset();
    fakeRedis.get.mockReset();
    fakeRedis.set.mockReset();
    fakeRedis.del.mockReset();
    fakeRedis.incr.mockReset();
    fakeRedis.eval.mockReset();
    fakeRedis.set.mockResolvedValue("OK");
    fakeRedis.del.mockResolvedValue(1);
    fakeRedis.incr.mockResolvedValue(1);
    getRedis.mockResolvedValue(fakeRedis);
  });

  test("records hit signals in Prometheus registry and logs structured debug output", async () => {
    fakeRedis.get.mockResolvedValue(JSON.stringify({ price: "150.00" }));

    const result = await cacheService.getPrice("STOCK", "AAPL");

    expect(result).toEqual({ price: "150.00" });
    expect(fakeRedis.incr).toHaveBeenCalledWith("stox:v1:metrics:cache:hits");

    const rendered = registry.render();
    expect(rendered).toContain('cache_operations_total{outcome="hit",resource="price"} 1');

    expect(logger.debug).toHaveBeenCalledWith(
      "Cache hit",
      expect.objectContaining({
        resource: "price",
        outcome: "hit",
        assetClass: "STOCK",
      }),
    );
  });

  test("records miss signals in Prometheus registry and calls loader", async () => {
    fakeRedis.get.mockResolvedValue(null);
    fakeRedis.set.mockResolvedValue("OK");

    const loader = jest.fn().mockResolvedValue({ price: "155.00" });
    const result = await cacheService.getOrSetPrice("CRYPTO", "BTCUSDT", loader);

    expect(result).toEqual({ price: "155.00" });
    expect(loader).toHaveBeenCalledTimes(1);
    expect(fakeRedis.incr).toHaveBeenCalledWith("stox:v1:metrics:cache:misses");

    const rendered = registry.render();
    expect(rendered).toContain('cache_operations_total{outcome="miss",resource="price"} 1');

    expect(logger.debug).toHaveBeenCalledWith(
      "Cache miss",
      expect.objectContaining({
        resource: "price",
        outcome: "miss",
        assetClass: "CRYPTO",
      }),
    );
  });

  test("records bypass signals when bypass is explicitly requested", async () => {
    const loader = jest.fn().mockResolvedValue({ price: "200.00" });

    const result = await cacheService.getOrSetPrice("STOCK", "MSFT", loader, {
      bypass: true,
    });

    expect(result).toEqual({ price: "200.00" });
    expect(loader).toHaveBeenCalledTimes(1);
    expect(fakeRedis.get).not.toHaveBeenCalled();

    const rendered = registry.render();
    expect(rendered).toContain('cache_operations_total{outcome="bypass",resource="price"} 1');

    expect(logger.debug).toHaveBeenCalledWith(
      "Cache operation bypassed",
      expect.objectContaining({
        resource: "price",
        outcome: "bypass",
        assetClass: "STOCK",
      }),
    );
  });

  test("consistently honors bypassCache, skipCache, and noCache across getOrSetPrice, getPrice, and direct get()", async () => {
    // 1. bypassCache on getOrSetPrice
    const loader1 = jest.fn().mockResolvedValue({ price: "101.00" });
    const res1 = await cacheService.getOrSetPrice("STOCK", "AAPL", loader1, { bypassCache: true });
    expect(res1).toEqual({ price: "101.00" });
    expect(loader1).toHaveBeenCalledTimes(1);
    expect(fakeRedis.get).not.toHaveBeenCalled();

    // 2. skipCache on getOrSetPrice
    const loader2 = jest.fn().mockResolvedValue({ price: "102.00" });
    const res2 = await cacheService.getOrSetPrice("STOCK", "AAPL", loader2, { skipCache: true });
    expect(res2).toEqual({ price: "102.00" });
    expect(loader2).toHaveBeenCalledTimes(1);

    // 3. noCache on getOrSetPrice
    const loader3 = jest.fn().mockResolvedValue({ price: "103.00" });
    const res3 = await cacheService.getOrSetPrice("STOCK", "AAPL", loader3, { noCache: true });
    expect(res3).toEqual({ price: "103.00" });
    expect(loader3).toHaveBeenCalledTimes(1);

    // 4. bypassCache on direct getPrice
    const directPrice = await cacheService.getPrice("STOCK", "AAPL", { bypassCache: true });
    expect(directPrice).toBeNull();

    // 5. noCache on direct get()
    const directGet = await cacheService.get("some:key", { noCache: true, resource: "price" });
    expect(directGet).toBeNull();

    // Verify del was never called - valid cached entries are NOT evicted on bypass!
    expect(fakeRedis.del).not.toHaveBeenCalled();
  });

  test("does not delete valid cached entry during bypass and returns cached value on next normal read", async () => {
    fakeRedis.get.mockResolvedValue(JSON.stringify({ price: "150.00" }));

    // Bypass call fetches fresh data from loader without calling redis.del
    const loader = jest.fn().mockResolvedValue({ price: "160.00" });
    const bypassed = await cacheService.getOrSetPrice("STOCK", "AAPL", loader, { bypassCache: true });
    expect(bypassed).toEqual({ price: "160.00" });
    expect(fakeRedis.del).not.toHaveBeenCalled();

    // Subsequent normal call still reads cached data successfully
    const cached = await cacheService.getPrice("STOCK", "AAPL");
    expect(cached).toEqual({ price: "150.00" });
  });

  test("records error signals and ensures market data operation succeeds when Redis fails", async () => {
    // Redis throws on get
    fakeRedis.get.mockRejectedValue(new Error("Connection refused"));
    // Redis throws on set
    fakeRedis.set.mockRejectedValue(new Error("Write error"));

    const loader = jest.fn().mockResolvedValue({ price: "175.00" });
    // getOrSetPrice must not throw! It should call loader and return the fresh quote!
    const result = await cacheService.getOrSetPrice("STOCK", "AAPL", loader);

    expect(result).toEqual({ price: "175.00" });
    expect(loader).toHaveBeenCalledTimes(1);

    const rendered = registry.render();
    expect(rendered).toContain('cache_operations_total{outcome="error",resource="price"}');

    expect(logger.warn).toHaveBeenCalledWith(
      "Redis cache operation failed",
      expect.objectContaining({
        message: "Connection refused",
      }),
    );
  });

  test("records hit, miss, bypass, and error signals for historical_prices path", async () => {
    // 1. Hit
    fakeRedis.get.mockResolvedValueOnce(JSON.stringify({ prices: [{ close: "100" }] }));
    const hit = await cacheService.getHistoricalPrices("STOCK", "AAPL", "1d", 1000, 2000, 10);
    expect(hit).toEqual({ prices: [{ close: "100" }] });

    // 2. Miss
    fakeRedis.get.mockResolvedValueOnce(null);
    const miss = await cacheService.getHistoricalPrices("STOCK", "AAPL", "1d", 1000, 2000, 10);
    expect(miss).toBeNull();

    // 3. Bypass
    const bypassed = await cacheService.getHistoricalPrices("STOCK", "AAPL", "1d", 1000, 2000, 10, {
      bypassCache: true,
    });
    expect(bypassed).toBeNull();
    expect(fakeRedis.del).not.toHaveBeenCalled();

    // 4. Redis Error
    fakeRedis.get.mockRejectedValueOnce(new Error("Redis timeout"));
    const errored = await cacheService.getHistoricalPrices("STOCK", "AAPL", "1d", 1000, 2000, 10);
    expect(errored).toBeNull();

    const rendered = registry.render();
    expect(rendered).toContain('cache_operations_total{outcome="hit",resource="historical_prices"} 1');
    expect(rendered).toContain('cache_operations_total{outcome="miss",resource="historical_prices"} 1');
    expect(rendered).toContain('cache_operations_total{outcome="bypass",resource="historical_prices"} 1');
    expect(rendered).toContain('cache_operations_total{outcome="error",resource="historical_prices"} 1');
  });

  test("records hit, miss, bypass, and error signals for market_search path", async () => {
    // 1. Hit
    fakeRedis.get.mockResolvedValueOnce(JSON.stringify([{ symbol: "AAPL" }]));
    const loader = jest.fn().mockResolvedValue([{ symbol: "AAPL" }]);
    const hit = await cacheService.getOrSetMarketSearch("AAPL", {}, loader);
    expect(hit).toEqual([{ symbol: "AAPL" }]);
    expect(loader).not.toHaveBeenCalled();

    // 2. Miss
    fakeRedis.get.mockResolvedValueOnce(null);
    fakeRedis.set.mockResolvedValueOnce("OK");
    const freshResults = [{ symbol: "MSFT" }];
    const loader2 = jest.fn().mockResolvedValue(freshResults);
    const miss = await cacheService.getOrSetMarketSearch("MSFT", {}, loader2);
    expect(miss).toEqual(freshResults);
    expect(loader2).toHaveBeenCalledTimes(1);

    // 3. Bypass
    const loader3 = jest.fn().mockResolvedValue([{ symbol: "GOOG" }]);
    const bypassed = await cacheService.getOrSetMarketSearch("GOOG", { skipCache: true }, loader3);
    expect(bypassed).toEqual([{ symbol: "GOOG" }]);
    expect(loader3).toHaveBeenCalledTimes(1);

    // 4. Redis Error - fail-open resilience
    fakeRedis.get.mockRejectedValueOnce(new Error("Connection reset"));
    const loader4 = jest.fn().mockResolvedValue([{ symbol: "TSLA" }]);
    const errored = await cacheService.getOrSetMarketSearch("TSLA", {}, loader4);
    expect(errored).toEqual([{ symbol: "TSLA" }]);
    expect(loader4).toHaveBeenCalledTimes(1);

    const rendered = registry.render();
    expect(rendered).toContain('cache_operations_total{outcome="hit",resource="market_search"} 1');
    expect(rendered).toContain('cache_operations_total{outcome="miss",resource="market_search"} 1');
    expect(rendered).toContain('cache_operations_total{outcome="bypass",resource="market_search"} 1');
    expect(rendered).toContain('cache_operations_total{outcome="error",resource="market_search"} 1');
  });

  test("records error signals when Redis operations fail", async () => {
    fakeRedis.get.mockRejectedValue(new Error("Connection refused"));

    const result = await cacheService.getPrice("STOCK", "AAPL");

    expect(result).toBeNull();

    const rendered = registry.render();
    expect(rendered).toContain('cache_operations_total{outcome="error",resource="price"} 1');

    expect(logger.warn).toHaveBeenCalledWith(
      "Redis cache operation failed",
      expect.objectContaining({
        message: "Connection refused",
      }),
    );
  });

  test("getSignals returns detailed metrics with hits, misses, bypasses, errors, and hitRate", async () => {
    fakeRedis.get
      .mockResolvedValueOnce("8")   // hits
      .mockResolvedValueOnce("2")   // misses
      .mockResolvedValueOnce("3")   // bypasses
      .mockResolvedValueOnce("1");  // errors

    const signals = await cacheService.getSignals();

    expect(signals).toEqual({
      hits: 8,
      misses: 2,
      bypasses: 3,
      errors: 1,
      total: 10,
      hitRate: 0.8,
    });
  });

  test("preserves low-cardinality labels and excludes sensitive payloads", () => {
    cacheService.recordCacheSignal({
      resource: "PRICE",
      outcome: "HIT",
      assetClass: "stock",
      reason: "test",
    });

    const rendered = registry.render();
    expect(rendered).toContain('cache_operations_total{outcome="hit",resource="price"} 1');
    // Ensure no high-cardinality or sensitive data in labels
    expect(rendered).not.toContain("AAPL");
    expect(rendered).not.toContain("password");
    expect(rendered).not.toContain("token");
  });
});
