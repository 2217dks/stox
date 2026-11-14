require("dotenv").config();

const { loadMarketDataConfig } = require("../config/marketDataConfig");
const {
  createMarketDataProviders,
} = require("../providers/createMarketDataProviders");
const { createMarketDataService } = require("./marketDataService");
const cacheService = require("./cacheService");

const config = loadMarketDataConfig();

const marketDataService = createMarketDataService({
  config,
  providers: createMarketDataProviders(config),
});

function inferAssetClass(symbol) {
  const normalizedSymbol = String(symbol || "")
    .trim()
    .toUpperCase();

  return normalizedSymbol.startsWith("BINANCE:") ||
    /(?:USDT|BTC|ETH)$/.test(normalizedSymbol)
    ? "CRYPTO"
    : "STOCK";
}

module.exports = {
  ...marketDataService,

  async getQuote(symbol, options = {}) {
    const assetClass = options.assetClass
      ? String(options.assetClass).trim().toUpperCase()
      : inferAssetClass(symbol);

    return cacheService.getOrSetPrice(assetClass, symbol, () =>
      marketDataService.getQuote(symbol, options),
    );
  },

  async getHistoricalPrice(symbol, options = {}) {
    const assetClass = options.assetClass
      ? String(options.assetClass).trim().toUpperCase()
      : inferAssetClass(symbol);
    const asOf = options.asOf
      ? (options.asOf instanceof Date ? options.asOf : new Date(options.asOf))
      : new Date();
    const toMs = Math.min(asOf.getTime(), Date.now());
    const fromMs = Math.max(0, toMs - 7 * 24 * 60 * 60 * 1000);

    const history = await marketDataService.getHistoricalPrices(symbol, {
      interval: "1d",
      from: fromMs,
      to: toMs,
      limit: 10,
      assetClass,
    });

    if (!history || !Array.isArray(history.prices) || history.prices.length === 0) {
      throw new Error(`Historical price unavailable for ${symbol} as of ${asOf.toISOString()}`);
    }

    const eligible = history.prices.filter(
      (c) => new Date(c.timestamp).getTime() <= toMs,
    );
    if (eligible.length === 0) {
      throw new Error(`No historical candle found for ${symbol} on or before ${asOf.toISOString()}`);
    }

    const candle = eligible[eligible.length - 1];
    return {
      symbol,
      price: candle.close,
      timestamp: candle.timestamp,
    };
  },
};
