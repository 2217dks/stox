const {
  createFinnhubMarketDataProvider,
} = require("../../../src/providers/finnhubMarketDataProvider");
const {
  createBinanceMarketDataProvider,
} = require("../../../src/providers/binanceMarketDataProvider");

function fakeClient(data) {
  return { get: jest.fn().mockResolvedValue({ data }) };
}

function finnhubQuoteResponse(overrides = {}) {
  return {
    c: 123.45,
    d: 1.2,
    dp: 0.98,
    h: 125,
    l: 120,
    o: 121,
    pc: 122.25,
    t: 1793577600,
    ...overrides,
  };
}

function binanceQuoteResponse(overrides = {}) {
  return {
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
    ...overrides,
  };
}

describe("market-data provider adapters", () => {
  test("normalizes a Finnhub quote to decimal-string fields", async () => {
    const client = fakeClient(finnhubQuoteResponse());
    const provider = createFinnhubMarketDataProvider(
      { apiKey: "test-key", timeoutMs: 5000 },
      { httpClient: client },
    );

    const quote = await provider.getQuote("AAPL");

    expect(quote).toMatchObject({
      symbol: "AAPL",
      assetClass: "STOCK",
      price: "123.45",
      change: "1.2",
      changePercent: "0.98",
      high: "125",
      low: "120",
      open: "121",
      previousClose: "122.25",
      volume: null,
      currency: "USD",
      timestamp: "2026-11-02T00:00:00.000Z",
      source: "finnhub",
    });
    expect(client.get).toHaveBeenCalledWith("/quote", {
      params: { symbol: "AAPL" },
    });
  });

  test("maps omitted Finnhub quote details to explicit nulls", async () => {
    const provider = createFinnhubMarketDataProvider(
      { apiKey: "test-key", timeoutMs: 5000 },
      { httpClient: fakeClient({ c: 10, t: 1793577600 }) },
    );

    await expect(provider.getQuote("AAPL")).resolves.toMatchObject({
      price: "10",
      change: null,
      changePercent: null,
      high: null,
      low: null,
      open: null,
      previousClose: null,
      volume: null,
      timestamp: "2026-11-02T00:00:00.000Z",
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
          data: binanceQuoteResponse(),
        })
        .mockResolvedValueOnce({
          data: [[1793491200000, "1", "2", "0.5", "1.5", "10"]],
        }),
    };
    const provider = createBinanceMarketDataProvider(
      { baseUrl: "https://api.binance.com", timeoutMs: 5000 },
      { httpClient: client },
    );

    const quote = await provider.getQuote("BTCUSDT");
    const history = await provider.getHistoricalPrices("BTCUSDT", {
      interval: "1d",
      from: 1793491200000,
      to: 1793577600000,
    });

    expect(quote).toMatchObject({
      symbol: "BINANCE:BTCUSDT",
      assetClass: "CRYPTO",
      price: "100.12",
      change: "2",
      changePercent: "2.03",
      high: "101",
      low: "98",
      open: "98.12",
      previousClose: "98.12",
      volume: "1000",
      currency: "USDT",
      timestamp: "2026-11-02T00:00:00.000Z",
      source: "binance",
    });
    expect(history.prices[0].close).toBe("1.5");
    expect(client.get).toHaveBeenNthCalledWith(1, "/api/v3/ticker/24hr", {
      params: { symbol: "BTCUSDT" },
    });
  });

  test("Finnhub and Binance quotes share one canonical DTO shape", async () => {
    const stockProvider = createFinnhubMarketDataProvider(
      { apiKey: "test-key", timeoutMs: 5000 },
      {
        httpClient: fakeClient(
          finnhubQuoteResponse({
            c: 100.12,
            d: 2,
            dp: 2.03,
            h: 101,
            l: 98,
            o: 98.12,
            pc: 98.12,
          }),
        ),
      },
    );
    const cryptoProvider = createBinanceMarketDataProvider(
      { baseUrl: "https://api.binance.com", timeoutMs: 5000 },
      {
        httpClient: fakeClient(
          binanceQuoteResponse({
            lastPrice: "100.1200",
            priceChange: "2.00",
            priceChangePercent: "2.0300",
            highPrice: "101.000",
            lowPrice: "98.00",
            openPrice: "98.1200",
            prevClosePrice: "98.12",
          }),
        ),
      },
    );

    const stockQuote = await stockProvider.getQuote("AAPL");
    const cryptoQuote = await cryptoProvider.getQuote("BTCUSDT");

    expect(Object.keys(stockQuote).sort()).toEqual(
      Object.keys(cryptoQuote).sort(),
    );
    for (const field of [
      "price",
      "change",
      "changePercent",
      "high",
      "low",
      "open",
      "previousClose",
      "timestamp",
    ]) {
      expect(stockQuote[field]).toBe(cryptoQuote[field]);
    }
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
    const provider = createFinnhubMarketDataProvider();

    await expect(provider.getQuote("AAPL")).rejects.toMatchObject({
      statusCode: 503,
      code: "MARKET_DATA_NOT_CONFIGURED",
    });
  });

  test("maps Finnhub's empty quote response to a safe invalid-symbol error", async () => {
    const provider = createFinnhubMarketDataProvider(
      { apiKey: "test-key", timeoutMs: 5000 },
      {
        httpClient: fakeClient({
          c: 0,
          d: 0,
          dp: 0,
          h: 0,
          l: 0,
          o: 0,
          pc: 0,
          t: 0,
        }),
      },
    );

    await expect(provider.getQuote("NOT_A_SYMBOL")).rejects.toMatchObject({
      statusCode: 404,
      code: "MARKET_DATA_NOT_FOUND",
      message: "Market data is unavailable for the requested symbol.",
    });
  });

  test.each([401, 403])(
    "maps Finnhub HTTP %i authentication failures without exposing credentials or provider details",
    async (status) => {
      const apiKey = "test-finnhub-secret";
      const provider = createFinnhubMarketDataProvider(
        { apiKey, timeoutMs: 5000 },
        {
          httpClient: {
            get: jest.fn().mockRejectedValue({
              response: {
                status,
                data: { error: `invalid token ${apiKey}` },
              },
            }),
          },
        },
      );

      await expect(provider.getQuote("AAPL")).rejects.toMatchObject({
        statusCode: 503,
        code: "MARKET_DATA_INVALID_CREDENTIALS",
        message: "Market data provider credentials are invalid or unavailable.",
      });
    },
  );

  test.each([
    [
      "rate limit",
      { response: { status: 429 } },
      429,
      "MARKET_DATA_RATE_LIMITED",
    ],
    [
      "request timeout",
      { code: "ECONNABORTED", message: "timeout" },
      504,
      "MARKET_DATA_TIMEOUT",
    ],
    [
      "network failure",
      { code: "ECONNREFUSED" },
      503,
      "MARKET_DATA_PROVIDER_UNAVAILABLE",
    ],
  ])(
    "maps Finnhub %s to the standard safe error",
    async (_label, error, statusCode, code) => {
      const provider = createFinnhubMarketDataProvider(
        { apiKey: "test-key", timeoutMs: 5000 },
        { httpClient: { get: jest.fn().mockRejectedValue(error) } },
      );

      await expect(provider.getQuote("AAPL")).rejects.toMatchObject({
        statusCode,
        code,
      });
    },
  );

  test.each([
    ["non-object body", "not-json"],
    ["missing current price", {}],
    ["null quote values", { c: null, t: null }],
    ["invalid current price", finnhubQuoteResponse({ c: "bad" })],
    ["invalid change field", finnhubQuoteResponse({ d: "NaN" })],
  ])("rejects a Finnhub quote with %s", async (_label, data) => {
    const provider = createFinnhubMarketDataProvider(
      { apiKey: "test-key", timeoutMs: 5000 },
      { httpClient: fakeClient(data) },
    );

    await expect(provider.getQuote("AAPL")).rejects.toMatchObject({
      statusCode: 502,
      code: "MARKET_DATA_INVALID_RESPONSE",
      message: "Market data provider returned an invalid response.",
    });
  });

  test("accepts the documented Binance prefix and slash pair forms", async () => {
    const client = fakeClient(binanceQuoteResponse());
    const provider = createBinanceMarketDataProvider(
      { baseUrl: "https://api.binance.com", timeoutMs: 5000 },
      { httpClient: client },
    );

    await provider.getQuote("BINANCE:BTC/USDT");

    expect(client.get).toHaveBeenCalledWith("/api/v3/ticker/24hr", {
      params: { symbol: "BTCUSDT" },
    });

    const btcQuotedProvider = createBinanceMarketDataProvider(
      { baseUrl: "https://api.binance.com", timeoutMs: 5000 },
      { httpClient: fakeClient(binanceQuoteResponse({ symbol: "ETHBTC" })) },
    );
    await expect(btcQuotedProvider.getQuote("ETHBTC")).resolves.toMatchObject({
      currency: "BTC",
    });
  });

  test("preserves Binance decimal precision as provider strings", async () => {
    const precise = binanceQuoteResponse({
      lastPrice: "0.000000000000000001",
      priceChange: "-0.000000000000000009",
    });
    const provider = createBinanceMarketDataProvider(
      { baseUrl: "https://api.binance.com", timeoutMs: 5000 },
      { httpClient: fakeClient(precise) },
    );

    const quote = await provider.getQuote("BTCUSDT");

    expect(quote.price).toBe("0.000000000000000001");
    expect(quote.change).toBe("-0.000000000000000009");
  });

  test.each(["AAPL", "BTC////USDT", "BINANCE:BINANCE:BTCUSDT"])(
    "rejects unsupported crypto symbol format %s before making a Binance request",
    async (symbol) => {
      const client = fakeClient(binanceQuoteResponse());
      const provider = createBinanceMarketDataProvider(
        { baseUrl: "https://api.binance.com", timeoutMs: 5000 },
        { httpClient: client },
      );

      await expect(provider.getQuote(symbol)).rejects.toMatchObject({
        statusCode: 400,
        code: "MARKET_DATA_INVALID_REQUEST",
      });
      expect(client.get).not.toHaveBeenCalled();
    },
  );

  test("maps an unknown Binance pair to not found", async () => {
    const provider = createBinanceMarketDataProvider(
      { baseUrl: "https://api.binance.com", timeoutMs: 5000 },
      {
        httpClient: {
          get: jest.fn().mockRejectedValue({
            response: {
              status: 400,
              data: { code: -1121, msg: "Invalid symbol." },
            },
          }),
        },
      },
    );

    await expect(provider.getQuote("NOTAREALCOINUSDT")).rejects.toMatchObject({
      statusCode: 404,
      code: "MARKET_DATA_NOT_FOUND",
      message: "Market data is unavailable for the requested symbol or range.",
    });
  });

  test.each([
    ["malformed payload", "not-json"],
    ["missing response field", binanceQuoteResponse({ volume: undefined })],
    ["non-decimal price", binanceQuoteResponse({ lastPrice: "0x10" })],
    ["negative volume", binanceQuoteResponse({ volume: "-1" })],
    ["provider symbol mismatch", binanceQuoteResponse({ symbol: "ETHUSDT" })],
    ["invalid timestamp", binanceQuoteResponse({ closeTime: "bad" })],
  ])("rejects a Binance %s", async (_description, data) => {
    const provider = createBinanceMarketDataProvider(
      { baseUrl: "https://api.binance.com", timeoutMs: 5000 },
      { httpClient: fakeClient(data) },
    );

    await expect(provider.getQuote("BTCUSDT")).rejects.toMatchObject({
      statusCode: 502,
      code: "MARKET_DATA_INVALID_RESPONSE",
      message: "Market data provider returned an invalid response.",
    });
  });

  test.each([
    [
      "timeout",
      { code: "ECONNABORTED", message: "timeout of 5000ms exceeded" },
      504,
      "MARKET_DATA_TIMEOUT",
    ],
    [
      "rate limit",
      { response: { status: 429 } },
      429,
      "MARKET_DATA_RATE_LIMITED",
    ],
    [
      "network failure",
      { code: "ECONNREFUSED" },
      503,
      "MARKET_DATA_PROVIDER_UNAVAILABLE",
    ],
    [
      "unexpected provider failure",
      new Error("private provider detail"),
      503,
      "MARKET_DATA_PROVIDER_UNAVAILABLE",
    ],
  ])(
    "maps Binance %s to a safe domain error",
    async (_description, error, statusCode, code) => {
      const provider = createBinanceMarketDataProvider(
        { baseUrl: "https://api.binance.com", timeoutMs: 5000 },
        { httpClient: { get: jest.fn().mockRejectedValue(error) } },
      );

      await expect(provider.getQuote("BTCUSDT")).rejects.toMatchObject({
        statusCode,
        code,
      });
      await expect(provider.getQuote("BTCUSDT")).rejects.not.toHaveProperty(
        "message",
        "private provider detail",
      );
    },
  );
});
