const { AppError } = require("../../../src/utils/errors");
const {
  createMarketDataService,
} = require("../../../src/services/marketDataService");

const CONFIG = {
  providerByAssetClass: { STOCK: "stocks", CRYPTO: "crypto" },
  timeoutMs: 5000,
};

const quote = (symbol, assetClass, source = "mock") => ({
  symbol,
  assetClass,
  price: "123.45",
  change: "1.2",
  changePercent: "0.98",
  high: "125.00",
  low: "120.00",
  open: "121.00",
  previousClose: "122.25",
  volume: "1000",
  currency: "USD",
  timestamp: "2026-11-02T00:00:00.000Z",
  source,
});

function createProvider(overrides = {}) {
  return {
    getQuote: jest.fn(async (symbol) => quote(symbol, "STOCK")),
    getHistoricalPrices: jest.fn(async (symbol, options) => ({
      symbol,
      assetClass: "STOCK",
      interval: options.interval,
      prices: [
        {
          timestamp: "2026-11-01T00:00:00.000Z",
          open: "1.00",
          high: "2.00",
          low: "0.50",
          close: "1.50",
          volume: "10",
        },
      ],
    })),
    getMarketOverview: jest.fn(async () => ({
      assetClass: "STOCK",
      asOf: "2026-11-02T00:00:00.000Z",
      marketStatus: { isOpen: true },
      movers: [],
      source: "mock",
    })),
    searchSymbols: jest.fn(async () => [
      {
        symbol: "AAPL",
        name: "Apple Inc.",
        assetClass: "STOCK",
        exchange: "NASDAQ",
        currency: "USD",
        type: "Common Stock",
        source: "mock",
      },
    ]),
    ...overrides,
  };
}

function createService({
  stockProvider,
  cryptoProvider,
  config = CONFIG,
} = {}) {
  return createMarketDataService({
    config,
    providers: {
      stocks: stockProvider || createProvider(),
      crypto:
        cryptoProvider ||
        createProvider({
          getQuote: jest.fn(async (symbol) =>
            quote(`BINANCE:${symbol.replace(/^BINANCE:/, "")}`, "CRYPTO"),
          ),
          getHistoricalPrices: jest.fn(async (symbol, options) => ({
            symbol: `BINANCE:${symbol.replace(/^BINANCE:/, "")}`,
            assetClass: "CRYPTO",
            interval: options.interval,
            prices: [],
          })),
          getMarketOverview: jest.fn(async () => ({
            assetClass: "CRYPTO",
            asOf: "2026-11-02T00:00:00.000Z",
            marketStatus: { isOpen: true, session: "24/7" },
            movers: [],
            source: "mock",
          })),
          searchSymbols: jest.fn(async () => [
            {
              symbol: "BINANCE:BTCUSDT",
              name: "BTC/USDT",
              assetClass: "CRYPTO",
              exchange: "BINANCE",
              currency: "USDT",
              type: "CRYPTO",
              source: "mock",
            },
          ]),
        }),
    },
  });
}

