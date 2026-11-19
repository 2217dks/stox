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
});
