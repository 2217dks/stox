const {
  createMarketDataProviders,
  getMarketDataProviderDefinition,
  listMarketDataProviderIds,
} = require("../../../src/providers/createMarketDataProviders");

describe("market-data provider registry", () => {
  test("registers the built-in providers", () => {
    expect(listMarketDataProviderIds()).toEqual([
      "finnhub",
      "binance",
      "yahoo",
    ]);
  });

  test("creates every registered adapter with its metadata and configuration", () => {
    const providers = createMarketDataProviders({
      timeoutMs: 2500,
      providers: {
        finnhub: {
          apiKey: "test-key",
          baseUrl: "https://finnhub.example.test",
        },
        binance: { baseUrl: "https://binance.example.test" },
        yahoo: { baseUrl: "https://yahoo.example.test" },
      },
    });

    expect(providers.finnhub).toMatchObject({
      id: "finnhub",
      assetClasses: ["STOCK"],
      operations: ["quote", "history", "overview", "search"],
      markets: ["US"],
    });
    expect(providers.binance).toMatchObject({
      id: "binance",
      assetClasses: ["CRYPTO"],
      operations: ["quote", "history", "overview", "search"],
      markets: ["GLOBAL"],
    });
    expect(providers.yahoo).toMatchObject({
      id: "yahoo",
      assetClasses: ["STOCK"],
      operations: ["history"],
      markets: ["*"],
    });
  });

  test("exposes one factory entry per provider so adding one is a single registration", () => {
    expect(getMarketDataProviderDefinition("yahoo")).toEqual(
      expect.objectContaining({ create: expect.any(Function) }),
    );
    expect(getMarketDataProviderDefinition("missing")).toBeNull();
  });
});
