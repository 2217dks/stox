const {
  DEFAULT_TIMEOUT_MS,
  DEFAULT_MAX_CLOCK_SKEW_SECONDS,
  loadMarketDataConfig,
} = require("../../../src/config/marketDataConfig");

describe("market data configuration", () => {
  test("uses documented provider defaults and safe timeout when unset", () => {
    const config = loadMarketDataConfig({});

    expect(config.providerByAssetClass).toEqual({
      STOCK: "finnhub",
      CRYPTO: "binance",
    });
    expect(config.providerChains).toEqual({
      STOCK: ["finnhub", "yahoo"],
      CRYPTO: ["binance"],
    });
    expect(config.timeoutMs).toBe(DEFAULT_TIMEOUT_MS);
    expect(config.maxClockSkewSeconds).toBe(DEFAULT_MAX_CLOCK_SKEW_SECONDS);
    expect(config.providers.finnhub.apiKey).toBeNull();
    expect(config.providers.binance.baseUrl).toBe("https://api.binance.com");
    expect(config.providers.yahoo.baseUrl).toBe(
      "https://query1.finance.yahoo.com",
    );
  });

  test("reads explicit provider selection, credentials, URLs, timeout, and clock skew", () => {
    const config = loadMarketDataConfig({
      MARKET_DATA_STOCK_PROVIDER: "custom-stock",
      MARKET_DATA_CRYPTO_PROVIDER: "custom-crypto",
      MARKET_DATA_REQUEST_TIMEOUT_MS: "2500",
      MARKET_DATA_MAX_CLOCK_SKEW_SECONDS: "10",
      FINNHUB_API_KEY: "  test-key  ",
      FINNHUB_API_URL: "https://example.test/market",
      BINANCE_API_URL: "https://example.test/binance",
      YAHOO_FINANCE_API_URL: "https://example.test/yahoo",
    });

    expect(config.providerByAssetClass).toEqual({
      STOCK: "custom-stock",
      CRYPTO: "custom-crypto",
    });
    expect(config.providerChains).toEqual({
      STOCK: ["custom-stock", "finnhub", "yahoo"],
      CRYPTO: ["custom-crypto", "binance"],
    });
    expect(config.timeoutMs).toBe(2500);
    expect(config.maxClockSkewSeconds).toBe(10);
    expect(config.providers.finnhub).toEqual({
      apiKey: "test-key",
      baseUrl: "https://example.test/market",
    });
    expect(config.providers.binance.baseUrl).toBe(
      "https://example.test/binance",
    );
    expect(config.providers.yahoo.baseUrl).toBe("https://example.test/yahoo");
  });

  test("reads an ordered fallback chain and keeps the first provider primary", () => {
    const config = loadMarketDataConfig({
      MARKET_DATA_STOCK_PROVIDERS: " Alpaca, yahoo , alpaca, ",
      MARKET_DATA_CRYPTO_PROVIDER: "binance",
    });

    expect(config.providerChains.STOCK).toEqual(["alpaca", "yahoo"]);
    expect(config.providerByAssetClass.STOCK).toBe("alpaca");
  });

  test("uses the chain variable instead of the legacy primary when both are set", () => {
    const config = loadMarketDataConfig({
      MARKET_DATA_STOCK_PROVIDER: "finnhub",
      MARKET_DATA_STOCK_PROVIDERS: "yahoo,finnhub",
    });

    expect(config.providerChains.STOCK).toEqual(["yahoo", "finnhub"]);
    expect(config.providerByAssetClass.STOCK).toBe("yahoo");
  });

  test.each(["", "   ", ",", " , "])("rejects an empty provider chain %j", (value) => {
    expect(() =>
      loadMarketDataConfig({ MARKET_DATA_STOCK_PROVIDERS: value }),
    ).toThrow("MARKET_DATA_STOCK_PROVIDERS must list at least one");
  });

  test.each(["", "   "])("rejects an empty legacy primary provider %j", (value) => {
    expect(() =>
      loadMarketDataConfig({ MARKET_DATA_STOCK_PROVIDER: value }),
    ).toThrow("MARKET_DATA_STOCK_PROVIDER must name a market-data provider.");
  });

  test("rejects invalid timeout configuration", () => {
    expect(() =>
      loadMarketDataConfig({ MARKET_DATA_REQUEST_TIMEOUT_MS: "abc" }),
    ).toThrow("MARKET_DATA_REQUEST_TIMEOUT_MS must be an integer");
    expect(() =>
      loadMarketDataConfig({ MARKET_DATA_REQUEST_TIMEOUT_MS: "5" }),
    ).toThrow("MARKET_DATA_REQUEST_TIMEOUT_MS must be an integer");
  });
});
