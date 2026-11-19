
const DEFAULT_TIMEOUT_MS = 5000;
const MIN_TIMEOUT_MS = 100;
const MAX_TIMEOUT_MS = 30000;

const DEFAULT_PROVIDER_CHAINS = Object.freeze({
  // Finnhub serves US stocks; Yahoo is the free stock-history fallback used
  // when Finnhub's plan rejects /stock/candle. The chain order is priority.
  STOCK: Object.freeze(["finnhub", "yahoo"]),
  CRYPTO: Object.freeze(["binance"]),
});

const PROVIDER_CHAIN_ENV_NAMES = Object.freeze({
  STOCK: "MARKET_DATA_STOCK_PROVIDERS",
  CRYPTO: "MARKET_DATA_CRYPTO_PROVIDERS",
});

const PRIMARY_PROVIDER_ENV_NAMES = Object.freeze({
  STOCK: "MARKET_DATA_STOCK_PROVIDER",
  CRYPTO: "MARKET_DATA_CRYPTO_PROVIDER",
});

const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_BASE_DELAY_MS = 200;
const DEFAULT_RETRY_MAX_DELAY_MS = 2000;

const DEFAULT_MAX_CLOCK_SKEW_SECONDS = 5;

const DEFAULT_FRESHNESS_THRESHOLDS = Object.freeze({
  CRYPTO: 60,
  STOCK: 300,
  DEFAULT: 120,
});

function readTimeout(value) {
  if (value === undefined || value === "") {
    return DEFAULT_TIMEOUT_MS;
  }

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
  if (value === undefined || value === "") {
    return fallback;
  }

  const num = Number(value);

  if (!Number.isInteger(num) || num < min || num > max) {
    throw new Error(`${envName} must be an integer from ${min} to ${max}.`);
  }

  return num;
}

function readFreshnessThreshold(value, fallback, envName) {
  if (value === undefined || value === "") {
    return fallback;
  }

  const num = Number(value);

  if (!Number.isInteger(num) || num <= 0) {
    throw new Error(
      `${envName} must be a positive integer representing seconds.`,
    );
  }

  return num;
}

function normalizeProviderId(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

/**
 * Read an ordered provider chain.
 *
 * `MARKET_DATA_<ASSET>_PROVIDERS` is the full chain and takes precedence. The
 * older `MARKET_DATA_<ASSET>_PROVIDER` variable still selects the primary
 * provider; the documented fallbacks remain after it so existing `.env` files
 * keep the free Yahoo history fallback.
 */
function readProviderChain(assetClass, env) {
  const chainEnvName = PROVIDER_CHAIN_ENV_NAMES[assetClass];
  const primaryEnvName = PRIMARY_PROVIDER_ENV_NAMES[assetClass];
  const defaults = DEFAULT_PROVIDER_CHAINS[assetClass];
  const chainValue = env[chainEnvName];

  if (chainValue !== undefined) {
    const ids = String(chainValue)
      .split(",")
      .map(normalizeProviderId)
      .filter(Boolean);
    const unique = [...new Set(ids)];
    if (unique.length === 0) {
      throw new Error(
        `${chainEnvName} must list at least one market-data provider.`,
      );
    }
    return unique;
  }

  const primaryValue = env[primaryEnvName];
  if (primaryValue !== undefined && String(primaryValue).trim() === "") {
    throw new Error(`${primaryEnvName} must name a market-data provider.`);
  }

  const primary =
    normalizeProviderId(primaryValue) || defaults[0] || null;
  if (!primary) {
    throw new Error(`${primaryEnvName} must name a market-data provider.`);
  }

  return [...new Set([primary, ...defaults])];
}

function loadMarketDataConfig(env = process.env) {
  const stockChain = readProviderChain("STOCK", env);
  const cryptoChain = readProviderChain("CRYPTO", env);

  return Object.freeze({
    // Ordered chains are the routing source of truth.
    providerChains: Object.freeze({
      STOCK: Object.freeze(stockChain),
      CRYPTO: Object.freeze(cryptoChain),
    }),
    // Backwards-compatible single primary selection for callers that only need
    // one provider id. New code should read `providerChains`.
    providerByAssetClass: Object.freeze({
      STOCK: stockChain[0],
      CRYPTO: cryptoChain[0],
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
      yahoo: Object.freeze({
        baseUrl:
          env.YAHOO_FINANCE_API_URL?.trim() ||
          "https://query1.finance.yahoo.com",
      }),
    }),
  });
}

module.exports = {
  DEFAULT_PROVIDER_CHAINS,
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
