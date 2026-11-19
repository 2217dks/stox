jest.mock("../../../src/utils/logger", () => ({
  warn: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  error: jest.fn(),
}));

const {
  createMarketDataService,
} = require("../../../src/services/marketDataService");
const {
  createMarketDataProviders,
} = require("../../../src/providers/createMarketDataProviders");
const {
  createMarketDataError,
} = require("../../../src/providers/marketDataErrors");

const DAY = 24 * 60 * 60 * 1000;
const FROM = Date.parse("2026-11-01T00:00:00Z");
const TO = FROM + DAY;

function quote(symbol, assetClass, source) {
  return {
    symbol,
    assetClass,
    price: "100",
    change: "1",
    changePercent: "1",
    high: "101",
    low: "99",
    open: "99.5",
    previousClose: "99",
    volume: "10",
    currency: "USD",
    timestamp: "2026-11-02T00:00:00.000Z",
    source,
  };
}

function history(symbol, assetClass, interval, source) {
  return {
    symbol,
    assetClass,
    interval,
    source,
    prices: [
      {
        timestamp: "2026-11-01T00:00:00.000Z",
        open: "1",
        high: "2",
        low: "0.5",
        close: "1.5",
        volume: "10",
      },
    ],
  };
}

function overview(assetClass, source) {
  return {
    assetClass,
    asOf: "2026-11-02T00:00:00.000Z",
    marketStatus: { isOpen: true },
    movers: null,
    source,
  };
}

function searchResult(symbol, source) {
  return [
    {
      symbol,
      name: `${symbol} Inc.`,
      assetClass: "STOCK",
      exchange: "NASDAQ",
      currency: "USD",
      type: "Common Stock",
      source,
    },
  ];
}

function provider({
  id,
  assetClasses = ["STOCK"],
  operations,
  markets,
  getQuote,
  getHistoricalPrices,
  getMarketOverview,
  searchSymbols,
  toProviderSymbol,
} = {}) {
  return {
    id,
    assetClasses,
    operations,
    markets,
    ...(getQuote ? { getQuote } : {}),
    ...(getHistoricalPrices ? { getHistoricalPrices } : {}),
    ...(getMarketOverview ? { getMarketOverview } : {}),
    ...(searchSymbols ? { searchSymbols } : {}),
    ...(toProviderSymbol ? { toProviderSymbol } : {}),
  };
}

function buildService({ chain, providers, config = {} }) {
  return createMarketDataService({
    config: {
      providerChains: { STOCK: chain, CRYPTO: ["crypto"] },
      timeoutMs: 5000,
      ...config,
    },
    providers: {
      crypto: provider({
        id: "crypto",
        assetClasses: ["CRYPTO"],
        getQuote: async (symbol) => quote(symbol, "CRYPTO", "crypto"),
      }),
      ...providers,
    },
  });
}

