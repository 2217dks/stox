const { loadMarketDataConfig } = require("../config/marketDataConfig");
const { createMarketQuoteDto } = require("../dtos/marketQuoteDto");
const {
  createMarketDataError,
  mapProviderError,
} = require("../providers/marketDataErrors");

const HISTORICAL_INTERVALS = new Set([
  "1m",
  "5m",
  "15m",
  "30m",
  "1h",
  "4h",
  "1d",
  "1w",
  "1M",
]);
const ASSET_CLASSES = new Set(["STOCK", "CRYPTO"]);

function invalidRequest(message) {
  return createMarketDataError(message, 400, "MARKET_DATA_INVALID_REQUEST");
}

function normalizeAssetClass(value, symbol) {
  const normalizedSymbol = String(symbol || "")
    .trim()
    .toUpperCase();
  const inferredCrypto =
    normalizedSymbol.startsWith("BINANCE:") ||
    /(?:USDT|BTC|ETH)$/.test(normalizedSymbol);
  const assetClass = value
    ? String(value).trim().toUpperCase()
    : inferredCrypto
      ? "CRYPTO"
      : "STOCK";
  if (!ASSET_CLASSES.has(assetClass)) {
    throw createMarketDataError(
      "Market data is not supported for this asset class.",
      422,
      "MARKET_DATA_UNSUPPORTED_ASSET_CLASS",
    );
  }
  return assetClass;
}

function normalizeSymbol(symbol) {
  if (typeof symbol !== "string" || !symbol.trim()) {
    throw invalidRequest("A symbol is required.");
  }
  const value = symbol.trim().toUpperCase();
  if (!/^[A-Z0-9._:/-]{1,30}$/.test(value)) {
    throw invalidRequest("The symbol format is invalid.");
  }
  return value;
}

function isValidIsoTimestamp(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function isDecimalString(value) {
  return (
    typeof value === "string" &&
    value.trim() !== "" &&
    Number.isFinite(Number(value))
  );
}

function assertQuote(value, assetClass) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw createMarketDataError(
      "Market data provider returned an invalid response.",
      502,
      "MARKET_DATA_INVALID_RESPONSE",
    );
  }
  const normalized = createMarketQuoteDto(value);
  if (normalized.assetClass !== assetClass) {
    throw createMarketDataError(
      "Market data provider returned an invalid response.",
      502,
      "MARKET_DATA_INVALID_RESPONSE",
    );
  }
  return normalized;
}

function assertHistoricalPrices(value, symbol, assetClass, interval) {
  if (
    !value ||
    typeof value !== "object" ||
    !Array.isArray(value.prices) ||
    value.assetClass !== assetClass ||
    value.interval !== interval
  ) {
    throw createMarketDataError(
      "Market data provider returned an invalid response.",
      502,
      "MARKET_DATA_INVALID_RESPONSE",
    );
  }
  for (const candle of value.prices) {
    if (
      !candle ||
      !isValidIsoTimestamp(candle.timestamp) ||
      ["open", "high", "low", "close", "volume"].some(
        (key) => !isDecimalString(candle[key]),
      )
    ) {
      throw createMarketDataError(
        "Market data provider returned an invalid response.",
        502,
        "MARKET_DATA_INVALID_RESPONSE",
      );
    }
  }
  return { ...value, symbol };
}

function assertOverview(value, assetClass) {
  if (
    !value ||
    typeof value !== "object" ||
    value.assetClass !== assetClass ||
    !isValidIsoTimestamp(value.asOf) ||
    !value.marketStatus ||
    typeof value.marketStatus !== "object" ||
    Array.isArray(value.marketStatus) ||
    typeof value.marketStatus.isOpen !== "boolean" ||
    !Array.isArray(value.movers) ||
    typeof value.source !== "string" ||
    !value.source.trim() ||
    value.movers.some(
      (mover) =>
        !mover ||
        typeof mover !== "object" ||
        typeof mover.symbol !== "string" ||
        !mover.symbol.trim() ||
        !isDecimalString(mover.price) ||
        !isDecimalString(mover.changePercent),
    )
  ) {
    throw createMarketDataError(
      "Market data provider returned an invalid response.",
      502,
      "MARKET_DATA_INVALID_RESPONSE",
    );
  }
  return value;
}

function assertSearchResults(value, assetClass) {
  if (
    !Array.isArray(value) ||
    value.some(
      (item) =>
        !item ||
        typeof item.symbol !== "string" ||
        !item.symbol.trim() ||
        typeof item.name !== "string" ||
        !item.name.trim() ||
        item.assetClass !== assetClass ||
        typeof item.source !== "string" ||
        !item.source.trim() ||
        (item.exchange !== null && typeof item.exchange !== "string") ||
        (item.currency !== null && typeof item.currency !== "string") ||
        (item.type !== null && typeof item.type !== "string"),
    )
  ) {
    throw createMarketDataError(
      "Market data provider returned an invalid response.",
      502,
      "MARKET_DATA_INVALID_RESPONSE",
    );
  }
  return value;
}

/**
 * Create a provider-independent market-data service.
 *
 * Adapters are keyed by provider id and implement getQuote(symbol),
 * getHistoricalPrices(symbol, options), getMarketOverview(options), and
 * searchSymbols(query). Each method returns the normalized domain shapes
 * documented in docs/MARKET_DATA_SERVICE.md. Adapters may be replaced without
 * changing service callers.
 */
