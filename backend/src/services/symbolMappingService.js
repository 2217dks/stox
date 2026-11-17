const { AppError } = require("../utils/errors");
const { createMarketDataError } = require("../providers/marketDataErrors");

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

const CRYPTO_QUOTE_ASSETS = Object.freeze(["USDT", "BTC", "ETH"]);
const CRYPTO_QUOTE_ASSET_SET = new Set(CRYPTO_QUOTE_ASSETS);

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
 * Validate and normalize a raw symbol string.
 * Ensures non-empty, trimmed, uppercase, and valid characters.
 */
function normalizeSymbol(symbol) {
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
  return value;
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

  return CRYPTO_PAIR_PATTERN.test(clean) ? "CRYPTO" : "STOCK";
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

    if (!CRYPTO_PAIR_PATTERN.test(canonical)) {
      throw createMarketDataError(
        "The cryptocurrency symbol format is invalid.",
        400,
        "MARKET_DATA_INVALID_REQUEST",
      );
    }

    return canonical;
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
  const canonicalSymbol = toCanonicalSymbol(symbol, options);
  const requestedAssetClass = options.assetClass
    ? String(options.assetClass).trim().toUpperCase()
    : null;

  const prisma = options.prisma || getDefaultPrisma();
  let dbRecord = null;

  if (prisma?.symbol?.findUnique) {
    try {
      dbRecord = await prisma.symbol.findUnique({
        where: { symbol: canonicalSymbol },
      });
    } catch (err) {
      if (options.failOnError) {
        throw err;
      }
    }
  }

  if (dbRecord) {
    if (!dbRecord.isActive && !options.includeInactive) {
      throw AppError.notFound("Active symbol not found.", "SYMBOL_NOT_FOUND");
    }

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
    const providerSymbol = provider
      ? toProviderSymbol(canonicalSymbol, provider, { assetClass })
      : null;
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

  if (options.strict) {
    throw AppError.notFound("Active symbol not found.", "SYMBOL_NOT_FOUND");
  }

  const assetClass = normalizeAssetClass(requestedAssetClass, canonicalSymbol);
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
  KNOWN_AMBIGUOUS_STOCKS,
  SUPPORTED_PROVIDERS,
  normalizeSymbol,
  inferAssetClass,
  normalizeAssetClass,
  toCanonicalSymbol,
  toProviderSymbol,
  toDisplaySymbol,
  parseSymbol,
  resolveSymbol,
  resolveSymbols,
};
