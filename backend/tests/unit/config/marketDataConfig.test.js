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
      MARKET_DATA_STOCK_PROVIDER: "yahoo",
      MARKET_DATA_CRYPTO_PROVIDER: "binance",
      MARKET_DATA_REQUEST_TIMEOUT_MS: "2500",
      MARKET_DATA_MAX_CLOCK_SKEW_SECONDS: "10",
      FINNHUB_API_KEY: "  test-key  ",
      FINNHUB_API_URL: "https://example.test/market",
      BINANCE_API_URL: "https://example.test/binance",
      YAHOO_FINANCE_API_URL: "https://example.test/yahoo",
    });

    expect(config.providerByAssetClass).toEqual({
      STOCK: "yahoo",
      CRYPTO: "binance",
    });
    expect(config.providerChains).toEqual({
      STOCK: ["yahoo", "finnhub"],
      CRYPTO: ["binance"],
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
      MARKET_DATA_STOCK_PROVIDERS: " yahoo, finnhub , yahoo, ",
      MARKET_DATA_CRYPTO_PROVIDER: "binance",
    });

    expect(config.providerChains.STOCK).toEqual(["yahoo", "finnhub"]);
    expect(config.providerByAssetClass.STOCK).toBe("yahoo");
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

  test("rejects unknown provider in chain configuration", () => {
    expect(() =>
      loadMarketDataConfig({
        MARKET_DATA_STOCK_PROVIDERS: "finnhub,unknown_provider",
      }),
    ).toThrow("Unknown market data provider 'unknown_provider' configured in MARKET_DATA_STOCK_PROVIDERS");

    expect(() =>
      loadMarketDataConfig({
        MARKET_DATA_CRYPTO_PROVIDERS: "fake_crypto",
      }),
    ).toThrow("Unknown market data provider 'fake_crypto' configured in MARKET_DATA_CRYPTO_PROVIDERS");
  });

  test("rejects unknown legacy primary provider", () => {
    expect(() =>
      loadMarketDataConfig({
        MARKET_DATA_STOCK_PROVIDER: "not_a_provider",
      }),
    ).toThrow("Unknown market data provider 'not_a_provider' configured in MARKET_DATA_STOCK_PROVIDER");

    expect(() =>
      loadMarketDataConfig({
        MARKET_DATA_CRYPTO_PROVIDER: "not_a_crypto_provider",
      }),
    ).toThrow("Unknown market data provider 'not_a_crypto_provider' configured in MARKET_DATA_CRYPTO_PROVIDER");
  });
});
