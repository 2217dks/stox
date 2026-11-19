const { loadMarketDataConfig } = require("../config/marketDataConfig");
const {
  createMarketQuoteDto,
  normalizeQuoteDecimal,
  normalizeQuoteTimestamp,
} = require("../dtos/marketQuoteDto");
const {
  DEFAULT_HISTORICAL_LIMIT,
  isValidHistoricalRange,
} = require("../utils/historicalRange");
const {
  createMarketDataError,
  mapProviderError,
} = require("../providers/marketDataErrors");
const {
  assertQuoteFreshness,
  evaluateQuoteFreshness,
} = require("../utils/quoteFreshness");
const {
  createMarketDataProviderRouter,
} = require("../providers/marketDataProviderRouter");

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
const {
  normalizeSymbol,
  normalizeAssetClass,
  inferAssetClass,
  resolveSymbol,
} = require("./symbolMappingService");

function invalidRequest(message) {
  return createMarketDataError(message, 400, "MARKET_DATA_INVALID_REQUEST");
}

/**
 * Round-robin merge of per-asset-class result groups.
 *
 * A plain `flat()` followed by `slice(limit)` lets the first asset class fill
 * every slot, so a query such as "BTC" returns eight stock ETFs and hides the
 * crypto pairs entirely. Interleaving keeps both classes visible while
 * preserving each provider's relevance order.
 */
function interleaveResults(groups) {
  const merged = [];
  const longest = groups.reduce(
    (length, group) => Math.max(length, group.length),
    0,
  );

  for (let index = 0; index < longest; index += 1) {
    for (const group of groups) {
      if (group[index]) merged.push(group[index]);
    }
  }

  return merged;
}

function isDecimalString(value) {
  return (
    typeof value === "string" &&
    value.trim() !== "" &&
    Number.isFinite(Number(value))
  );
}

function isValidIsoTimestamp(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
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
  const prices = value.prices.map((candle) => {
    const timestamp = normalizeQuoteTimestamp(candle?.timestamp);
    const normalized = Object.fromEntries(
      ["open", "high", "low", "close", "volume"].map((key) => [
        key,
        normalizeQuoteDecimal(candle?.[key]),
      ]),
    );
    if (
      !candle ||
      timestamp === undefined ||
      timestamp === null ||
      Object.values(normalized).some((number) => number === undefined) ||
      ["open", "high", "low", "close"].some(
        (key) => normalized[key] === "0" || normalized[key].startsWith("-"),
      ) ||
      normalized.volume.startsWith("-")
    ) {
      throw createMarketDataError(
        "Market data provider returned an invalid response.",
        502,
        "MARKET_DATA_INVALID_RESPONSE",
      );
    }
    return { timestamp, ...normalized };
  });
  prices.sort(
    (left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp),
  );
  return { symbol, assetClass, interval, prices };
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
    !(value.movers === null || Array.isArray(value.movers)) ||
    typeof value.source !== "string" ||
    !value.source.trim() ||
    (Array.isArray(value.movers) &&
      value.movers.some(
        (mover) =>
          !mover ||
          typeof mover !== "object" ||
          typeof mover.symbol !== "string" ||
          !mover.symbol.trim() ||
          !isDecimalString(mover.price) ||
          !isDecimalString(mover.changePercent) ||
          (mover.quoteVolume !== null && !isDecimalString(mover.quoteVolume)),
      ))
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
  return value.map((item) => ({
    symbol: item.symbol.trim().toUpperCase(),
    name: item.name.trim(),
    assetClass,
    exchange: item.exchange?.trim().toUpperCase() || null,
    currency: item.currency?.trim().toUpperCase() || null,
    type: item.type?.trim() || null,
    source: item.source.trim().toLowerCase(),
  }));
}

/**
 * Create a provider-independent market-data service.
 *
 * Adapters are keyed by provider id and implement getQuote(symbol),
 * getHistoricalPrices(symbol, options), getMarketOverview(options), and
 * searchSymbols(query). Each method returns the normalized domain shapes
 * documented in docs/MARKET_DATA_SERVICE.md. Adapters may be replaced without
 * changing service callers. Configuration supplies an ordered provider chain
 * per asset class; the service filters by declared capability and market and
 * falls through provider-side failures to the next candidate.
 */
