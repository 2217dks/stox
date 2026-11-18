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

    const history = await marketDataService.getHistoricalPrices(
      resolved.canonicalSymbol,
      {
        interval: "1d",
        from: fromMs,
        to: toMs,
        limit: 10,
        assetClass: resolved.assetClass,
        ...options,
        _resolved: resolved,
      },
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
