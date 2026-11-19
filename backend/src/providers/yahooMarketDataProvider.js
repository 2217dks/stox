const {
  DEFAULT_YAHOO_BASE_URL,
  fetchYahooHistoricalPrices,
} = require("./yahooHistoricalPrices");
const { toCanonicalSymbol } = require("../services/symbolMappingService");

/**
 * Yahoo Finance stock-history adapter.
 *
 * Yahoo is a *history-only* fallback: Finnhub's free plan currently rejects
 * `/stock/candle` with 403 while quotes stay available. The adapter therefore
 * declares only the history operation, and the provider registry will never
 * route quotes, search, or overview calls here.
 *
 * Yahoo addresses international listings by exchange suffix (`VOD.L`,
 * `7203.T`, `RELIANCE.NS`), so the canonical symbol is passed through
 * unchanged. Declaring a global market scope also lets the router use this
 * adapter for exchanges the primary stock provider does not cover.
 */
function createYahooMarketDataProvider(config = {}, { fetchImpl } = {}) {
  const baseUrl = config.baseUrl || DEFAULT_YAHOO_BASE_URL;
  const timeoutMs = config.timeoutMs;

  function providerSymbol(symbol) {
    return toCanonicalSymbol(symbol, { assetClass: "STOCK" });
  }

  return {
    id: "yahoo",
    assetClasses: ["STOCK"],
    operations: ["history"],
    markets: ["*"],

    toProviderSymbol: providerSymbol,

    async getHistoricalPrices(symbol, { interval, from, to }) {
      return fetchYahooHistoricalPrices(providerSymbol(symbol), {
        interval,
        from,
        to,
        timeoutMs,
        baseUrl,
        fetchImpl: fetchImpl || config.fetchImpl,
      });
    },
  };
}

module.exports = { createYahooMarketDataProvider };
