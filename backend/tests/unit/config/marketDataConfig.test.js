const {
  DEFAULT_TIMEOUT_MS,
  loadMarketDataConfig,
} = require("../../../src/config/marketDataConfig");

describe("market data configuration", () => {
  test("uses documented provider defaults and safe timeout when unset", () => {
    const config = loadMarketDataConfig({});

    expect(config.providerByAssetClass).toEqual({
      STOCK: "finnhub",
      CRYPTO: "binance",
    });
    expect(config.timeoutMs).toBe(DEFAULT_TIMEOUT_MS);
    expect(config.providers.finnhub.apiKey).toBeNull();
    expect(config.providers.binance.baseUrl).toBe("https://api.binance.com");
  });

  test("reads explicit provider selection, credentials, URLs, and timeout", () => {
    const config = loadMarketDataConfig({
      MARKET_DATA_STOCK_PROVIDER: "custom-stock",
      MARKET_DATA_CRYPTO_PROVIDER: "custom-crypto",
      MARKET_DATA_REQUEST_TIMEOUT_MS: "2500",
      FINNHUB_API_KEY: "  test-key  ",
      FINNHUB_API_URL: "https://example.test/market",
      BINANCE_API_URL: "https://example.test/binance",
    });

    expect(config.providerByAssetClass).toEqual({
      STOCK: "custom-stock",
      CRYPTO: "custom-crypto",
    });
    expect(config.timeoutMs).toBe(2500);
    expect(config.providers.finnhub).toEqual({
      apiKey: "test-key",
      baseUrl: "https://example.test/market",
    });
    expect(config.providers.binance.baseUrl).toBe(
      "https://example.test/binance",
    );
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