function createMarketDataService({ config, providers } = {}) {
  const marketConfig = config || loadMarketDataConfig();
  const providerAdapters = providers || {};

  function adapterFor(assetClass) {
    const providerId = marketConfig.providerByAssetClass?.[assetClass];
    if (!providerId) {
      throw createMarketDataError(
        `No market-data provider is configured for ${assetClass}.`,
        503,
        "MARKET_DATA_NOT_CONFIGURED",
      );
    }
    const adapter = providerAdapters[providerId];
    if (!adapter) {
      throw createMarketDataError(
        "The configured market-data provider is unavailable.",
        503,
        "MARKET_DATA_PROVIDER_UNAVAILABLE",
      );
    }
    if (
      Array.isArray(adapter.assetClasses) &&
      !adapter.assetClasses.includes(assetClass)
    ) {
      throw createMarketDataError(
        "The configured market-data provider does not support this asset class.",
        503,
        "MARKET_DATA_PROVIDER_UNAVAILABLE",
      );
    }
    return adapter;
  }

  async function callAdapter(callback) {
    try {
      return await callback();
    } catch (error) {
      throw mapProviderError(error);
    }
  }

  return {
    /**
     * Get one current quote. `options.assetClass` may be STOCK or CRYPTO;
     * otherwise BINANCE-prefixed symbols and symbols ending in USDT, BTC, or
     * ETH are treated as crypto and other symbols as stocks. Prices and
     * changes are decimal strings.
     */
    async getQuote(symbol, options = {}) {
      const assetClass = normalizeAssetClass(options.assetClass, symbol);
      const normalizedSymbol = normalizeSymbol(symbol);
      const provider = adapterFor(assetClass);
      const result = await callAdapter(() =>
        provider.getQuote(normalizedSymbol),
      );
      return assertQuote(result, assetClass);
    },

    /**
     * Get OHLCV history. `from` and `to` are inclusive Unix epoch
     * milliseconds, `interval` is one of 1m/5m/15m/30m/1h/4h/1d/1w/1M,
     * and `limit` defaults to 500 (maximum 1000).
     */
    async getHistoricalPrices(symbol, options = {}) {
      const assetClass = normalizeAssetClass(options.assetClass, symbol);
      const normalizedSymbol = normalizeSymbol(symbol);
      const { interval, from, to } = options;
      const numericFrom = Number(from);
      const numericTo = Number(to);
      const limit = options.limit === undefined ? 500 : Number(options.limit);
      if (
        !HISTORICAL_INTERVALS.has(interval) ||
        !Number.isSafeInteger(numericFrom) ||
        !Number.isSafeInteger(numericTo) ||
        numericFrom < 0 ||
        numericTo <= numericFrom ||
        !Number.isInteger(limit) ||
        limit < 1 ||
        limit > 1000
      ) {
        throw invalidRequest(
          "Historical range, interval, or limit is invalid.",
        );
      }

      const provider = adapterFor(assetClass);
      const result = await callAdapter(() =>
        provider.getHistoricalPrices(normalizedSymbol, {
          interval,
          from: numericFrom,
          to: numericTo,
          limit,
        }),
      );
      const normalized = assertHistoricalPrices(
        result,
        normalizedSymbol,
        assetClass,
        interval,
      );
      return { ...normalized, prices: normalized.prices.slice(0, limit) };
    },

    /**
     * Get an asset-class overview. `assetClass` is required because the API
     * contract has not yet defined a cross-market stock/crypto overview.
     */
    async getMarketOverview(options = {}) {
      if (!options.assetClass) {
        throw invalidRequest(
          "An assetClass is required for a market overview.",
        );
      }
      const assetClass = normalizeAssetClass(options.assetClass);
      const limit = options.limit === undefined ? 10 : Number(options.limit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
        throw invalidRequest(
          "Overview limit must be an integer from 1 to 100.",
        );
      }
      const provider = adapterFor(assetClass);
      const result = await callAdapter(() =>
        provider.getMarketOverview({ ...options, assetClass, limit }),
      );
      return assertOverview(result, assetClass);
    },

    /**
     * Search one asset class or both configured classes. Results use common
     * symbol/name/assetClass/exchange/currency/type/source fields.
     */
    async searchSymbols(query, options = {}) {
      if (typeof query !== "string" || !query.trim()) {
        throw invalidRequest("A symbol search query is required.");
      }
      const normalizedQuery = query.trim();
      const assetClasses = options.assetClass
        ? [normalizeAssetClass(options.assetClass)]
        : ["STOCK", "CRYPTO"];
      const limit = options.limit === undefined ? null : Number(options.limit);
      if (
        limit !== null &&
        (!Number.isInteger(limit) || limit < 1 || limit > 100)
      ) {
        throw invalidRequest("Search limit must be an integer from 1 to 100.");
      }
      const results = await Promise.all(
        assetClasses.map(async (assetClass) => {
          const provider = adapterFor(assetClass);
          const values = await callAdapter(() =>
            provider.searchSymbols(normalizedQuery),
          );
          return assertSearchResults(values, assetClass);
        }),
      );
      const combined = results.flat();
      if (limit !== null) return combined.slice(0, limit);
      return combined;
    },
  };
}

module.exports = {
  createMarketDataService,
};