describe("marketDataService provider fallback", () => {
  test("falls back to the next stock provider for a quote", async () => {
    const primary = provider({
      id: "primary",
      getQuote: jest
        .fn()
        .mockRejectedValue(
          createMarketDataError(
            "Market data provider is temporarily unavailable.",
            503,
            "MARKET_DATA_PROVIDER_UNAVAILABLE",
          ),
        ),
    });
    const fallback = provider({
      id: "fallback",
      getQuote: jest.fn(async (symbol) => quote(symbol, "STOCK", "fallback")),
    });
    const service = buildService({
      chain: ["primary", "fallback"],
      providers: { primary, fallback },
    });

    const result = await service.getQuote("AAPL");

    expect(primary.getQuote).toHaveBeenCalledWith("AAPL");
    expect(fallback.getQuote).toHaveBeenCalledWith("AAPL");
    expect(result.source).toBe("fallback");
  });

  test("does not call a fallback when the primary succeeds", async () => {
    const primary = provider({
      id: "primary",
      getQuote: jest.fn(async (symbol) => quote(symbol, "STOCK", "primary")),
    });
    const fallback = provider({
      id: "fallback",
      getQuote: jest.fn(async (symbol) => quote(symbol, "STOCK", "fallback")),
    });
    const service = buildService({
      chain: ["primary", "fallback"],
      providers: { primary, fallback },
    });

    const result = await service.getQuote("AAPL");

    expect(result.source).toBe("primary");
    expect(fallback.getQuote).not.toHaveBeenCalled();
  });

  test("does not fall back for a client-side request error", async () => {
    const primary = provider({
      id: "primary",
      getQuote: jest
        .fn()
        .mockRejectedValue(
          createMarketDataError(
            "The market data request is invalid.",
            400,
            "MARKET_DATA_INVALID_REQUEST",
          ),
        ),
    });
    const fallback = provider({
      id: "fallback",
      getQuote: jest.fn(async (symbol) => quote(symbol, "STOCK", "fallback")),
    });
    const service = buildService({
      chain: ["primary", "fallback"],
      providers: { primary, fallback },
    });

    await expect(service.getQuote("AAPL")).rejects.toMatchObject({
      code: "MARKET_DATA_INVALID_REQUEST",
    });
    expect(fallback.getQuote).not.toHaveBeenCalled();
  });

  test("throws the last provider error when every provider fails", async () => {
    const primary = provider({
      id: "primary",
      getQuote: jest
        .fn()
        .mockRejectedValue(
          createMarketDataError(
            "Market data provider is temporarily unavailable.",
            503,
            "MARKET_DATA_PROVIDER_UNAVAILABLE",
          ),
        ),
    });
    const fallback = provider({
      id: "fallback",
      getQuote: jest
        .fn()
        .mockRejectedValue(
          createMarketDataError(
            "Market data provider rate limit reached.",
            429,
            "MARKET_DATA_RATE_LIMITED",
          ),
        ),
    });
    const service = buildService({
      chain: ["primary", "fallback"],
      providers: { primary, fallback },
    });

    await expect(service.getQuote("AAPL")).rejects.toMatchObject({
      code: "MARKET_DATA_RATE_LIMITED",
      statusCode: 429,
    });
  });

  test("skips a provider that is absent from the registry", async () => {
    const fallback = provider({
      id: "fallback",
      getQuote: jest.fn(async (symbol) => quote(symbol, "STOCK", "fallback")),
    });
    const service = buildService({
      chain: ["missing", "fallback"],
      providers: { fallback },
    });

    const result = await service.getQuote("AAPL");

    expect(result.source).toBe("fallback");
  });

  test("skips a provider that does not support the requested operation", async () => {
    const historyOnly = provider({
      id: "history-only",
      operations: ["history"],
      getHistoricalPrices: jest.fn(async (symbol, options) =>
        history(symbol, "STOCK", options.interval, "history-only"),
      ),
    });
    const quoteProvider = provider({
      id: "quote-provider",
      getQuote: jest.fn(async (symbol) => quote(symbol, "STOCK", "quote")),
    });
    const service = buildService({
      chain: ["history-only", "quote-provider"],
      providers: {
        "history-only": historyOnly,
        "quote-provider": quoteProvider,
      },
    });

    const result = await service.getQuote("AAPL");

    expect(result.source).toBe("quote");
    expect(historyOnly.getHistoricalPrices).not.toHaveBeenCalled();
  });

  test("uses each adapter's own symbol translation during fallback", async () => {
    const primary = provider({
      id: "primary",
      getQuote: jest
        .fn()
        .mockRejectedValue(
          createMarketDataError(
            "Historical prices are unavailable for this symbol.",
            404,
            "MARKET_DATA_NOT_FOUND",
          ),
        ),
    });
    const fallback = provider({
      id: "fallback",
      getQuote: jest.fn(async (symbol) => quote(symbol, "STOCK", "fallback")),
      toProviderSymbol: jest.fn((symbol) => `FB:${symbol}`),
    });
    const service = buildService({
      chain: ["primary", "fallback"],
      providers: { primary, fallback },
    });

    await service.getQuote("AAPL");

    expect(fallback.toProviderSymbol).toHaveBeenCalledWith("AAPL", {
      assetClass: "STOCK",
    });
    expect(fallback.getQuote).toHaveBeenCalledWith("FB:AAPL");
  });

  test("skips providers that do not serve the symbol's market", async () => {
    const usOnly = provider({
      id: "us-only",
      markets: ["US"],
      getHistoricalPrices: jest.fn(async (symbol, options) =>
        history(symbol, "STOCK", options.interval, "us"),
      ),
    });
    const global = provider({
      id: "global",
      markets: ["*"],
      getHistoricalPrices: jest.fn(async (symbol, options) =>
        history(symbol, "STOCK", options.interval, "global"),
      ),
    });
    const service = buildService({
      chain: ["us-only", "global"],
      providers: { "us-only": usOnly, global },
    });

    const result = await service.getHistoricalPrices("VOD.L", {
      interval: "1d",
      from: FROM,
      to: TO,
    });

    expect(usOnly.getHistoricalPrices).not.toHaveBeenCalled();
    expect(global.getHistoricalPrices).toHaveBeenCalledWith("VOD.L", {
      interval: "1d",
      from: FROM,
      to: TO,
      limit: 500,
    });
    expect(result.prices).toHaveLength(1);
  });

  test("returns a safe error when no configured provider serves the market", async () => {
    const usOnly = provider({
      id: "us-only",
      markets: ["US"],
      getHistoricalPrices: jest.fn(),
    });
    const service = buildService({
      chain: ["us-only"],
      providers: { "us-only": usOnly },
    });

    await expect(
      service.getHistoricalPrices("VOD.L", {
        interval: "1d",
        from: FROM,
        to: TO,
      }),
    ).rejects.toMatchObject({
      statusCode: 503,
      code: "MARKET_DATA_PROVIDER_UNAVAILABLE",
    });
  });

  test("falls back for overview and search operations too", async () => {
    const primary = provider({
      id: "primary",
      getHistoricalPrices: jest.fn(),
      getMarketOverview: jest.fn(),
      searchSymbols: jest.fn(),
    });
    const fallback = provider({
      id: "fallback",
      getMarketOverview: jest.fn(async () => overview("STOCK", "fallback")),
      searchSymbols: jest.fn(async () => searchResult("AAPL", "fallback")),
    });
    const service = buildService({
      chain: ["primary", "fallback"],
      providers: { primary, fallback },
    });

    await expect(
      service.getMarketOverview({ assetClass: "STOCK" }),
    ).resolves.toMatchObject({ source: "fallback" });
    await expect(
      service.searchSymbols("aapl", { assetClass: "STOCK", limit: 5 }),
    ).resolves.toEqual([
      {
        symbol: "AAPL",
        name: "AAPL Inc.",
        assetClass: "STOCK",
        exchange: "NASDAQ",
        currency: "USD",
        type: "Common Stock",
        source: "fallback",
      },
    ]);
  });

  test("falls back when a provider returns a malformed normalized result", async () => {
    const primary = provider({
      id: "primary",
      getQuote: jest.fn(async () => ({ symbol: "AAPL", price: 100 })),
    });
    const fallback = provider({
      id: "fallback",
      getQuote: jest.fn(async (symbol) => quote(symbol, "STOCK", "fallback")),
    });
    const service = buildService({
      chain: ["primary", "fallback"],
      providers: { primary, fallback },
    });

    const result = await service.getQuote("AAPL");

    expect(result.source).toBe("fallback");
  });

  test("composes the real Finnhub and Yahoo adapters for a history fallback", async () => {
    const httpClient = {
      get: jest.fn().mockRejectedValue({
        response: {
          status: 403,
          data: { error: "You don't have access to this resource." },
        },
      }),
    };
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        chart: {
          result: [
            {
              timestamp: [Math.floor(FROM / 1000), Math.floor(TO / 1000)],
              indicators: {
                quote: [
                  {
                    open: [1, 2],
                    high: [2, 3],
                    low: [0.5, 1.5],
                    close: [1.5, 2.5],
                    volume: [10, 20],
                  },
                ],
              },
            },
          ],
        },
      }),
    });
    const providers = createMarketDataProviders(
      {
        timeoutMs: 5000,
        providers: {
          finnhub: { apiKey: "test-key", baseUrl: "https://finnhub.test" },
          yahoo: { baseUrl: "https://yahoo.test" },
        },
      },
      { httpClients: { finnhub: httpClient }, fetchImpl },
    );
    const service = createMarketDataService({
      config: {
        providerChains: { STOCK: ["finnhub", "yahoo"], CRYPTO: ["binance"] },
        timeoutMs: 5000,
      },
      providers,
    });

    const result = await service.getHistoricalPrices("AAPL", {
      interval: "1d",
      from: FROM,
      to: TO,
      _resolved: { canonicalSymbol: "AAPL", assetClass: "STOCK" },
    });

    expect(httpClient.get).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringContaining("yahoo.test/v8/finance/chart/AAPL"),
      expect.any(Object),
    );
    expect(result.assetClass).toBe("STOCK");
    expect(result.prices[1].close).toBe("2.5");
  });

  test("still supports the legacy single-provider configuration", async () => {
    const stock = provider({
      id: "stock",
      getQuote: jest.fn(async (symbol) => quote(symbol, "STOCK", "stock")),
    });
    const service = createMarketDataService({
      config: {
        providerByAssetClass: { STOCK: "stock", CRYPTO: "crypto" },
        timeoutMs: 5000,
      },
      providers: {
        stock,
        crypto: provider({
          id: "crypto",
          assetClasses: ["CRYPTO"],
          getQuote: async (symbol) => quote(symbol, "CRYPTO", "crypto"),
        }),
      },
    });

    await expect(service.getQuote("AAPL")).resolves.toMatchObject({
      source: "stock",
    });
  });
});
