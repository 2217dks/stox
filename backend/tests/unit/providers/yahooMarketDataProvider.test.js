const {
  createYahooMarketDataProvider,
} = require("../../../src/providers/yahooMarketDataProvider");

const BASE_SECONDS = 1_700_000_000;

function yahooPayload(overrides = {}) {
  return {
    chart: {
      result: [
        {
          meta: { symbol: "VOD.L", currency: "GBp", exchangeName: "LSE" },
          timestamp: [BASE_SECONDS, BASE_SECONDS + 86_400],
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
          ...overrides,
        },
      ],
    },
  };
}

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

function createProvider({ fetchImpl, config = {} } = {}) {
  return createYahooMarketDataProvider(
    { timeoutMs: 5000, ...config },
    { fetchImpl },
  );
}

describe("Yahoo market-data provider", () => {
  test("declares stock history capability and a global market scope", () => {
    const provider = createProvider();

    expect(provider.id).toBe("yahoo");
    expect(provider.assetClasses).toEqual(["STOCK"]);
    expect(provider.operations).toEqual(["history"]);
    expect(provider.markets).toEqual(["*"]);
  });

  test("preserves exchange suffixes in the provider symbol", () => {
    const provider = createProvider();

    expect(provider.toProviderSymbol("vod.l")).toBe("VOD.L");
    expect(provider.toProviderSymbol("7203.T")).toBe("7203.T");
  });

  test("fetches and normalizes historical candles", async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(yahooPayload()));
    const provider = createProvider({ fetchImpl });

    const result = await provider.getHistoricalPrices("VOD.L", {
      interval: "1d",
      from: BASE_SECONDS * 1000,
      to: (BASE_SECONDS + 86_400) * 1000,
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringContaining("/v8/finance/chart/VOD.L"),
      expect.objectContaining({ headers: expect.any(Object) }),
    );
    expect(result.assetClass).toBe("STOCK");
    expect(result.symbol).toBe("VOD.L");
    expect(result.prices).toHaveLength(2);
    expect(result.prices[1]).toMatchObject({
      open: "2",
      high: "3",
      low: "1.5",
      close: "2.5",
      volume: "20",
    });
  });

  test("uses the configured base URL and sends a browser-like user agent", async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(yahooPayload()));
    const provider = createProvider({
      fetchImpl,
      config: { baseUrl: "https://yahoo.example.test", timeoutMs: 2500 },
    });

    await provider.getHistoricalPrices("AAPL", {
      interval: "1d",
      from: BASE_SECONDS * 1000,
      to: (BASE_SECONDS + 86_400) * 1000,
    });

    const [url, options] = fetchImpl.mock.calls[0];
    expect(
      url.startsWith("https://yahoo.example.test/v8/finance/chart/AAPL?"),
    ).toBe(true);
    expect(options.headers["User-Agent"]).toContain("Mozilla");
    expect(options.signal).toBeDefined();
  });

  test.each([
    [404, "MARKET_DATA_NOT_FOUND", 404],
    [429, "MARKET_DATA_RATE_LIMITED", 429],
    [418, "MARKET_DATA_RATE_LIMITED", 429],
    [500, "MARKET_DATA_PROVIDER_UNAVAILABLE", 503],
    [400, "MARKET_DATA_PROVIDER_UNAVAILABLE", 503],
  ])("maps HTTP %i to %s", async (status, code, statusCode) => {
    const provider = createProvider({
      fetchImpl: jest.fn().mockResolvedValue(jsonResponse({}, status)),
    });

    await expect(
      provider.getHistoricalPrices("AAPL", {
        interval: "1d",
        from: BASE_SECONDS * 1000,
        to: (BASE_SECONDS + 86_400) * 1000,
      }),
    ).rejects.toMatchObject({ code, statusCode });
  });

  test("maps network timeouts to the standard timeout error", async () => {
    const timeout = Object.assign(new Error("The operation was aborted"), {
      name: "TimeoutError",
    });
    const provider = createProvider({
      fetchImpl: jest.fn().mockRejectedValue(timeout),
    });

    await expect(
      provider.getHistoricalPrices("AAPL", {
        interval: "1d",
        from: BASE_SECONDS * 1000,
        to: (BASE_SECONDS + 86_400) * 1000,
      }),
    ).rejects.toMatchObject({
      statusCode: 504,
      code: "MARKET_DATA_TIMEOUT",
    });
  });

  test("maps an unparsable body to an invalid provider response", async () => {
    const provider = createProvider({
      fetchImpl: jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError("Unexpected token <");
        },
      }),
    });

    await expect(
      provider.getHistoricalPrices("AAPL", {
        interval: "1d",
        from: BASE_SECONDS * 1000,
        to: (BASE_SECONDS + 86_400) * 1000,
      }),
    ).rejects.toMatchObject({
      statusCode: 502,
      code: "MARKET_DATA_INVALID_RESPONSE",
    });
  });

  test("rejects an unsupported interval before making a request", async () => {
    const fetchImpl = jest.fn();
    const provider = createProvider({ fetchImpl });

    await expect(
      provider.getHistoricalPrices("AAPL", {
        interval: "2h",
        from: BASE_SECONDS * 1000,
        to: (BASE_SECONDS + 86_400) * 1000,
      }),
    ).rejects.toMatchObject({
      statusCode: 400,
      code: "MARKET_DATA_INVALID_REQUEST",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
