const {
  createFinnhubMarketDataProvider,
} = require("./finnhubMarketDataProvider");
const {
  createBinanceMarketDataProvider,
} = require("./binanceMarketDataProvider");
const { createYahooMarketDataProvider } = require("./yahooMarketDataProvider");

/**
 * The single registration point for market-data providers.
 *
 * Adding a provider later means adding one module and one entry here; the
 * service selects providers from configuration by id and never imports an
 * adapter directly. Factories receive the provider-specific config plus shared
 * dependencies so tests can inject fake HTTP clients or fetch implementations.
 */
const PROVIDER_DEFINITIONS = Object.freeze({
  finnhub: Object.freeze({
    id: "finnhub",
    create: (config, deps) =>
      createFinnhubMarketDataProvider(config, {
        httpClient: deps.httpClient,
      }),
  }),
  binance: Object.freeze({
    id: "binance",
    create: (config, deps) =>
      createBinanceMarketDataProvider(config, {
        httpClient: deps.httpClient,
      }),
  }),
  yahoo: Object.freeze({
    id: "yahoo",
    create: (config, deps) =>
      createYahooMarketDataProvider(config, {
        fetchImpl: deps.fetchImpl,
      }),
  }),
});

function getMarketDataProviderDefinition(id) {
  const key = String(id || "")
    .trim()
    .toLowerCase();
  return PROVIDER_DEFINITIONS[key] || null;
}

function listMarketDataProviderIds() {
  return Object.keys(PROVIDER_DEFINITIONS);
}

function createMarketDataProviders(config = {}, deps = {}) {
  const timeoutMs = config.timeoutMs;
  const retry = config.retry;
  const providerConfig = config.providers || {};
  const httpClients = deps.httpClients || {};
  const providers = {};

  for (const [id, definition] of Object.entries(PROVIDER_DEFINITIONS)) {
    providers[id] = definition.create(
      {
        ...(providerConfig[id] || {}),
        timeoutMs,
        retry,
      },
      {
        httpClient: httpClients[id],
        fetchImpl: deps.fetchImpl,
      },
    );
  }

  return providers;
}

module.exports = {
  createMarketDataProviders,
  getMarketDataProviderDefinition,
  listMarketDataProviderIds,
};
