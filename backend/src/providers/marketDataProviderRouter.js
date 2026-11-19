const {
  createMarketDataError,
  mapProviderError,
} = require("./marketDataErrors");
const {
  GLOBAL_REGION,
  inferMarketRegion,
  providerSupportsMarket,
} = require("./marketRouting");
const logger = require("../utils/logger");

const OPERATION_METHODS = Object.freeze({
  quote: "getQuote",
  history: "getHistoricalPrices",
  overview: "getMarketOverview",
  search: "searchSymbols",
});

// Client mistakes are provider-independent and must be returned immediately.
// Every other domain failure means "this provider could not serve the request",
// so the router tries the next provider in the configured chain.
const FALLBACK_ERROR_CODES = new Set([
  "MARKET_DATA_NOT_CONFIGURED",
  "MARKET_DATA_INVALID_CREDENTIALS",
  "MARKET_DATA_RATE_LIMITED",
  "MARKET_DATA_TIMEOUT",
  "MARKET_DATA_INVALID_RESPONSE",
  "MARKET_DATA_PROVIDER_UNAVAILABLE",
  "MARKET_DATA_NOT_FOUND",
]);

/**
 * Provider router.
 *
 * Owns chain resolution, capability/market filtering, provider-specific symbol
 * translation, and failover. It is deliberately independent of any concrete
 * provider and of the market-data service's response validation, so the same
 * routing rules can be reused by future consumers (streaming, workers, or an
 * admin health view).
 */
function createMarketDataProviderRouter({
  config,
  providers = {},
  log = logger,
} = {}) {
  function providerChainFor(assetClass) {
    const chain = config?.providerChains?.[assetClass];
    if (Array.isArray(chain) && chain.length > 0) return chain;

    // Backwards compatibility for callers that only provide the legacy
    // single-provider selection.
    const primary = config?.providerByAssetClass?.[assetClass];
    if (primary) return [primary];

    throw createMarketDataError(
      `No market-data provider is configured for ${assetClass}.`,
      503,
      "MARKET_DATA_NOT_CONFIGURED",
    );
  }

  function supportsOperation(adapter, operation) {
    const method = OPERATION_METHODS[operation];
    if (!method || typeof adapter?.[method] !== "function") return false;
    if (Array.isArray(adapter.operations)) {
      return adapter.operations.includes(operation);
    }
    return true;
  }

  function supportsAssetClass(adapter, assetClass) {
    return (
      !Array.isArray(adapter.assetClasses) ||
      adapter.assetClasses.includes(assetClass)
    );
  }

  function candidatesFor({ assetClass, operation, resolved }) {
    const rawChain = providerChainFor(assetClass);
    const chain = [...new Set(rawChain)];
    const region = resolved
      ? assetClass === "CRYPTO"
        ? GLOBAL_REGION
        : inferMarketRegion(resolved.canonicalSymbol)
      : null;
    const candidates = [];

    for (const providerId of chain) {
      const adapter = providers[providerId];
      if (!adapter) {
        log.warn("Configured market data provider not registered", {
          provider: providerId,
          assetClass,
        });
        continue;
      }
      if (!supportsAssetClass(adapter, assetClass)) continue;
      if (!supportsOperation(adapter, operation)) continue;
      // Overview and search are market-wide, not symbol-specific, so their
      // region is unknown and providers are not filtered by region.
      if (region && !providerSupportsMarket(adapter, region)) continue;
      candidates.push(adapter);
    }

    if (candidates.length === 0) {
      throw createMarketDataError(
        "The configured market-data provider is unavailable.",
        503,
        "MARKET_DATA_PROVIDER_UNAVAILABLE",
      );
    }

    return candidates;
  }

  function providerSymbolFor(adapter, resolved) {
    if (typeof adapter.toProviderSymbol === "function") {
      return adapter.toProviderSymbol(resolved.canonicalSymbol, {
        assetClass: resolved.assetClass,
      });
    }

    // Adapters written before the provider contract gained symbol translation
    // (including test doubles) keep receiving the resolved provider symbol.
    return resolved.providerSymbol || resolved.canonicalSymbol;
  }

  function shouldFallback(error) {
    return FALLBACK_ERROR_CODES.has(error?.code);
  }

  /**
   * Run one operation through the ordered chain.
   *
   * `invoke(adapter, providerSymbol)` performs the actual call and returns the
   * validated normalized result. Failures thrown by the adapter or by
   * validation are mapped to safe domain errors here.
   */
  async function run({ assetClass, operation, resolved, invoke }) {
    const candidates = candidatesFor({ assetClass, operation, resolved });
    let lastError = null;

    for (let index = 0; index < candidates.length; index += 1) {
      const adapter = candidates[index];

      try {
        const providerSymbol = resolved
          ? providerSymbolFor(adapter, resolved)
          : undefined;
        return await invoke(adapter, providerSymbol);
      } catch (error) {
        const mapped = mapProviderError(error);
        lastError = mapped;

        const next = candidates[index + 1];
        if (!next || !shouldFallback(mapped)) throw mapped;

        log.warn("Market data provider failed; trying fallback", {
          operation,
          assetClass,
          provider: adapter.id || "unknown",
          fallback: next.id || "unknown",
          code: mapped.code,
        });
      }
    }

    throw lastError;
  }

  return { candidatesFor, providerChainFor, run };
}

module.exports = {
  FALLBACK_ERROR_CODES,
  OPERATION_METHODS,
  createMarketDataProviderRouter,
};
