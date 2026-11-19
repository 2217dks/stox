/**
 * Crypto quote assets supported by the market-data layer.
 *
 * Binance lists many quote assets. These are the ones the app can infer,
 * validate, display, and price consistently. Keep this list in sync with the
 * frontend constant in `frontend/lib/constants.js`.
 *
 * Longer ids are listed first so suffix matching is unambiguous.
 */
const CRYPTO_QUOTE_ASSETS = Object.freeze([
  "FDUSD",
  "USDT",
  "USDC",
  "TUSD",
  "BUSD",
  "BTC",
  "ETH",
]);

const CRYPTO_QUOTE_ASSET_SET = new Set(CRYPTO_QUOTE_ASSETS);

/**
 * Broad Binance quote-asset hints used for display/currency only. These never
 * gate requests; they only help label a pair returned by the provider.
 */
const BINANCE_QUOTE_ASSETS = Object.freeze([
  "FDUSD",
  "RLUSD",
  "USDT",
  "USDC",
  "TUSD",
  "BUSD",
  "USDS",
  "USD1",
  "EURI",
  "USDP",
  "BTC",
  "ETH",
  "BNB",
  "XRP",
  "SOL",
  "TRY",
  "EUR",
  "ZAR",
  "BRL",
  "ARS",
  "JPY",
  "MXN",
  "COP",
  "IDR",
  "KZT",
  "AED",
  "THB",
  "USD",
  "U",
]);

module.exports = {
  BINANCE_QUOTE_ASSETS,
  CRYPTO_QUOTE_ASSETS,
  CRYPTO_QUOTE_ASSET_SET,
};
