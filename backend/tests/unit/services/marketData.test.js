jest.mock("dotenv", () => ({
  config: jest.fn(),
}));

jest.mock("../../../src/config/database", () => ({
  symbol: {
    findUnique: jest.fn().mockResolvedValue(null),
  },
}));

jest.mock("../../../src/config/marketDataConfig", () => ({
  loadMarketDataConfig: jest.fn(() => ({
    providerByAssetClass: {
      STOCK: "stocks",
      CRYPTO: "crypto",
    },
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
