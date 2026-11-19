const { AppError } = require("../utils/errors");
const { createMarketDataError } = require("../providers/marketDataErrors");
const { CRYPTO_QUOTE_ASSETS } = require("../utils/cryptoQuoteAssets");

const ASSET_CLASSES = Object.freeze(["STOCK", "CRYPTO"]);
const ASSET_CLASS_SET = new Set(ASSET_CLASSES);

const SUPPORTED_PROVIDERS = Object.freeze(["binance", "finnhub"]);
const PROVIDER_SET = new Set(SUPPORTED_PROVIDERS);

const DEFAULT_PROVIDER_BY_ASSET_CLASS = Object.freeze({
  CRYPTO: "binance",
  STOCK: "finnhub",
});

const DEFAULT_ASSET_CLASS_BY_PROVIDER = Object.freeze({
  binance: "CRYPTO",
  finnhub: "STOCK",
});

const CRYPTO_QUOTE_ASSET_SET = new Set(CRYPTO_QUOTE_ASSETS);

const MAJOR_CRYPTO_BASE_ASSETS = Object.freeze([
  "BTC",
  "ETH",
  "SOL",
  "BNB",
  "XRP",
  "DOGE",
  "ADA",
  "AVAX",
  "DOT",
  "MATIC",
  "LINK",
  "LTC",
  "BCH",
  "UNI",
  "ATOM",
  "XLM",
  "NEAR",
  "ALGO",
]);
const MAJOR_CRYPTO_BASE_ASSET_SET = new Set(MAJOR_CRYPTO_BASE_ASSETS);

const CRYPTO_PAIR_PATTERN = new RegExp(
  `^([A-Z0-9]{2,20})(?:${CRYPTO_QUOTE_ASSETS.join("|")})$`,
);

const CRYPTO_SLASH_PATTERN = new RegExp(
  `^([A-Z0-9]{2,20})\\/(${CRYPTO_QUOTE_ASSETS.join("|")})$`,
);

const STOCK_TICKER_PATTERN = /^[A-Z0-9]+(?:[._-][A-Z0-9]+)*$/;

// Stock tickers whose letters happen to end in a crypto quote asset (e.g. BTC, ETH)
// or overlap with well-known crypto tickers, preventing false crypto inference.
const KNOWN_AMBIGUOUS_STOCKS = new Set([
  "GBTC",
  "METH",
  "SOL",
  "COIN",
  "RIOT",
  "MARA",
  "HUT",
  "BITO",
  "ETHE",
  "OBTC",
  "FBTC",
  "IBIT",
  "ARKB",
  "BTCO",
  "EZBC",
  "BRRR",
  "HODL",
  "BTCW",
]);

let defaultPrismaInstance = null;
function getDefaultPrisma() {
  if (!defaultPrismaInstance) {
    try {
      defaultPrismaInstance = require("../config/database");
    } catch {
      defaultPrismaInstance = null;
    }
  }
  return defaultPrismaInstance;
}

/**
 * Parse a raw symbol into its provider prefix (if any) and clean symbol ticker.
 * Validates basic characters and ensures only supported prefixes are present.
 */
