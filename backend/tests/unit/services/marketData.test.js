jest.mock("dotenv", () => ({
  config: jest.fn(),
}));

jest.mock("../../../src/config/database", () => ({
  symbol: {
    findUnique: jest.fn().mockResolvedValue(null),
  },
}));

jest.mock("../../../src/config/marketDataConfig", () => ({
  DEFAULT_FRESHNESS_THRESHOLDS: {
    STOCK: 300,
    CRYPTO: 60,
    DEFAULT: 120,
  },
  DEFAULT_MAX_CLOCK_SKEW_SECONDS: 5,
  loadMarketDataConfig: jest.fn(() => ({
    providerByAssetClass: {
      STOCK: "stocks",
      CRYPTO: "crypto",
    },
    freshnessThresholds: {
      STOCK: 300,
      CRYPTO: 60,
      DEFAULT: 120,
    },
    maxClockSkewSeconds: 5,
  })),
}));

jest.mock("../../../src/providers/createMarketDataProviders", () => ({
  createMarketDataProviders: jest.fn(() => ({
    stocks: {},
    crypto: {},
  })),
}));

jest.mock("../../../src/services/marketDataService", () => ({
  createMarketDataService: jest.fn(),
}));

jest.mock("../../../src/services/cacheService", () => ({
  getOrSetPrice: jest.fn(),
  getOrSetMarketSearch: jest.fn(),
}));

const {
  createMarketDataService,
} = require("../../../src/services/marketDataService");
const cacheService = require("../../../src/services/cacheService");

const baseMarketDataService = {
  getQuote: jest.fn(),
  searchSymbols: jest.fn(),
};

createMarketDataService.mockReturnValue(baseMarketDataService);

const marketData = require("../../../src/services/marketData");

describe("marketData quote caching", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    createMarketDataService.mockReturnValue(baseMarketDataService);

    cacheService.getOrSetPrice.mockImplementation(
      (_assetClass, _symbol, loader) => loader(),
    );

    cacheService.getOrSetMarketSearch.mockImplementation(
      (_query, _options, loader) => loader(),
    );

    baseMarketDataService.getQuote.mockResolvedValue({
      symbol: "AAPL",
      assetClass: "STOCK",
      price: "250.10",
    });

    baseMarketDataService.searchSymbols.mockResolvedValue([
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
  });

  test("uses the STOCK cache namespace for stock quotes", async () => {
    await marketData.getQuote("aapl", {
      assetClass: "STOCK",
    });

    expect(cacheService.getOrSetPrice).toHaveBeenCalledWith(
      "STOCK",
      "AAPL",
      expect.any(Function),
    );
  });

  test("infers CRYPTO for crypto symbols", async () => {
    await marketData.getQuote("btcusdt");

    expect(cacheService.getOrSetPrice).toHaveBeenCalledWith(
      "CRYPTO",
      "BTCUSDT",
      expect.any(Function),
    );
  });

  test.each([
    { bypassCache: true },
    { skipCache: true },
    { noCache: true },
    { bypass: true },
  ])("forwards bypass flag when %j is passed", async (bypassOption) => {
    await marketData.getQuote("AAPL", bypassOption);

    expect(cacheService.getOrSetPrice).toHaveBeenCalledWith(
      "STOCK",
      "AAPL",
      expect.any(Function),
      expect.objectContaining({
        bypass: true,
        assetClass: "STOCK",
        ...bypassOption,
      }),
    );
  });

  test("passes pre-resolved metadata (_resolved) to avoid duplicate symbol resolution", async () => {
    await marketData.getQuote("AAPL");

    expect(baseMarketDataService.getQuote).toHaveBeenCalledWith(
      "AAPL",
      expect.objectContaining({
        assetClass: "STOCK",
        _resolved: expect.objectContaining({
          canonicalSymbol: "AAPL",
          assetClass: "STOCK",
        }),
      }),
    );
  });
});

