const {
  createFinnhubMarketDataProvider,
} = require("./finnhubMarketDataProvider");
const {
  createBinanceMarketDataProvider,
} = require("./binanceMarketDataProvider");

function createMarketDataProviders(config) {
  const retry = config?.retry;
  return {
    finnhub: createFinnhubMarketDataProvider({
      ...config.providers.finnhub,
      timeoutMs: config.timeoutMs,
      retry,
    }),
    binance: createBinanceMarketDataProvider({
      ...config.providers.binance,
      timeoutMs: config.timeoutMs,
      retry,
    }),
  };
}

module.exports = { createMarketDataProviders };
