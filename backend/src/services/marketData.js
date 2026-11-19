require("dotenv").config();

const { loadMarketDataConfig } = require("../config/marketDataConfig");
const {
  createMarketDataProviders,
} = require("../providers/createMarketDataProviders");
const { createMarketDataService } = require("./marketDataService");
const {
  inferAssetClass,
  normalizeAssetClass,
  resolveSymbol,
} = require("./symbolMappingService");
const {
  assertQuoteFreshness,
  evaluateQuoteFreshness,
} = require("../utils/quoteFreshness");
const cacheService = require("./cacheService");

const config = loadMarketDataConfig();

const marketDataService = createMarketDataService({
  config,
  providers: createMarketDataProviders(config),
});

module.exports = {
  ...marketDataService,

  async getQuote(symbol, options = {}) {
    const resolved = await resolveSymbol(symbol, options);

    const bypass = Boolean(
      options.bypass === true ||
        options.bypassCache === true ||
        options.skipCache === true ||
        options.noCache === true,
    );

    const getQuoteCallback = () =>
      marketDataService.getQuote(resolved.canonicalSymbol, {
        ...options,
        rejectStale: false,
        maxAgeSeconds: undefined,
        assetClass: resolved.assetClass,
        _resolved: resolved,
      });

    let quote;
    if (bypass) {
      quote = await cacheService.getOrSetPrice(
        resolved.assetClass,
        resolved.canonicalSymbol,
        getQuoteCallback,
        { ...options, bypass, assetClass: resolved.assetClass },
      );
    } else {
      quote = await cacheService.getOrSetPrice(
        resolved.assetClass,
        resolved.canonicalSymbol,
        getQuoteCallback,
      );
    }

    return assertQuoteFreshness(quote, {
      config,
      assetClass: resolved.assetClass,
      ...options,
    });
  },

  /**
   * Fetch many quotes for one request.
   *
   * Each symbol goes through the normal cached getQuote path, so repeated
   * symbols across clients still hit the 5-second price cache. Failed symbols
   * are omitted instead of failing the whole batch; the caller renders them
   * as unavailable.
   */
  async getQuotes(symbols = [], options = {}) {
    const assetTypes = options.assetTypes || {};
    const results = await Promise.allSettled(
      symbols.map((symbol) => {
        const assetClass =
          assetTypes[symbol] ||
          assetTypes[symbol.toUpperCase()] ||
          options.assetClass;
        return this.getQuote(symbol, { ...options, assetClass });
      }),
    );

    return results
      .filter((result) => result.status === "fulfilled")
      .map((result) => result.value);
  },

  async searchSymbols(query, options = {}) {
    if (typeof query !== "string" || !query.trim()) {
      return marketDataService.searchSymbols(query, options);
    }

    return cacheService.getOrSetMarketSearch(query, options, () =>
      marketDataService.searchSymbols(query, options),
    );
  },

  async getHistoricalPrice(symbol, options = {}) {
    const resolved = await resolveSymbol(symbol, options);
    const asOf = options.asOf
      ? (options.asOf instanceof Date ? options.asOf : new Date(options.asOf))
      : new Date();
    const toMs = Math.min(asOf.getTime(), Date.now());
    const fromMs = Math.max(0, toMs - 7 * 24 * 60 * 60 * 1000);

    // Nightly snapshots ask for the same symbol-day once per portfolio. Without
    // this cache a 200-portfolio run fetches the same close 200 times.
    const history = await cacheService.getOrSetHistoricalPrices(
      resolved.assetClass,
      resolved.canonicalSymbol,
      "1d",
      fromMs,
      toMs,
      10,
      () =>
        marketDataService.getHistoricalPrices(resolved.canonicalSymbol, {
          interval: "1d",
          from: fromMs,
          to: toMs,
          limit: 10,
          assetClass: resolved.assetClass,
          ...options,
          _resolved: resolved,
        }),
    );

    if (!history || !Array.isArray(history.prices) || history.prices.length === 0) {
      throw new Error(`Historical price unavailable for ${resolved.canonicalSymbol} as of ${asOf.toISOString()}`);
    }

    const eligible = history.prices.filter(
      (c) => new Date(c.timestamp).getTime() <= toMs,
    );
    if (eligible.length === 0) {
      throw new Error(`No historical candle found for ${resolved.canonicalSymbol} on or before ${asOf.toISOString()}`);
    }

    const candle = eligible[eligible.length - 1];
    return {
      symbol: resolved.canonicalSymbol,
      price: candle.close,
      timestamp: candle.timestamp,
    };
  },
};
