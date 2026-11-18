const mockInMemoryStore = new Map();

const mockRedis = {
  get: jest.fn(async (key) => mockInMemoryStore.get(key) ?? null),
  set: jest.fn(async (key, value, mode, duration) => {
    mockInMemoryStore.set(key, value);
    return "OK";
  }),
  del: jest.fn(async (...keys) => {
    let count = 0;
    for (const key of keys) {
      if (mockInMemoryStore.delete(key)) count += 1;
    }
    return count;
  }),
  incr: jest.fn(async () => 1),
};

jest.mock("../../src/config/redis", () => ({
  getRedis: jest.fn(async () => mockRedis),
  disconnectRedis: jest.fn(async () => {}),
}));

const mockStockSearch = jest.fn();
const mockCryptoSearch = jest.fn();

jest.mock("../../src/providers/createMarketDataProviders", () => ({
  createMarketDataProviders: jest.fn(() => ({
    finnhub: {
      id: "finnhub",
      assetClasses: ["STOCK"],
      getQuote: jest.fn(),
      getHistoricalPrices: jest.fn(),
      getMarketOverview: jest.fn(),
      searchSymbols: mockStockSearch,
    },
    binance: {
      id: "binance",
      assetClasses: ["CRYPTO"],
      getQuote: jest.fn(),
      getHistoricalPrices: jest.fn(),
      getMarketOverview: jest.fn(),
      searchSymbols: mockCryptoSearch,
    },
  })),
}));

const request = require("supertest");
const app = require("../../src/app");
const cacheService = require("../../src/services/cacheService");

describe("market symbol search Redis caching integration", () => {
  beforeEach(() => {
    mockInMemoryStore.clear();
    jest.clearAllMocks();

    mockStockSearch.mockResolvedValue([
      {
        symbol: "AAPL",
        name: "Apple Inc.",
        assetClass: "STOCK",
        exchange: "NASDAQ",
        currency: "USD",
        type: "Common Stock",
        source: "finnhub",
      },
    ]);

    mockCryptoSearch.mockResolvedValue([
      {
        symbol: "BINANCE:BTCUSDT",
        name: "BTC/USDT",
        assetClass: "CRYPTO",
        exchange: "BINANCE",
        currency: "USDT",
        type: "CRYPTO",
        source: "binance",
      },
    ]);
  });

  test("caches search results on first request and serves from cache on subsequent request", async () => {
    // 1. First request - Cache Miss
    const res1 = await request(app).get("/api/v1/market/search?query=apple&assetClass=STOCK&limit=10");

    expect(res1.status).toBe(200);
    expect(res1.body.success).toBe(true);
    expect(res1.body.data).toHaveLength(1);
    expect(res1.body.data[0].symbol).toBe("AAPL");
    expect(mockStockSearch).toHaveBeenCalledTimes(1);
    expect(mockStockSearch).toHaveBeenCalledWith("apple");

    const expectedCacheKey = "stox:v1:market:search:STOCK:APPLE:10";
    expect(mockRedis.set).toHaveBeenCalledWith(
      expectedCacheKey,
      JSON.stringify(res1.body.data),
      "EX",
      cacheService.TTL_SECONDS.symbolSearch,
    );

    // 2. Second request - Cache Hit
    const res2 = await request(app).get("/api/v1/market/search?query=apple&assetClass=STOCK&limit=10");

    expect(res2.status).toBe(200);
    expect(res2.body.data).toEqual(res1.body.data);
    // Provider was NOT called a second time
    expect(mockStockSearch).toHaveBeenCalledTimes(1);
  });

  test("normalizes query whitespace and casing to reuse identical cache entries", async () => {
    // Prime cache with lowercase "aapl"
    const res1 = await request(app).get("/api/v1/market/search?query=aapl&assetClass=STOCK");
    expect(res1.status).toBe(200);
    expect(mockStockSearch).toHaveBeenCalledTimes(1);

    // Request with uppercase and surrounding whitespace
    const res2 = await request(app).get("/api/v1/market/search?query=%20%20AAPL%20%20&assetClass=STOCK");
    expect(res2.status).toBe(200);
    expect(res2.body.data).toEqual(res1.body.data);
    // Provider should not be called again because cache key stox:v1:market:search:STOCK:AAPL:20 matched
    expect(mockStockSearch).toHaveBeenCalledTimes(1);
  });

  test("handles empty search results consistently by caching and returning empty array", async () => {
    mockStockSearch.mockResolvedValue([]);
    mockCryptoSearch.mockResolvedValue([]);

    // 1. Initial request - empty result from providers
    const res1 = await request(app).get("/api/v1/market/search?query=nosuchsymbol");

    expect(res1.status).toBe(200);
    expect(res1.body.success).toBe(true);
    expect(res1.body.data).toEqual([]);
    expect(mockStockSearch).toHaveBeenCalledTimes(1);
    expect(mockCryptoSearch).toHaveBeenCalledTimes(1);

    const emptyCacheKey = "stox:v1:market:search:ALL:NOSUCHSYMBOL:20";
    expect(mockRedis.set).toHaveBeenCalledWith(
      emptyCacheKey,
      JSON.stringify([]),
      "EX",
      cacheService.TTL_SECONDS.symbolSearch,
    );

    // 2. Subsequent request - served from cache
    const res2 = await request(app).get("/api/v1/market/search?query=nosuchsymbol");

    expect(res2.status).toBe(200);
    expect(res2.body.data).toEqual([]);
    expect(mockStockSearch).toHaveBeenCalledTimes(1);
    expect(mockCryptoSearch).toHaveBeenCalledTimes(1);
  });

  test("falls back safely to live provider search when Redis fails", async () => {
    mockRedis.get.mockRejectedValueOnce(new Error("Redis connection dropped"));

    const res = await request(app).get("/api/v1/market/search?query=apple&assetClass=STOCK");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data[0].symbol).toBe("AAPL");
    // Provider was invoked despite cache failure
    expect(mockStockSearch).toHaveBeenCalledTimes(1);
  });
});
