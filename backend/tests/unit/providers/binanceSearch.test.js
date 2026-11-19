const {
  createBinanceMarketDataProvider,
} = require("../../../src/providers/binanceMarketDataProvider");

function symbol(symbol, baseAsset, quoteAsset) {
  return {
    symbol,
    baseAsset,
    quoteAsset,
    status: "TRADING",
  };
}

describe("Binance symbol search ordering", () => {
  test("ranks an exact base-asset USDT pair ahead of cross pairs", async () => {
    const httpClient = {
      get: jest.fn().mockResolvedValue({
        data: {
          symbols: [
            symbol("ETHBTC", "ETH", "BTC"),
            symbol("LTCBTC", "LTC", "BTC"),
            symbol("BTCUSDT", "BTC", "USDT"),
            symbol("BTCUSDC", "BTC", "USDC"),
            symbol("BTCFDUSD", "BTC", "FDUSD"),
            symbol("BTCTRY", "BTC", "TRY"),
          ],
        },
      }),
    };

    const provider = createBinanceMarketDataProvider(
      { baseUrl: "https://binance.test", timeoutMs: 5000 },
      { httpClient },
    );

    const results = await provider.searchSymbols("BTC");

    expect(results.map((item) => item.symbol)).toEqual([
      "BINANCE:BTCUSDT",
      "BINANCE:BTCUSDC",
      "BINANCE:BTCFDUSD",
      "BINANCE:BTCTRY",
      "BINANCE:ETHBTC",
      "BINANCE:LTCBTC",
    ]);
  });

  test.each(["", "   ", null, undefined])(
    "returns empty array for empty search query %j without calling API",
    async (query) => {
      const httpClient = { get: jest.fn() };
      const provider = createBinanceMarketDataProvider(
        { baseUrl: "https://binance.test", timeoutMs: 5000 },
        { httpClient },
      );

      const results = await provider.searchSymbols(query);
      expect(results).toEqual([]);
      expect(httpClient.get).not.toHaveBeenCalled();
    },
  );

  test("does not mutate a non-USDT explicit pair into USDT fallback on 404", async () => {
    const error404 = Object.assign(new Error("Symbol not found"), {
      response: { status: 404, data: { code: -1121, msg: "Invalid symbol." } },
    });
    const httpClient = {
      get: jest.fn().mockRejectedValue(error404),
    };

    const provider = createBinanceMarketDataProvider(
      { baseUrl: "https://binance.test", timeoutMs: 5000 },
      { httpClient },
    );

    await expect(provider.getQuote("ETHBTC")).rejects.toMatchObject({
      statusCode: 404,
      code: "MARKET_DATA_NOT_FOUND",
    });

    // Should only have been called once for ETHBTC, NEVER for ETHBTCUSDT
    expect(httpClient.get).toHaveBeenCalledTimes(1);
    expect(httpClient.get).toHaveBeenCalledWith(
      "/api/v3/ticker/24hr",
      expect.objectContaining({ params: { symbol: "ETHBTC" } }),
    );
  });

  test("retries as USDT pair when a lone base asset returns 404", async () => {
    const error404 = Object.assign(new Error("Symbol not found"), {
      response: { status: 404, data: { code: -1121, msg: "Invalid symbol." } },
    });
    const httpClient = {
      get: jest
        .fn()
        .mockRejectedValueOnce(error404)
        .mockResolvedValueOnce({
          data: {
            symbol: "1000SATSUSDT",
            lastPrice: "0.00025",
            priceChange: "0.00001",
            priceChangePercent: "2.5",
            highPrice: "0.00026",
            lowPrice: "0.00024",
            openPrice: "0.00024",
            prevClosePrice: "0.00024",
            volume: "1000000",
            closeTime: 1700000000000,
          },
        }),
    };

    const provider = createBinanceMarketDataProvider(
      { baseUrl: "https://binance.test", timeoutMs: 5000 },
      { httpClient },
    );

    const quote = await provider.getQuote("1000SATS");
    expect(quote.symbol).toBe("BINANCE:1000SATSUSDT");
    expect(httpClient.get).toHaveBeenCalledTimes(2);
    expect(httpClient.get).toHaveBeenNthCalledWith(
      1,
      "/api/v3/ticker/24hr",
      expect.objectContaining({ params: { symbol: "1000SATS" } }),
    );
    expect(httpClient.get).toHaveBeenNthCalledWith(
      2,
      "/api/v3/ticker/24hr",
      expect.objectContaining({ params: { symbol: "1000SATSUSDT" } }),
    );
  });
});
