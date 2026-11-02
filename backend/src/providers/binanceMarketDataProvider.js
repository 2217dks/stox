const {
  createHttpClient,
  getData,
  decimalString,
  isoTimestamp,
  invalidProviderResponse,
  assertObject,
} = require("./marketDataHttp");
const { createMarketDataError } = require("./marketDataErrors");

const BINANCE_INTERVALS = new Set([
  "1m",
  "5m",
  "15m",
  "30m",
  "1h",
  "4h",
  "1d",
  "1w",
  "1M",
]);

function stripBinancePrefix(symbol) {
  return symbol.replace(/^BINANCE:/i, "").toUpperCase();
}

function normalizeBinanceSymbol(symbol) {
  const value = stripBinancePrefix(symbol);
  const slashPair = /^([A-Z0-9]{2,20})\/(USDT|BTC|ETH)$/.exec(value);
  const normalized = slashPair ? `${slashPair[1]}${slashPair[2]}` : value;
  // These quote assets match the conventions currently documented by Stox.
  // The exchange remains authoritative for whether a syntactically valid pair
  // is listed and trading.
  if (!/^[A-Z0-9]{2,20}(?:USDT|BTC|ETH)$/.test(normalized)) {
    throw createMarketDataError(
      "The cryptocurrency symbol format is invalid.",
      400,
      "MARKET_DATA_INVALID_REQUEST",
    );
  }
  return normalized;
}

function binanceDecimal(value) {
  if (typeof value !== "string" || !/^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value)) {
    return undefined;
  }
  return decimalString(value);
}

function isPositiveDecimal(value) {
  return value !== undefined && !value.startsWith("-") && /[1-9]/.test(value);
}

function isNonNegativeDecimal(value) {
  return value !== undefined && !value.startsWith("-");
}

function createBinanceMarketDataProvider(config, { httpClient } = {}) {
  const client =
    httpClient ||
    createHttpClient({ baseURL: config.baseUrl, timeoutMs: config.timeoutMs });

  return {
    id: "binance",
    assetClasses: ["CRYPTO"],

    async getQuote(symbol) {
      const providerSymbol = normalizeBinanceSymbol(symbol);
      const data = assertObject(
        await getData(client, "/api/v3/ticker/24hr", {
          symbol: providerSymbol,
        }),
      );
      const price = binanceDecimal(data.lastPrice);
      if (!isPositiveDecimal(price)) throw invalidProviderResponse();

      if (
        typeof data.symbol !== "string" ||
        data.symbol.toUpperCase() !== providerSymbol
      ) {
        throw invalidProviderResponse();
      }

      const change = binanceDecimal(data.priceChange);
      const changePercent = binanceDecimal(data.priceChangePercent);
      const high = binanceDecimal(data.highPrice);
      const low = binanceDecimal(data.lowPrice);
      const open = binanceDecimal(data.openPrice);
      const previousClose = binanceDecimal(data.prevClosePrice);
      const volume = binanceDecimal(data.volume);
      const timestamp = isoTimestamp(data.closeTime);
      if (
        [change, changePercent, high, low, open, previousClose, volume].some(
          (value) => value === undefined,
        ) ||
        !isPositiveDecimal(high) ||
        !isPositiveDecimal(low) ||
        !isPositiveDecimal(open) ||
        !isPositiveDecimal(previousClose) ||
        !isNonNegativeDecimal(volume) ||
        !timestamp
      ) {
        throw invalidProviderResponse();
      }

      const quoteAsset = ["USDT", "BTC", "ETH"].find((asset) =>
        providerSymbol.endsWith(asset),
      );

      return {
        symbol: `BINANCE:${providerSymbol}`,
        assetClass: "CRYPTO",
        price,
        change,
        changePercent,
        high,
        low,
        open,
        previousClose,
        volume,
        currency: quoteAsset || null,
        timestamp,
        source: "binance",
      };
    },

    async getHistoricalPrices(symbol, { interval, from, to, limit = 500 }) {
      if (!BINANCE_INTERVALS.has(interval)) {
        throw createMarketDataError(
          "Historical interval is not supported.",
          400,
          "MARKET_DATA_INVALID_REQUEST",
        );
      }
      const data = await getData(client, "/api/v3/klines", {
        symbol: normalizeBinanceSymbol(symbol),
        interval,
        startTime: from,
        endTime: to,
        limit,
      });
      if (!Array.isArray(data)) throw invalidProviderResponse();

      const prices = data.map((row) => {
        if (!Array.isArray(row) || row.length < 6)
          throw invalidProviderResponse();
        const candle = {
          timestamp: isoTimestamp(row[0]),
          open: decimalString(row[1]),
          high: decimalString(row[2]),
          low: decimalString(row[3]),
          close: decimalString(row[4]),
          volume: decimalString(row[5]),
        };
        if (
          !candle.timestamp ||
          Object.values(candle).some((value) => value === undefined)
        ) {
          throw invalidProviderResponse();
        }
        return candle;
      });

      return {
        symbol: `BINANCE:${normalizeBinanceSymbol(symbol)}`,
        assetClass: "CRYPTO",
        interval,
        prices,
      };
    },

    async getMarketOverview({ limit = 10 } = {}) {
      const data = await getData(client, "/api/v3/ticker/24hr", {});
      if (!Array.isArray(data)) throw invalidProviderResponse();
      const rows = data.map((item) => {
        assertObject(item);
        const changePercent = decimalString(item.priceChangePercent);
        const price = decimalString(item.lastPrice);
        const quoteVolume = decimalString(item.quoteVolume, { nullable: true });
        if (
          changePercent === undefined ||
          price === undefined ||
          quoteVolume === undefined
        ) {
          throw invalidProviderResponse();
        }
        if (typeof item.symbol !== "string") throw invalidProviderResponse();
        return {
          symbol: `BINANCE:${item.symbol.toUpperCase()}`,
          price,
          changePercent,
          quoteVolume,
        };
      });
      rows.sort(
        (left, right) =>
          Number(right.changePercent) - Number(left.changePercent),
      );

      return {
        assetClass: "CRYPTO",
        asOf: new Date().toISOString(),
        marketStatus: {
          isOpen: true,
          session: "24/7",
          exchange: "BINANCE",
          timezone: "UTC",
        },
        movers: rows.slice(0, limit),
        source: "binance",
      };
    },

    async searchSymbols(query) {
      const data = assertObject(
        await getData(client, "/api/v3/exchangeInfo", {}),
      );
      if (!Array.isArray(data.symbols)) throw invalidProviderResponse();
      const normalizedQuery = query.toUpperCase();
      return data.symbols
        .filter(
          (item) =>
            item &&
            typeof item.symbol === "string" &&
            item.status === "TRADING" &&
            item.symbol.includes(normalizedQuery),
        )
        .slice(0, 25)
        .map((item) => {
          if (
            typeof item.baseAsset !== "string" ||
            typeof item.quoteAsset !== "string"
          ) {
            throw invalidProviderResponse();
          }
          return {
            symbol: `BINANCE:${item.symbol}`,
            name: `${item.baseAsset}/${item.quoteAsset}`,
            assetClass: "CRYPTO",
            exchange: "BINANCE",
            currency: item.quoteAsset,
            type: "CRYPTO",
            source: "binance",
          };
        });
    },
  };
}

module.exports = { createBinanceMarketDataProvider };
