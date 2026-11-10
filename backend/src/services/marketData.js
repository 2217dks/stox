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
};
