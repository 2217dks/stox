/**
 * Market/region routing helpers.
 *
 * A provider may only serve a subset of markets (for example a US-only stock
 * feed). These helpers let the market-data service choose candidates by
 * instrument region without knowing any provider's implementation, so a
 * country-specific provider can be added by declaring metadata alone.
 */

// ISO 3166-1 alpha-2 region for common Yahoo/exchange suffixes. Symbols
// without one of these suffixes are treated as US listings, which preserves
// the historical Finnhub default and keeps dotted US tickers such as BRK.B.
const EXCHANGE_SUFFIX_REGION = Object.freeze({
  L: "GB",
  T: "JP",
  NS: "IN",
  BO: "IN",
  TO: "CA",
  V: "CA",
  AX: "AU",
  HK: "HK",
  DE: "DE",
  F: "DE",
  PA: "FR",
  AS: "NL",
  MI: "IT",
  MC: "ES",
  ST: "SE",
  OL: "NO",
  CO: "DK",
  HE: "FI",
  SW: "CH",
  SI: "SG",
  KS: "KR",
  KQ: "KR",
  TW: "TW",
  SS: "CN",
  SZ: "CN",
  SA: "BR",
  MX: "MX",
});

const DEFAULT_STOCK_REGION = "US";
const GLOBAL_REGION = "GLOBAL";

/**
 * Infer the listing region from a canonical symbol.
 *
 * Exchange suffixes are intentionally conservative: only known suffixes change
 * the default, so a dotted US ticker like `BRK.B` stays in `US` rather than
 * routing to a global provider.
 */
function inferMarketRegion(symbol) {
  const value = typeof symbol === "string" ? symbol.trim().toUpperCase() : "";
  const match = /\.([A-Z]{1,2})$/.exec(value);
  const suffix = match?.[1];
  return (suffix && EXCHANGE_SUFFIX_REGION[suffix]) || DEFAULT_STOCK_REGION;
}

/**
 * Decide whether an adapter declares support for a region.
 *
 * Missing metadata means "no restriction" so test doubles and simple adapters
 * keep working. `"*"` means every region. A provider that declares concrete
 * regions is filtered out elsewhere instead of being called and failing.
 */
function providerSupportsMarket(provider, region) {
  const markets = provider?.markets;
  if (!Array.isArray(markets) || markets.length === 0) return true;
  if (markets.includes("*")) return true;
  return markets.includes(region);
}

module.exports = {
  DEFAULT_STOCK_REGION,
  EXCHANGE_SUFFIX_REGION,
  GLOBAL_REGION,
  inferMarketRegion,
  providerSupportsMarket,
};