describe("marketData quote freshness on cache hits", () => {
  let cacheStore;
  let currentTime;

  beforeEach(() => {
    jest.clearAllMocks();
    cacheStore = new Map();
    currentTime = 1793577600000; // Reference epoch ms

    createMarketDataService.mockReturnValue(baseMarketDataService);

    cacheService.getOrSetPrice.mockImplementation(
      async (assetClass, symbol, loader, options) => {
        const key = `${assetClass}:${symbol}`;
        if (!options?.bypass && cacheStore.has(key)) {
          return cacheStore.get(key);
        }
        const fresh = await loader();
        if (fresh) {
          cacheStore.set(key, fresh);
        }
        return fresh;
      },
    );
  });

  test("re-evaluates quote freshness, ageSeconds, isStale, rejectStale, and maxAgeSeconds on cache hits", async () => {
    // 1. Initial fetch and cache a fresh quote
    const initialTimestamp = new Date(currentTime - 10 * 1000).toISOString(); // 10s old
    baseMarketDataService.getQuote.mockResolvedValueOnce({
      symbol: "AAPL",
      assetClass: "STOCK",
      price: "150.00",
      timestamp: initialTimestamp,
      isStale: false,
      freshness: "FRESH",
      ageSeconds: 10,
    });

    const quote1 = await marketData.getQuote("AAPL", {
      now: () => currentTime,
    });
    expect(quote1.ageSeconds).toBe(10);
    expect(quote1.isStale).toBe(false);
    expect(quote1.freshness).toBe("FRESH");
    expect(baseMarketDataService.getQuote).toHaveBeenCalledTimes(1);

    // 2. Advance the reference clock until quote becomes stale (> 300s threshold for STOCK)
    currentTime += 400 * 1000; // 400 seconds later (total 410s old)

    // 3. Request the same quote without bypassing Redis
    const cachedQuote = await marketData.getQuote("AAPL", {
      now: () => currentTime,
    });

    // Verify cache hit: underlying provider was not invoked again
    expect(baseMarketDataService.getQuote).toHaveBeenCalledTimes(1);

    // Verify that ageSeconds is updated
    expect(cachedQuote.ageSeconds).toBe(410);

    // Verify that isStale and freshness are updated
    expect(cachedQuote.isStale).toBe(true);
    expect(cachedQuote.freshness).toBe("STALE");

    // 4. Verify that rejectStale=true rejects the cached quote
    await expect(
      marketData.getQuote("AAPL", {
        rejectStale: true,
        now: () => currentTime,
      }),
    ).rejects.toThrow("Market data quote is stale or delayed.");

    try {
      await marketData.getQuote("AAPL", {
        rejectStale: true,
        now: () => currentTime,
      });
    } catch (err) {
      expect(err.statusCode).toBe(503);
      expect(err.code).toBe("MARKET_DATA_STALE_QUOTE");
    }

    // 5. Verify that maxAgeSeconds is enforced on cache hits
    await expect(
      marketData.getQuote("AAPL", {
        maxAgeSeconds: 60,
        now: () => currentTime,
      }),
    ).rejects.toThrow("Market data quote is stale or delayed.");

    try {
      await marketData.getQuote("AAPL", {
        maxAgeSeconds: 60,
        now: () => currentTime,
      });
    } catch (err) {
      expect(err.statusCode).toBe(503);
      expect(err.code).toBe("MARKET_DATA_STALE_QUOTE");
    }
  });
});

describe("marketData symbol search caching", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    createMarketDataService.mockReturnValue(baseMarketDataService);

    cacheService.getOrSetMarketSearch.mockImplementation(
      (_query, _options, loader) => loader(),
    );

    baseMarketDataService.searchSymbols.mockResolvedValue([
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
  });

  test("delegates searchSymbols to cacheService.getOrSetMarketSearch", async () => {
    const results = await marketData.searchSymbols("apple", {
      assetClass: "STOCK",
      limit: 20,
    });

    expect(cacheService.getOrSetMarketSearch).toHaveBeenCalledWith(
      "apple",
      { assetClass: "STOCK", limit: 20 },
      expect.any(Function),
    );
    expect(baseMarketDataService.searchSymbols).toHaveBeenCalledWith("apple", {
      assetClass: "STOCK",
      limit: 20,
    });
    expect(results).toHaveLength(1);
    expect(results[0].symbol).toBe("AAPL");
  });

  test("delegates empty or non-string query directly to underlying service", async () => {
    baseMarketDataService.searchSymbols.mockImplementation(async () => {
      throw new Error("A symbol search query is required.");
    });

    await expect(marketData.searchSymbols("   ")).rejects.toThrow(
      "A symbol search query is required.",
    );
    expect(cacheService.getOrSetMarketSearch).not.toHaveBeenCalled();
    expect(baseMarketDataService.searchSymbols).toHaveBeenCalledWith("   ", {});
  });

  test("handles empty search results from provider", async () => {
    baseMarketDataService.searchSymbols.mockResolvedValue([]);

    const results = await marketData.searchSymbols("unknown");

    expect(cacheService.getOrSetMarketSearch).toHaveBeenCalledWith(
      "unknown",
      {},
      expect.any(Function),
    );
    expect(results).toEqual([]);
  });
});
