const {
  createFinnhubMarketDataProvider,
} = require("./finnhubMarketDataProvider");
const {
  createBinanceMarketDataProvider,
} = require("./binanceMarketDataProvider");

function createMarketDataProviders(config) {
  return {
    finnhub: createFinnhubMarketDataProvider({
      ...config.providers.finnhub,
      timeoutMs: config.timeoutMs,
    }),
    binance: createBinanceMarketDataProvider({
      ...config.providers.binance,
      timeoutMs: config.timeoutMs,
    }),
  };
}

module.exports = { createMarketDataProviders };