function parseProviderPrefix(symbol) {
  if (typeof symbol !== "string" || !symbol.trim()) {
    throw createMarketDataError(
      "A symbol is required.",
      400,
      "MARKET_DATA_INVALID_REQUEST",
    );
  }
  const value = symbol.trim().toUpperCase();
  if (!/^[A-Z0-9._:/-]{1,30}$/.test(value)) {
    throw createMarketDataError(
      "The symbol format is invalid.",
      400,
      "MARKET_DATA_INVALID_REQUEST",
    );
  }

  let prefix = null;
  let clean = value;

  if (value.startsWith("FINNHUB:")) {
    prefix = "FINNHUB";
    clean = value.slice("FINNHUB:".length);
  } else if (value.startsWith("BINANCE:")) {
    prefix = "BINANCE";
    clean = value.slice("BINANCE:".length);
  } else if (value.includes(":")) {
    throw createMarketDataError(
      "The symbol format is invalid.",
      400,
      "MARKET_DATA_INVALID_REQUEST",
    );
  }

  if (!clean || !/^[A-Z0-9._/-]{1,25}$/.test(clean)) {
    throw createMarketDataError(
      "The symbol format is invalid.",
      400,
      "MARKET_DATA_INVALID_REQUEST",
    );
  }

  if ((clean.match(/\//g) || []).length > 1) {
    throw createMarketDataError(
      "The symbol format is invalid.",
      400,
      "MARKET_DATA_INVALID_REQUEST",
    );
  }

  return { raw: value, prefix, clean };
}

/**
 * Validate and normalize a raw symbol string.
 * Ensures non-empty, trimmed, uppercase, and valid characters.
 */
function normalizeSymbol(symbol, options = {}) {
  const { raw, prefix, clean } = parseProviderPrefix(symbol);

  if (!options.skipPrefixValidation) {
    if (prefix === "FINNHUB") {
      if (clean.includes("/") || isUnambiguousCryptoSymbol(clean)) {
        throw createMarketDataError(
          "A valid stock ticker symbol is required.",
          400,
          "MARKET_DATA_INVALID_REQUEST",
        );
      }
    }

    if (prefix === "BINANCE") {
      const isCryptoSlash = CRYPTO_SLASH_PATTERN.test(clean);
      const isCryptoPair =
        CRYPTO_PAIR_PATTERN.test(clean) && !KNOWN_AMBIGUOUS_STOCKS.has(clean);
      if (!isCryptoSlash && !isCryptoPair) {
        throw createMarketDataError(
          "The cryptocurrency symbol format is invalid.",
          400,
          "MARKET_DATA_INVALID_REQUEST",
        );
      }
    }
  }

  return raw;
}

/**
 * Determine whether a symbol represents an unambiguous crypto instrument notation
 * (e.g. BTCUSDT, ETHBTC, BTC/USDT, BINANCE:BTCUSDT).
 * An explicit STOCK override must not contradict these formats.
 */
function isUnambiguousCryptoSymbol(symbol) {
  if (typeof symbol !== "string" || !symbol.trim()) {
    return false;
  }
  const upper = symbol.trim().toUpperCase();
  if (upper.startsWith("BINANCE:")) {
    return true;
  }
  const clean = upper.replace(/^(?:BINANCE|FINNHUB):/, "");
  if (clean.includes("/") || CRYPTO_SLASH_PATTERN.test(clean)) {
    return true;
  }
  if (KNOWN_AMBIGUOUS_STOCKS.has(clean)) {
    return false;
  }
  const pairMatch = CRYPTO_PAIR_PATTERN.exec(clean);
  if (pairMatch) {
    const base = pairMatch[1];
    if (MAJOR_CRYPTO_BASE_ASSET_SET.has(base)) {
      return true;
    }
  }
  return false;
}

/**
 * Infer asset class (STOCK or CRYPTO) from symbol syntax and known conventions.
 * Does not misclassify stock tickers that end in crypto quote assets (e.g. GBTC, METH).
 */
function inferAssetClass(symbol) {
  if (typeof symbol !== "string" || !symbol.trim()) {
    return "STOCK";
  }
  const upper = symbol.trim().toUpperCase();

  if (upper.startsWith("BINANCE:")) {
    return "CRYPTO";
  }
  if (upper.startsWith("FINNHUB:")) {
    return "STOCK";
  }

  const clean = upper.replace(/^(?:BINANCE|FINNHUB):/, "");

  if (CRYPTO_SLASH_PATTERN.test(clean)) {
    return "CRYPTO";
  }

  if (KNOWN_AMBIGUOUS_STOCKS.has(clean)) {
    return "STOCK";
  }

  if (CRYPTO_PAIR_PATTERN.test(clean)) {
    return "CRYPTO";
  }

  // Pair conventions are not restricted to a quote whitelist. A plain symbol
  // of at least six characters is pair-shaped (ETHBTC, HYPERTRY, 1000SATSUSDT)
  // while common stock tickers are shorter or use a dot/hyphen.
  return /^[A-Z0-9]{6,30}$/.test(clean) ? "CRYPTO" : "STOCK";
}

/**
 * Validate and normalize an asset class.
 * If value is provided, enforces that it is STOCK or CRYPTO.
 * If omitted, infers from symbol.
 */
function normalizeAssetClass(value, symbol) {
  if (value !== undefined && value !== null && String(value).trim() !== "") {
    const assetClass = String(value).trim().toUpperCase();
    if (!ASSET_CLASS_SET.has(assetClass)) {
      throw createMarketDataError(
        "Market data is not supported for this asset class.",
        422,
        "MARKET_DATA_UNSUPPORTED_ASSET_CLASS",
      );
    }
    if (symbol && typeof symbol === "string") {
      const upper = symbol.trim().toUpperCase();
      if (upper.startsWith("FINNHUB:") && assetClass === "CRYPTO") {
        throw createMarketDataError(
          "Market data is not supported for this asset class.",
          422,
          "MARKET_DATA_UNSUPPORTED_ASSET_CLASS",
        );
      }
      if (upper.startsWith("BINANCE:") && assetClass === "STOCK") {
        throw createMarketDataError(
          "Market data is not supported for this asset class.",
          422,
          "MARKET_DATA_UNSUPPORTED_ASSET_CLASS",
        );
      }
      if (
        assetClass === "STOCK" &&
        isUnambiguousCryptoSymbol(upper)
      ) {
        throw createMarketDataError(
          "Market data is not supported for this asset class.",
          422,
          "MARKET_DATA_UNSUPPORTED_ASSET_CLASS",
        );
      }
    }
    return assetClass;
  }
  return inferAssetClass(symbol);
}

/**
 * Convert any client notation, provider prefix, or slash format into Stox's
 * canonical, provider-agnostic internal symbol representation (e.g. "BTCUSDT", "AAPL").
 */
function toCanonicalSymbol(symbol, options = {}) {
  const normalized = normalizeSymbol(symbol);
  const unprefixed = normalized.replace(/^(?:BINANCE|FINNHUB):/, "");

  const assetClass = options.assetClass
    ? String(options.assetClass).trim().toUpperCase()
    : null;

  if (assetClass && !ASSET_CLASS_SET.has(assetClass)) {
    throw createMarketDataError(
      "Market data is not supported for this asset class.",
      422,
      "MARKET_DATA_UNSUPPORTED_ASSET_CLASS",
    );
  }

  // Reject conflicting prefixes and explicit asset classes
  if (normalized.startsWith("FINNHUB:") && assetClass === "CRYPTO") {
    throw createMarketDataError(
      "Market data is not supported for this asset class.",
      422,
      "MARKET_DATA_UNSUPPORTED_ASSET_CLASS",
    );
  }

  if (normalized.startsWith("BINANCE:") && assetClass === "STOCK") {
    throw createMarketDataError(
      "Market data is not supported for this asset class.",
      422,
      "MARKET_DATA_UNSUPPORTED_ASSET_CLASS",
    );
  }

  // Reject unambiguous crypto notation with conflicting STOCK asset class
  if (
    assetClass === "STOCK" &&
    (isUnambiguousCryptoSymbol(normalized) ||
      unprefixed.includes("/") ||
      CRYPTO_SLASH_PATTERN.test(unprefixed))
  ) {
    throw createMarketDataError(
      "Market data is not supported for this asset class.",
      422,
      "MARKET_DATA_UNSUPPORTED_ASSET_CLASS",
    );
  }

  const slashMatch = CRYPTO_SLASH_PATTERN.exec(unprefixed);
  if (slashMatch) {
    return `${slashMatch[1]}${slashMatch[2]}`;
  }

  if (assetClass === "CRYPTO" && unprefixed.includes("/")) {
    return unprefixed.replace(/\//g, "");
  }

  return unprefixed;
}

/**
 * Convert a canonical (or raw) symbol to the exact identifier expected by
 * that provider's REST API or websocket stream.
 */
function toProviderSymbol(symbol, providerId, options = {}) {
  const canonical = toCanonicalSymbol(symbol, options);
  const normalizedProvider = String(providerId || "").trim().toLowerCase();

  if (!PROVIDER_SET.has(normalizedProvider)) {
    throw createMarketDataError(
      "The configured market-data provider is unavailable.",
      503,
      "MARKET_DATA_PROVIDER_UNAVAILABLE",
    );
  }

  const explicitAssetClass = options.assetClass
    ? String(options.assetClass).trim().toUpperCase()
    : null;

  if (normalizedProvider === "binance") {
    if (explicitAssetClass && explicitAssetClass !== "CRYPTO") {
      throw createMarketDataError(
        "Market data is not supported for this asset class.",
        422,
        "MARKET_DATA_UNSUPPORTED_ASSET_CLASS",
      );
    }

    if (CRYPTO_PAIR_PATTERN.test(canonical)) {
      return canonical;
    }

    // No quote-asset whitelist: an explicit crypto request is trusted and the
    // provider decides whether the pair exists. Short symbols are treated as a
    // base asset and default to USDT; longer symbols are passed through as the
    // caller supplied pair (for example HYPERTRY or HYPEREUR).
    if (explicitAssetClass === "CRYPTO") {
      if (/^[A-Z0-9]{6,30}$/.test(canonical)) return canonical;
      if (/^[A-Z0-9]{2,5}$/.test(canonical)) {
        const quote = options.quoteAsset || "USDT";
        return `${canonical}${quote}`;
      }
    }

    throw createMarketDataError(
      "The cryptocurrency symbol format is invalid.",
      400,
      "MARKET_DATA_INVALID_REQUEST",
    );
  }

  if (normalizedProvider === "finnhub") {
    if (explicitAssetClass && explicitAssetClass !== "STOCK") {
      throw createMarketDataError(
        "Market data is not supported for this asset class.",
        422,
        "MARKET_DATA_UNSUPPORTED_ASSET_CLASS",
      );
    }

    if (!STOCK_TICKER_PATTERN.test(canonical)) {
      throw createMarketDataError(
        "A valid stock ticker symbol is required.",
        400,
        "MARKET_DATA_INVALID_REQUEST",
      );
    }

    return canonical;
  }

  return canonical;
}

/**
 * Format a canonical symbol for human display in UIs and logs.
 * E.g. "BTCUSDT" -> "BTC/USDT", "AAPL" -> "AAPL".
 */
function toDisplaySymbol(symbol, options = {}) {
  const canonical = toCanonicalSymbol(symbol, options);
  const assetClass = normalizeAssetClass(options.assetClass, symbol);

  if (assetClass === "CRYPTO") {
    const quote = CRYPTO_QUOTE_ASSETS.find((q) => canonical.endsWith(q));
    if (quote && canonical.length > quote.length) {
      const base = canonical.slice(0, -quote.length);
      return `${base}/${quote}`;
    }
  }

  return canonical;
}

/**
 * Parse a symbol into a structured metadata object.
 */
function parseSymbol(symbol, options = {}) {
  const normalized = normalizeSymbol(symbol);
  const canonicalSymbol = toCanonicalSymbol(normalized, options);
  const assetClass = normalizeAssetClass(options.assetClass, normalized);
  const provider = DEFAULT_PROVIDER_BY_ASSET_CLASS[assetClass] || null;
  const displaySymbol = toDisplaySymbol(canonicalSymbol, { assetClass });

  let baseAsset = null;
  let quoteAsset = null;
  let exchange = provider ? provider.toUpperCase() : null;

  if (assetClass === "CRYPTO") {
    const quote = CRYPTO_QUOTE_ASSETS.find((q) => canonicalSymbol.endsWith(q));
    if (quote && canonicalSymbol.length > quote.length) {
      quoteAsset = quote;
      baseAsset = canonicalSymbol.slice(0, -quote.length);
    }
    exchange = "BINANCE";
  } else if (assetClass === "STOCK") {
    baseAsset = canonicalSymbol;
    quoteAsset = "USD";
    exchange = "FINNHUB";
  }

  let providerSymbol = null;
  try {
    if (provider) {
      providerSymbol = toProviderSymbol(canonicalSymbol, provider, {
        assetClass,
      });
    }
  } catch {
    providerSymbol = null;
  }

  return {
    rawSymbol: symbol,
    canonicalSymbol,
    providerSymbol,
    displaySymbol,
    assetClass,
    provider,
    exchange,
    baseAsset,
    quoteAsset,
  };
}

/**
 * Resolve a symbol against the PostgreSQL Symbol table (via Prisma) or fallback to rules.
 * Handles active/inactive status, asset type consistency, and provider mapping.
 */
async function resolveSymbol(symbol, options = {}) {
  // Step 1: Basic symbol syntax validation and normalization
  const { prefix, clean } = parseProviderPrefix(symbol);

  // Step 2: Separate provider prefix and get underlying canonical symbol
  const slashMatch = CRYPTO_SLASH_PATTERN.exec(clean);
  const canonicalSymbol = slashMatch
    ? `${slashMatch[1]}${slashMatch[2]}`
    : clean;

  const requestedAssetClass = options.assetClass
    ? String(options.assetClass).trim().toUpperCase()
    : null;

  // Fast-path: if pre-resolved metadata is provided by a trusted caller (e.g. marketData -> marketDataService),
  // verify it matches canonicalSymbol and requestedAssetClass before returning directly without redundant DB lookup.
  if (
    options._resolved &&
    typeof options._resolved === "object" &&
    options._resolved.canonicalSymbol === canonicalSymbol &&
    (!requestedAssetClass || options._resolved.assetClass === requestedAssetClass)
  ) {
    return options._resolved;
  }

  if (requestedAssetClass && !ASSET_CLASS_SET.has(requestedAssetClass)) {
    throw createMarketDataError(
      "Market data is not supported for this asset class.",
      422,
      "MARKET_DATA_UNSUPPORTED_ASSET_CLASS",
    );
  }

  // Reject contradictory provider prefixes and explicit asset classes upfront
  if (prefix === "FINNHUB" && requestedAssetClass === "CRYPTO") {
    throw createMarketDataError(
      "Market data is not supported for this asset class.",
      422,
      "MARKET_DATA_UNSUPPORTED_ASSET_CLASS",
    );
  }

  if (prefix === "BINANCE" && requestedAssetClass === "STOCK") {
    throw createMarketDataError(
      "Market data is not supported for this asset class.",
      422,
      "MARKET_DATA_UNSUPPORTED_ASSET_CLASS",
    );
  }

  // Reject unambiguous crypto notation with explicit STOCK override
  if (
    requestedAssetClass === "STOCK" &&
    (isUnambiguousCryptoSymbol(clean) || clean.includes("/"))
  ) {
    throw createMarketDataError(
      "Market data is not supported for this asset class.",
      422,
      "MARKET_DATA_UNSUPPORTED_ASSET_CLASS",
    );
  }

  // Step 3: Database lookup for underlying canonical symbol
  const prisma = options.prisma || getDefaultPrisma();
  let dbRecord = null;
  let dbError = null;

  if (prisma?.symbol?.findUnique) {
    try {
      dbRecord = await prisma.symbol.findUnique({
        where: { symbol: canonicalSymbol },
      });
    } catch (err) {
      dbError = err;
    }
  }

  if (dbError) {
    if (options.allowFallbackOnError) {
      dbRecord = null;
    } else if (options.failOnError || dbError instanceof AppError) {
      throw dbError;
    } else {
      throw createMarketDataError(
        "Symbol resolution failed due to a database error.",
        500,
        "DATABASE_ERROR",
      );
    }
  }

  // Step 4 & 5: When database record exists
  if (dbRecord) {
    if (!dbRecord.isActive && !options.includeInactive) {
      throw AppError.notFound("Active symbol not found.", "SYMBOL_NOT_FOUND");
    }

    // Step 4: Validate provider prefix against DB asset class
    if (prefix === "FINNHUB" && dbRecord.assetType !== "STOCK") {
      throw createMarketDataError(
        "A valid stock ticker symbol is required.",
        400,
        "MARKET_DATA_INVALID_REQUEST",
      );
    }

    if (prefix === "BINANCE" && dbRecord.assetType !== "CRYPTO") {
      throw createMarketDataError(
        "The cryptocurrency symbol format is invalid.",
        400,
        "MARKET_DATA_INVALID_REQUEST",
      );
    }

    if (
      isUnambiguousCryptoSymbol(canonicalSymbol) &&
      dbRecord.assetType === "STOCK"
    ) {
      throw createMarketDataError(
        "Market data is not supported for this asset class.",
        422,
        "MARKET_DATA_UNSUPPORTED_ASSET_CLASS",
      );
    }

    // Step 5: Validate explicit asset class against DB metadata
    if (
      requestedAssetClass &&
      requestedAssetClass !== dbRecord.assetType
    ) {
      throw AppError.badRequest(
        "Asset type does not match the selected symbol.",
        "ASSET_TYPE_MISMATCH",
      );
    }

    const assetClass = dbRecord.assetType;
    const provider = DEFAULT_PROVIDER_BY_ASSET_CLASS[assetClass] || null;
    let providerSymbol = null;
    try {
      if (provider) {
        providerSymbol = toProviderSymbol(canonicalSymbol, provider, {
          assetClass,
          quoteAsset: dbRecord.currency === "BTC" ? "BTC" : "USDT",
        });
      }
    } catch {
      providerSymbol = canonicalSymbol;
    }

    const displaySymbol = toDisplaySymbol(canonicalSymbol, { assetClass });

    return {
      canonicalSymbol: dbRecord.symbol,
      assetClass,
      name: dbRecord.name,
      exchange: dbRecord.exchange || (provider ? provider.toUpperCase() : null),
      currency: dbRecord.currency || "USD",
      isActive: dbRecord.isActive,
      isTradable: dbRecord.isTradable,
      provider,
      providerSymbol,
      displaySymbol,
      source: "database",
      metadata: {
        sector: dbRecord.sector,
        industry: dbRecord.industry,
        logoUrl: dbRecord.logoUrl,
        description: dbRecord.description,
      },
    };
  }

  // Step 6 & 7: When NO database record exists
  if (options.strict) {
    throw AppError.notFound("Active symbol not found.", "SYMBOL_NOT_FOUND");
  }

  // Step 6: Syntax-based inference
  const inferredClass = inferAssetClass(canonicalSymbol);
  const assetClass =
    requestedAssetClass ||
    (prefix === "FINNHUB"
      ? "STOCK"
      : prefix === "BINANCE"
        ? "CRYPTO"
        : inferredClass);

  // Step 7: Reject contradictory provider prefixes and asset classes against syntax/inference
  if (prefix === "FINNHUB") {
    if (
      clean.includes("/") ||
      isUnambiguousCryptoSymbol(clean) ||
      inferredClass === "CRYPTO"
    ) {
      throw createMarketDataError(
        "A valid stock ticker symbol is required.",
        400,
        "MARKET_DATA_INVALID_REQUEST",
      );
    }
  }

  if (prefix === "BINANCE") {
    const isCryptoSlash = CRYPTO_SLASH_PATTERN.test(clean);
    const isCryptoPair =
      CRYPTO_PAIR_PATTERN.test(clean) && !KNOWN_AMBIGUOUS_STOCKS.has(clean);
    if (!isCryptoSlash && !isCryptoPair) {
      throw createMarketDataError(
        "The cryptocurrency symbol format is invalid.",
        400,
        "MARKET_DATA_INVALID_REQUEST",
      );
    }
  }

  if (
    assetClass === "STOCK" &&
    (isUnambiguousCryptoSymbol(canonicalSymbol) || clean.includes("/"))
  ) {
    throw createMarketDataError(
      "Market data is not supported for this asset class.",
      422,
      "MARKET_DATA_UNSUPPORTED_ASSET_CLASS",
    );
  }

  const provider = DEFAULT_PROVIDER_BY_ASSET_CLASS[assetClass] || null;
  const providerSymbol = provider
    ? toProviderSymbol(canonicalSymbol, provider, { assetClass })
    : null;
  const displaySymbol = toDisplaySymbol(canonicalSymbol, { assetClass });

  return {
    canonicalSymbol,
    assetClass,
    name: displaySymbol,
    exchange: provider === "binance" ? "BINANCE" : "FINNHUB",
    currency:
      assetClass === "CRYPTO"
        ? CRYPTO_QUOTE_ASSETS.find((q) => canonicalSymbol.endsWith(q)) || "USD"
        : "USD",
    isActive: true,
    isTradable: true,
    provider,
    providerSymbol,
    displaySymbol,
    source: "rule",
    metadata: null,
  };
}

/**
 * Resolve multiple symbols in batch.
 */
async function resolveSymbols(symbols, options = {}) {
  if (!Array.isArray(symbols)) {
    throw createMarketDataError(
      "A symbols array is required.",
      400,
      "MARKET_DATA_INVALID_REQUEST",
    );
  }
  return Promise.all(symbols.map((sym) => resolveSymbol(sym, options)));
}

module.exports = {
  ASSET_CLASSES,
  CRYPTO_QUOTE_ASSETS,
  MAJOR_CRYPTO_BASE_ASSETS,
  KNOWN_AMBIGUOUS_STOCKS,
  SUPPORTED_PROVIDERS,
  normalizeSymbol,
  inferAssetClass,
  normalizeAssetClass,
  toCanonicalSymbol,
  toProviderSymbol,
  toDisplaySymbol,
  parseSymbol,
  parseProviderPrefix,
  resolveSymbol,
  resolveSymbols,
  isUnambiguousCryptoSymbol,
};
