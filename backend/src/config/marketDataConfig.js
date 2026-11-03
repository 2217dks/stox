const DEFAULT_TIMEOUT_MS = 5000;
const MIN_TIMEOUT_MS = 100;
const MAX_TIMEOUT_MS = 30000;

function readTimeout(value) {
  if (value === undefined || value === "") return DEFAULT_TIMEOUT_MS;

  const timeoutMs = Number(value);
  if (
    !Number.isInteger(timeoutMs) ||
    timeoutMs < MIN_TIMEOUT_MS ||
    timeoutMs > MAX_TIMEOUT_MS
  ) {
    throw new Error(
      `MARKET_DATA_REQUEST_TIMEOUT_MS must be an integer from ${MIN_TIMEOUT_MS} to ${MAX_TIMEOUT_MS}.`,
    );
  }

  return timeoutMs;
}

function readProvider(value, fallback, envName) {
  const provider = (value || fallback).trim().toLowerCase();
  if (!provider) {
    throw new Error(`${envName} must name a market-data provider.`);
  }
  return provider;
}

function loadMarketDataConfig(env = process.env) {
  return Object.freeze({
    providerByAssetClass: Object.freeze({
      STOCK: readProvider(
        env.MARKET_DATA_STOCK_PROVIDER,
        "finnhub",
        "MARKET_DATA_STOCK_PROVIDER",
      ),
      CRYPTO: readProvider(
        env.MARKET_DATA_CRYPTO_PROVIDER,
        "binance",
        "MARKET_DATA_CRYPTO_PROVIDER",
      ),
    }),
    timeoutMs: readTimeout(env.MARKET_DATA_REQUEST_TIMEOUT_MS),
    providers: Object.freeze({
      finnhub: Object.freeze({
        apiKey: env.FINNHUB_API_KEY?.trim() || null,
        baseUrl: env.FINNHUB_API_URL?.trim() || "https://finnhub.io/api/v1",
      }),
      binance: Object.freeze({
        baseUrl: env.BINANCE_API_URL?.trim() || "https://api.binance.com",
      }),
    }),
  });
}

module.exports = {
  DEFAULT_TIMEOUT_MS,
  MIN_TIMEOUT_MS,
  MAX_TIMEOUT_MS,
  loadMarketDataConfig,
};
