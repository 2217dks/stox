
const DEFAULT_TIMEOUT_MS = 5000;
const MIN_TIMEOUT_MS = 100;
const MAX_TIMEOUT_MS = 30000;
const DEFAULT_MAX_CLOCK_SKEW_SECONDS = 5;

const DEFAULT_FRESHNESS_THRESHOLDS = Object.freeze({
  CRYPTO: 60,
  STOCK: 300,
  DEFAULT: 120,
});

function readFreshnessThreshold(value, fallback, envName) {
  if (value === undefined || value === "") return fallback;

  const num = Number(value);
  if (!Number.isInteger(num) || num <= 0) {
    throw new Error(
      `${envName} must be a positive integer representing seconds.`,
    );
  }

  return num;
}

const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_BASE_DELAY_MS = 200;
const DEFAULT_RETRY_MAX_DELAY_MS = 2000;

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

function readRetryInt(value, fallback, min, max, envName) {
  if (value === undefined || value === "") return fallback;

  const num = Number(value);
  if (!Number.isInteger(num) || num < min || num > max) {
    throw new Error(`${envName} must be an integer from ${min} to ${max}.`);
  }

  return num;
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

    retry: Object.freeze({
      maxRetries: readRetryInt(
        env.MARKET_DATA_MAX_RETRIES,
        DEFAULT_MAX_RETRIES,
        0,
        10,
        "MARKET_DATA_MAX_RETRIES",
      ),
      baseDelayMs: readRetryInt(
        env.MARKET_DATA_RETRY_BASE_DELAY_MS,
        DEFAULT_RETRY_BASE_DELAY_MS,
        1,
        10000,
        "MARKET_DATA_RETRY_BASE_DELAY_MS",
      ),
      maxDelayMs: readRetryInt(
        env.MARKET_DATA_RETRY_MAX_DELAY_MS,
        DEFAULT_RETRY_MAX_DELAY_MS,
        1,
        60000,
        "MARKET_DATA_RETRY_MAX_DELAY_MS",
      ),
    }),

    maxClockSkewSeconds: readFreshnessThreshold(
      env.MARKET_DATA_MAX_CLOCK_SKEW_SECONDS,
      DEFAULT_MAX_CLOCK_SKEW_SECONDS,
      "MARKET_DATA_MAX_CLOCK_SKEW_SECONDS",
    ),

    freshnessThresholds: Object.freeze({
      CRYPTO: readFreshnessThreshold(
        env.MARKET_DATA_FRESHNESS_CRYPTO_SECONDS,
        DEFAULT_FRESHNESS_THRESHOLDS.CRYPTO,
        "MARKET_DATA_FRESHNESS_CRYPTO_SECONDS",
      ),
      STOCK: readFreshnessThreshold(
        env.MARKET_DATA_FRESHNESS_STOCK_SECONDS,
        DEFAULT_FRESHNESS_THRESHOLDS.STOCK,
        "MARKET_DATA_FRESHNESS_STOCK_SECONDS",
      ),
      DEFAULT: readFreshnessThreshold(
        env.MARKET_DATA_FRESHNESS_DEFAULT_SECONDS,
        DEFAULT_FRESHNESS_THRESHOLDS.DEFAULT,
        "MARKET_DATA_FRESHNESS_DEFAULT_SECONDS",
      ),
    }),

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
  DEFAULT_MAX_RETRIES,
  DEFAULT_RETRY_BASE_DELAY_MS,
  DEFAULT_RETRY_MAX_DELAY_MS,
  DEFAULT_MAX_CLOCK_SKEW_SECONDS,
  DEFAULT_FRESHNESS_THRESHOLDS,
  loadMarketDataConfig,
};