describe("marketDataService provider-independent interface", () => {
  test("gets a normalized quote from the selected adapter", async () => {
    const stockProvider = createProvider();
    const service = createService({ stockProvider });

    const result = await service.getQuote("aapl");

    expect(result.price).toBe("123.45");
    expect(result.symbol).toBe("AAPL");
    expect(result.assetClass).toBe("STOCK");
    expect(stockProvider.getQuote).toHaveBeenCalledWith("AAPL");
  });

  test("gets OHLCV history with validated inputs", async () => {
    const stockProvider = createProvider();
    const service = createService({ stockProvider });

    const result = await service.getHistoricalPrices("AAPL", {
      interval: "1d",
      from: 1793491200000,
      to: 1793577600000,
    });

    expect(result.prices[0].close).toBe("1.50");
    expect(stockProvider.getHistoricalPrices).toHaveBeenCalledWith("AAPL", {
      interval: "1d",
      from: 1793491200000,
      to: 1793577600000,
      limit: 500,
    });
  });

  test("gets a normalized market overview", async () => {
    const stockProvider = createProvider();
    const service = createService({ stockProvider });

    const result = await service.getMarketOverview({ assetClass: "STOCK" });

    expect(result.marketStatus.isOpen).toBe(true);
    expect(stockProvider.getMarketOverview).toHaveBeenCalledWith({
      assetClass: "STOCK",
      limit: 10,
    });
  });

  test("searches configured asset classes and combines normalized results", async () => {
    const service = createService();

    const result = await service.searchSymbols("btc");

    expect(result.map((item) => item.assetClass)).toEqual(["STOCK", "CRYPTO"]);
    expect(result[1].symbol).toBe("BINANCE:BTCUSDT");
  });

  test("returns a predictable error when a selected provider is not configured", async () => {
    const service = createMarketDataService({
      config: { providerByAssetClass: { STOCK: "missing", CRYPTO: "crypto" } },
      providers: { crypto: createProvider() },
    });

    await expect(service.getQuote("AAPL")).rejects.toMatchObject({
      statusCode: 503,
      code: "MARKET_DATA_PROVIDER_UNAVAILABLE",
    });
  });

  test("normalizes provider timeout errors", async () => {
    const provider = createProvider({
      getQuote: jest.fn().mockRejectedValue(
        Object.assign(new Error("timeout of 5000ms exceeded"), {
          code: "ECONNABORTED",
        }),
      ),
    });
    const service = createService({ stockProvider: provider });

    await expect(service.getQuote("AAPL")).rejects.toMatchObject({
      statusCode: 504,
      code: "MARKET_DATA_TIMEOUT",
    });
  });

  test("normalizes provider rate limits", async () => {
    const provider = createProvider({
      getQuote: jest.fn().mockRejectedValue({ response: { status: 429 } }),
    });
    const service = createService({ stockProvider: provider });

    await expect(service.getQuote("AAPL")).rejects.toMatchObject({
      statusCode: 429,
      code: "MARKET_DATA_RATE_LIMITED",
    });
  });

  test("normalizes network failures without exposing provider details", async () => {
    const provider = createProvider({
      getQuote: jest
        .fn()
        .mockRejectedValue(new Error("socket failure with secret")),
    });
    const service = createService({ stockProvider: provider });

    await expect(service.getQuote("AAPL")).rejects.toMatchObject({
      statusCode: 503,
      code: "MARKET_DATA_PROVIDER_UNAVAILABLE",
      message: "Market data provider is temporarily unavailable.",
    });
  });

  test("rejects malformed normalized provider results", async () => {
    const provider = createProvider({
      getQuote: jest.fn().mockResolvedValue({ symbol: "AAPL", price: 123 }),
    });
    const service = createService({ stockProvider: provider });

    await expect(service.getQuote("AAPL")).rejects.toMatchObject({
      statusCode: 502,
      code: "MARKET_DATA_INVALID_RESPONSE",
    });
  });

  test("swaps providers by configuration without changing the service interface", async () => {
    const alternative = createProvider({
      id: "alternative",
      getQuote: jest.fn(async (symbol) =>
        quote(symbol, "STOCK", "alternative"),
      ),
    });
    const service = createMarketDataService({
      config: {
        providerByAssetClass: { STOCK: "alternative", CRYPTO: "crypto" },
      },
      providers: { alternative, crypto: createProvider() },
    });

    const result = await service.getQuote("MSFT");

    expect(result.source).toBe("alternative");
    expect(alternative.getQuote).toHaveBeenCalledWith("MSFT");
  });

  test("rejects invalid historical arguments before contacting a provider", async () => {
    const stockProvider = createProvider();
    const service = createService({ stockProvider });

    await expect(
      service.getHistoricalPrices("AAPL", {
        interval: "invalid",
        from: 1,
        to: 2,
      }),
    ).rejects.toMatchObject({ code: "MARKET_DATA_INVALID_REQUEST" });
    expect(stockProvider.getHistoricalPrices).not.toHaveBeenCalled();
  });
});
