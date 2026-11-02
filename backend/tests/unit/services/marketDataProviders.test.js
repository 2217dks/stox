const {
  createFinnhubMarketDataProvider,
} = require("../../../src/providers/finnhubMarketDataProvider");
const {
  createBinanceMarketDataProvider,
} = require("../../../src/providers/binanceMarketDataProvider");

function fakeClient(data) {
  return { get: jest.fn().mockResolvedValue({ data }) };
}

describe("market-data provider adapters", () => {
  test("normalizes a Finnhub quote to decimal-string fields", async () => {
    const client = fakeClient({
      c: 123.45,
      d: 1.2,
      dp: 0.98,
      h: 125,
      l: 120,
      o: 121,
      pc: 122.25,
      t: 1793577600,
    });
    const provider = createFinnhubMarketDataProvider(
      { apiKey: "test-key", timeoutMs: 5000 },
      { httpClient: client },
    );

    const quote = await provider.getQuote("AAPL");

    expect(quote).toMatchObject({
      symbol: "AAPL",
      assetClass: "STOCK",
      price: "123.45",
      previousClose: "122.25",
      source: "finnhub",
    });
    expect(client.get).toHaveBeenCalledWith("/quote", {
      params: { symbol: "AAPL" },
    });
  });

  test("normalizes Finnhub historical candles", async () => {
    const client = fakeClient({
      s: "ok",
      t: [1793491200],
      o: [1],
      h: [2],
      l: [0.5],
      c: [1.5],
      v: [10],
    });
    const provider = createFinnhubMarketDataProvider(
      { apiKey: "test-key", timeoutMs: 5000 },
      { httpClient: client },
    );

    const history = await provider.getHistoricalPrices("AAPL", {
      interval: "1d",
      from: 1793491200000,
      to: 1793577600000,
    });

    expect(history.prices[0]).toMatchObject({
      open: "1",
      high: "2",
      low: "0.5",
      close: "1.5",
      volume: "10",
    });
    expect(client.get).toHaveBeenCalledWith("/stock/candle", {
      params: {
        symbol: "AAPL",
        resolution: "D",
        from: 1793491200,
        to: 1793577600,
      },
    });
  });

  test("normalizes Finnhub overview and symbol search", async () => {
    const client = {
      get: jest
        .fn()
        .mockResolvedValueOnce({
          data: {
            exchange: "US",
            isOpen: true,
            session: "regular",
            timezone: "America/New_York",
          },
        })
        .mockResolvedValueOnce({
          data: {
            result: [
              {
                symbol: "AAPL",
                displaySymbol: "AAPL",
                description: "Apple Inc.",
                type: "Common Stock",
              },
            ],
          },
        }),
    };
    const provider = createFinnhubMarketDataProvider(
      { apiKey: "test-key", timeoutMs: 5000 },
      { httpClient: client },
    );

    const overview = await provider.getMarketOverview();
    const symbols = await provider.searchSymbols("apple");

    expect(overview.marketStatus).toMatchObject({
      isOpen: true,
      exchange: "US",
    });
    expect(symbols[0]).toMatchObject({
      symbol: "AAPL",
      name: "Apple Inc.",
      assetClass: "STOCK",
    });
  });

  test("normalizes Binance quote and historical candles", async () => {
    const client = {
      get: jest
        .fn()
        .mockResolvedValueOnce({
          data: {
            symbol: "BTCUSDT",
            lastPrice: "100.12",
            priceChange: "2.00",
            priceChangePercent: "2.03",
            highPrice: "101.00",
            lowPrice: "98.00",
            openPrice: "98.12",
            prevClosePrice: "98.12",
            volume: "1000",
            closeTime: 1793577600000,
          },
        })
        .mockResolvedValueOnce({
          data: [[1793491200000, "1", "2", "0.5", "1.5", "10"]],
        }),
    };
    const provider = createBinanceMarketDataProvider(
      { baseUrl: "https://api.binance.com", timeoutMs: 5000 },
      { httpClient: client },
    );

    const quote = await provider.getQuote("BINANCE:BTCUSDT");
    const history = await provider.getHistoricalPrices("BTCUSDT", {
      interval: "1d",
      from: 1793491200000,
      to: 1793577600000,
    });

    expect(quote).toMatchObject({
      symbol: "BINANCE:BTCUSDT",
      assetClass: "CRYPTO",
      price: "100.12",
      currency: "USDT",
      source: "binance",
    });
    expect(history.prices[0].close).toBe("1.5");
    expect(client.get).toHaveBeenNthCalledWith(1, "/api/v3/ticker/24hr", {
      params: { symbol: "BTCUSDT" },
    });
  });

  test("normalizes Binance overview and symbol search", async () => {
    const client = {
      get: jest
        .fn()
        .mockResolvedValueOnce({
          data: [
            {
              symbol: "BTCUSDT",
              lastPrice: "10",
              priceChangePercent: "5",
              quoteVolume: "100",
            },
            {
              symbol: "ETHUSDT",
              lastPrice: "5",
              priceChangePercent: "2",
              quoteVolume: "50",
            },
          ],
        })
        .mockResolvedValueOnce({
          data: {
            symbols: [
              {
                symbol: "BTCUSDT",
                status: "TRADING",
                baseAsset: "BTC",
                quoteAsset: "USDT",
              },
              {
                symbol: "BTCOLDUSDT",
                status: "BREAK",
                baseAsset: "BTCOLD",
                quoteAsset: "USDT",
              },
            ],
          },
        }),
    };
    const provider = createBinanceMarketDataProvider(
      { baseUrl: "https://api.binance.com", timeoutMs: 5000 },
      { httpClient: client },
    );

    const overview = await provider.getMarketOverview({ limit: 1 });
    const symbols = await provider.searchSymbols("BTC");

    expect(overview.movers).toHaveLength(1);
    expect(overview.movers[0].symbol).toBe("BINANCE:BTCUSDT");
    expect(symbols).toHaveLength(1);
    expect(symbols[0]).toMatchObject({
      symbol: "BINANCE:BTCUSDT",
      name: "BTC/USDT",
    });
  });

  test("returns a domain error when Finnhub credentials are missing", async () => {
    const provider = createFinnhubMarketDataProvider({ timeoutMs: 5000 });

    await expect(provider.getQuote("AAPL")).rejects.toMatchObject({
      statusCode: 503,
      code: "MARKET_DATA_NOT_CONFIGURED",
    });
  });

  test("maps rate limits and malformed provider responses", async () => {
    const rateLimited = createFinnhubMarketDataProvider(
      { apiKey: "test-key", timeoutMs: 5000 },
      {
        httpClient: {
          get: jest.fn().mockRejectedValue({ response: { status: 429 } }),
        },
      },
    );
    const malformed = createFinnhubMarketDataProvider(
      { apiKey: "test-key", timeoutMs: 5000 },
      { httpClient: fakeClient({ c: "bad" }) },
    );

    await expect(rateLimited.getQuote("AAPL")).rejects.toMatchObject({
      statusCode: 429,
      code: "MARKET_DATA_RATE_LIMITED",
    });
    await expect(malformed.getQuote("AAPL")).rejects.toMatchObject({
      statusCode: 502,
      code: "MARKET_DATA_INVALID_RESPONSE",
    });
  });
});