function createMarketDataService({ config, providers } = {}) {
  const marketConfig = config || loadMarketDataConfig();
  const providerAdapters = providers || {};

  const router = createMarketDataProviderRouter({
    config: marketConfig,
    providers: providerAdapters,
  });

  async function runOperation({ assetClass, operation, resolved, invoke }) {
    try {
      return await router.run({
        assetClass,
        operation,
        resolved,
        invoke,
      });
    } catch (error) {
      throw mapProviderError(error);
    }
  }

  return {
    /**
     * Get one current quote. `options.assetClass` may be STOCK or CRYPTO;
     * otherwise BINANCE-prefixed symbols and well-formed crypto pairs such as
     * BTCUSDT or ETHBTC are treated as crypto. Ambiguous single-token symbols
     * default to stocks so tickers like GBTC are never silently routed to
     * Binance. Prices and changes are decimal strings.
     */
    async getQuote(symbol, options = {}) {
      const resolved = await resolveSymbol(symbol, options);
      const quote = await runOperation({
        assetClass: resolved.assetClass,
        operation: "quote",
        resolved,
        invoke: async (provider, providerSymbol) =>
          assertQuote(
            await provider.getQuote(providerSymbol),
            resolved.assetClass,
          ),
      });
      return assertQuoteFreshness(quote, {
        config: marketConfig,
        ...options,
      });
    },

    /**
     * Get OHLCV history. `from` and `to` are inclusive Unix epoch
     * milliseconds, `interval` is one of 1m/5m/15m/30m/1h/4h/1d/1w/1M,
     * and `limit` defaults to 500 (maximum 1000). Future end dates and ranges
     * longer than `limit` interval periods are rejected.
     */
    async getHistoricalPrices(symbol, options = {}) {
      const resolved = await resolveSymbol(symbol, options);
      const { interval } = options;
      const from = Number(options.from);
      const to = Number(options.to);
      const numericFrom = Number(from);
      const numericTo = Number(to);
      const limit =
        options.limit === undefined
          ? DEFAULT_HISTORICAL_LIMIT
          : Number(options.limit);
      if (
        !HISTORICAL_INTERVALS.has(interval) ||
        !isValidHistoricalRange({
          interval,
          from: numericFrom,
          to: numericTo,
          limit,
        })
      ) {
        throw invalidRequest(
          "Historical range, interval, or limit is invalid or exceeds the supported window.",
        );
      }

      const normalized = await runOperation({
        assetClass: resolved.assetClass,
        operation: "history",
        resolved,
        invoke: async (provider, providerSymbol) =>
          assertHistoricalPrices(
            await provider.getHistoricalPrices(providerSymbol, {
              interval,
              from: numericFrom,
              to: numericTo,
              limit,
            }),
            resolved.canonicalSymbol,
            resolved.assetClass,
            interval,
          ),
      });
      // The window always ends at `to`, so keep the newest candles. Providers
      // can return limit+1 rows for a window that includes a partial period.
      return { ...normalized, prices: normalized.prices.slice(-limit) };
    },

    /**
     * Get an asset-class overview. `assetClass` is required because the API
     * contract exposes an asset-class-specific overview.
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
      return runOperation({
        assetClass,
        operation: "overview",
        resolved: null,
        invoke: async (provider) =>
          assertOverview(
            await provider.getMarketOverview({
              ...options,
              assetClass,
              limit,
            }),
            assetClass,
          ),
      });
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
          return runOperation({
            assetClass,
            operation: "search",
            resolved: null,
            invoke: async (provider) =>
              assertSearchResults(
                await provider.searchSymbols(normalizedQuery),
                assetClass,
              ),
          });
        }),
      );
      if (limit === null) return results.flat();
      if (assetClasses.length > 1) {
        return interleaveResults(results).slice(0, limit);
      }
      return results.flat().slice(0, limit);
    },
  };
}

module.exports = {
  createMarketDataService,
  normalizeAssetClass,
  normalizeSymbol,
  assertQuoteFreshness,
  evaluateQuoteFreshness,
  inferAssetClass,
  resolveSymbol,
};
