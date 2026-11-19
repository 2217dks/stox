const {
  createMarketQuoteDto,
  normalizeQuoteDecimal,
} = require("../dtos/marketQuoteDto");
const { createMarketDataError } = require("./marketDataErrors");
const { assertObject, invalidProviderResponse } = require("./marketDataHttp");
const { BINANCE_QUOTE_ASSETS } = require("../utils/cryptoQuoteAssets");

function decimalOrInvalid(value) {
  const decimal = normalizeQuoteDecimal(value);
  if (decimal === undefined) throw invalidProviderResponse();
  return decimal;
}

function epochTimestamp(value, unit, { nullable = false } = {}) {
  if (value === undefined || value === null || value === "") {
    if (nullable) return null;
    throw invalidProviderResponse();
  }

  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(numeric) || numeric < 0) {
    throw invalidProviderResponse();
  }
  const timestamp = new Date(unit === "seconds" ? numeric * 1000 : numeric);
  if (Number.isNaN(timestamp.getTime())) throw invalidProviderResponse();
  return timestamp;
}

function mapFinnhubQuote(payload, requestedSymbol) {
  const data = assertObject(payload);
  const price = normalizeQuoteDecimal(data.c);
  const providerTime = normalizeQuoteDecimal(data.t);
  if (price === "0" && providerTime === "0") {
    throw createMarketDataError(
      "Market data is unavailable for the requested symbol.",
      404,
      "MARKET_DATA_NOT_FOUND",
    );
  }

  return createMarketQuoteDto({
    symbol: requestedSymbol,
    assetClass: "STOCK",
    price: decimalOrInvalid(data.c),
    change: data.d,
    changePercent: data.dp,
    high: data.h,
    low: data.l,
    open: data.o,
    previousClose: data.pc,
    // Finnhub's /quote response does not include volume.
    volume: null,
    currency: "USD",
    timestamp: epochTimestamp(data.t, "seconds", { nullable: true }),
    source: "finnhub",
  });
}

function mapBinanceQuote(payload, requestedSymbol) {
  const data = assertObject(payload);
  if (
    typeof data.symbol !== "string" ||
    data.symbol.toUpperCase() !== requestedSymbol
  ) {
    throw invalidProviderResponse();
  }

  const fields = {
    price: data.lastPrice,
    change: data.priceChange,
    changePercent: data.priceChangePercent,
    high: data.highPrice,
    low: data.lowPrice,
    open: data.openPrice,
    previousClose: data.prevClosePrice,
    volume: data.volume,
  };
  const decimals = Object.fromEntries(
    Object.entries(fields).map(([name, value]) => [
      name,
      decimalOrInvalid(value),
    ]),
  );
  const currency = BINANCE_QUOTE_ASSETS.find((asset) =>
    requestedSymbol.endsWith(asset),
  );

  // Binance reports prevClosePrice as 0 for pairs with no completed prior
  // session (for example a halted/break market). The DTO treats a non-null
  // previous close as positive, so an unknown close must be null rather than
  // "0"; otherwise an otherwise usable quote becomes a 502.
  if (decimals.previousClose === "0") {
    decimals.previousClose = null;
  }

  return createMarketQuoteDto({
    symbol: `BINANCE:${requestedSymbol}`,
    assetClass: "CRYPTO",
    ...decimals,
    currency: currency || null,
    timestamp: epochTimestamp(data.closeTime, "milliseconds"),
    source: "binance",
  });
}

module.exports = { mapBinanceQuote, mapFinnhubQuote };
