import { CRYPTO_QUOTE_ASSETS } from "./constants";

const FIAT = "USD";

export function toNumber(value, fallback = 0) {
  if (value === null || value === undefined || value === "") return fallback;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function isCrypto(symbol = "", assetType) {
  if (assetType) return assetType === "CRYPTO";
  const upper = String(symbol).trim().toUpperCase();
  const clean = upper.replace(/^BINANCE:/, "");
  if (upper.startsWith("BINANCE:") || clean.includes("/")) return true;
  // Pair-shape heuristic: Binance pairs are at least 6 characters once the
  // base and quote are joined (ETHBTC). Short stock tickers stay stocks; an
  // explicit asset class or a search result always wins over this heuristic.
  return /^[A-Z0-9]{6,30}$/.test(clean);
}

export function isForex(assetType) {
  return assetType === "FOREX";
}

function fractionDigits(value) {
  const absolute = Math.abs(value);

  if (absolute === 0) return 2;
  if (absolute >= 1000) return 2;
  if (absolute >= 1) return 2;
  if (absolute >= 0.1) return 4;
  if (absolute >= 0.001) return 5;
  if (absolute >= 0.00001) return 7;
  return 8;
}

export function formatNumber(value, options = {}) {
  const number = toNumber(value);
  const {
    minimumFractionDigits,
    maximumFractionDigits,
    compact = false,
    notation,
  } = options;

  return new Intl.NumberFormat("en-US", {
    notation: notation || (compact ? "compact" : "standard"),
    compactDisplay: "short",
    minimumFractionDigits:
      minimumFractionDigits ?? (compact ? 0 : fractionDigits(number)),
    maximumFractionDigits:
      maximumFractionDigits ?? (compact ? 1 : fractionDigits(number)),
  }).format(number);
}

export function formatCurrency(value, options = {}) {
  const number = toNumber(value);
  const {
    compact = false,
    signed = false,
    currency = FIAT,
    decimals,
    showSymbol = true,
  } = options;

  const formatted = new Intl.NumberFormat("en-US", {
    style: showSymbol ? "currency" : "decimal",
    currency,
    currencyDisplay: "narrowSymbol",
    notation: compact ? "compact" : "standard",
    compactDisplay: "short",
    minimumFractionDigits: decimals ?? (compact ? 0 : fractionDigits(number)),
    maximumFractionDigits: decimals ?? (compact ? 1 : fractionDigits(number)),
  }).format(Math.abs(number));

  if (!signed) return number < 0 ? `-${formatted}` : formatted;
  if (number > 0) return `+${formatted}`;
  if (number < 0) return `-${formatted}`;
  return formatted;
}

export function formatCompact(value, options = {}) {
  return formatNumber(value, { compact: true, ...options });
}

export function formatPercent(value, options = {}) {
  const number = toNumber(value);
  const { signed = true, decimals = 2 } = options;
  const formatted = `${Math.abs(number).toFixed(decimals)}%`;

  if (!signed) return number < 0 ? `-${formatted}` : formatted;
  if (number > 0) return `+${formatted}`;
  if (number < 0) return `-${formatted}`;
  return `0.00%`;
}

export function formatQuantity(value, maxDecimals = 8) {
  const number = toNumber(value);
  if (number === 0) return "0";
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxDecimals,
  }).format(number);
}

export function formatPrice(value) {
  return formatCurrency(value, { showSymbol: false });
}

export function formatDate(value, options = {}) {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    ...options,
  }).format(date);
}

export function formatDateTime(value, options = {}) {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    ...options,
  }).format(date);
}

export function formatTime(value, options = {}) {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";

  return new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    ...options,
  }).format(date);
}

export function formatRelative(value, now = Date.now()) {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";

  const seconds = Math.round((date.getTime() - now) / 1000);
  const absolute = Math.abs(seconds);
  const future = seconds > 0;
  const suffix = future ? "" : " ago";
  const prefix = future ? "in " : "";

  if (absolute < 10) return future ? "in a moment" : "just now";
  if (absolute < 60) return `${prefix}${absolute}s${suffix}`;

  const minutes = Math.round(absolute / 60);
  if (minutes < 60) return `${prefix}${minutes}m${suffix}`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${prefix}${hours}h${suffix}`;

  const days = Math.round(hours / 24);
  if (days < 7) return `${prefix}${days}d${suffix}`;

  return formatDate(date);
}

export function symbolLabel(symbol = "") {
  if (!symbol) return "—";
  symbol = symbol.replace(/^BINANCE:/i, "");
  if (symbol.includes("/")) return symbol.replace("/", " / ");

  const upper = symbol.toUpperCase();
  const quote = CRYPTO_QUOTE_ASSETS.find(
    (asset) => upper.length > asset.length && upper.endsWith(asset),
  );
  if (quote) return `${symbol.slice(0, -quote.length)} / ${quote}`;
  return symbol;
}

export function tickerOf(symbol = "") {
  symbol = symbol.replace(/^BINANCE:/i, "");
  if (symbol.includes("/")) return symbol.split("/")[0].trim();

  const upper = symbol.toUpperCase();
  const quote = CRYPTO_QUOTE_ASSETS.find(
    (asset) => upper.length > asset.length && upper.endsWith(asset),
  );
  return quote ? symbol.slice(0, -quote.length) : symbol;
}

export function assetClassLabel(assetType) {
  const labels = {
    STOCK: "Stocks",
    CRYPTO: "Crypto",
    FOREX: "Forex",
  };
  return labels[assetType] || "Markets";
}

export function directionOf(value) {
  const number = toNumber(value);
  if (number > 0) return "up";
  if (number < 0) return "down";
  return "flat";
}

export function pnlTone(value) {
  const direction = directionOf(value);
  if (direction === "up") return "text-up";
  if (direction === "down") return "text-down";
  return "text-fg-muted";
}

export function formatSigned(value, options = {}) {
  const number = toNumber(value);
  const { currency = false, percent = false, compact = false } = options;

  if (percent) return formatPercent(number);
  if (currency) return formatCurrency(number, { signed: true, compact });
  return `${number > 0 ? "+" : number < 0 ? "-" : ""}${formatNumber(
    Math.abs(number),
    { compact },
  )}`;
}

export function timeAgoShort(value) {
  return formatRelative(value).replace(" ago", "");
}

/** Chart timestamp helpers. */
export function utcDayKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(
    2,
    "0",
  )}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

export function monthLabel(value) {
  const date = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    year: "2-digit",
    timeZone: "UTC",
  }).format(date);
}
