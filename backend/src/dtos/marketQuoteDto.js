const { createMarketDataError } = require("../providers/marketDataErrors");

const ASSET_CLASSES = new Set(["STOCK", "CRYPTO"]);
const OPTIONAL_DECIMAL_FIELDS = [
  "change",
  "changePercent",
  "high",
  "low",
  "open",
  "previousClose",
  "volume",
];

function invalidQuote() {
  return createMarketDataError(
    "Market data provider returned an invalid response.",
    502,
    "MARKET_DATA_INVALID_RESPONSE",
  );
}

/** Normalize a finite decimal value without performing floating-point math. */
function normalizeQuoteDecimal(value) {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return undefined;
    value = String(value);
  }
  if (typeof value !== "string") return undefined;

  const match = /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:e([+-]?\d+))?$/i.exec(
    value.trim(),
  );
  if (!match) return undefined;

  const sign = match[1] === "-" ? "-" : "";
  const whole = match[2] || "0";
  const fraction = match[3] ?? match[4] ?? "";
  const exponent = Number(match[5] || 0);
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 1000) {
    return undefined;
  }

  const digits = `${whole}${fraction}`;
  const decimalIndex = whole.length + exponent;
  let integerPart;
  let fractionalPart;
  if (decimalIndex <= 0) {
    integerPart = "0";
    fractionalPart = `${"0".repeat(-decimalIndex)}${digits}`;
  } else if (decimalIndex >= digits.length) {
    integerPart = `${digits}${"0".repeat(decimalIndex - digits.length)}`;
    fractionalPart = "";
  } else {
    integerPart = digits.slice(0, decimalIndex);
    fractionalPart = digits.slice(decimalIndex);
  }

  integerPart = integerPart.replace(/^0+(?=\d)/, "");
  fractionalPart = fractionalPart.replace(/0+$/, "");
  const isZero = integerPart === "0" && fractionalPart === "";
  return `${sign && !isZero ? sign : ""}${integerPart}${fractionalPart ? `.${fractionalPart}` : ""}`;
}

function normalizeQuoteTimestamp(value) {
  if (value === undefined || value === null || value === "") return null;
  if (
    !(value instanceof Date) &&
    typeof value !== "string" &&
    typeof value !== "number"
  ) {
    return undefined;
  }
  if (typeof value === "number" && !Number.isFinite(value)) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
}

function isPositive(value) {
  return value !== null && !value.startsWith("-") && /[1-9]/.test(value);
}

/** Build and validate the stable normalized quote DTO returned by adapters. */
function createMarketQuoteDto(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw invalidQuote();
  }

  const symbol =
    typeof input.symbol === "string" ? input.symbol.trim().toUpperCase() : "";
  const assetClass =
    typeof input.assetClass === "string"
      ? input.assetClass.trim().toUpperCase()
      : "";
  const source =
    typeof input.source === "string" ? input.source.trim().toLowerCase() : "";
  const price = normalizeQuoteDecimal(input.price);
  const timestamp = normalizeQuoteTimestamp(input.timestamp);
  const currency =
    input.currency === undefined || input.currency === null
      ? null
      : typeof input.currency === "string"
        ? input.currency.trim().toUpperCase()
        : undefined;

  const optionalDecimals = Object.fromEntries(
    OPTIONAL_DECIMAL_FIELDS.map((field) => [
      field,
      input[field] === undefined || input[field] === null
        ? null
        : normalizeQuoteDecimal(input[field]),
    ]),
  );

  if (
    !symbol ||
    !ASSET_CLASSES.has(assetClass) ||
    !source ||
    !price ||
    !isPositive(price) ||
    timestamp === undefined ||
    currency === undefined ||
    (currency !== null && !currency) ||
    OPTIONAL_DECIMAL_FIELDS.some(
      (field) => input[field] != null && optionalDecimals[field] === undefined,
    ) ||
    ["high", "low", "open", "previousClose"].some(
      (field) =>
        optionalDecimals[field] !== null &&
        !isPositive(optionalDecimals[field]),
    ) ||
    (optionalDecimals.volume !== null &&
      optionalDecimals.volume.startsWith("-"))
  ) {
    throw invalidQuote();
  }

  return {
    symbol,
    assetClass,
    price,
    ...optionalDecimals,
    currency,
    timestamp,
    source,
  };
}

module.exports = {
  createMarketQuoteDto,
  normalizeQuoteDecimal,
  normalizeQuoteTimestamp,
};
