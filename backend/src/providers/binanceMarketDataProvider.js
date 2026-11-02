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
  return symbol
    .replace(/^BINANCE:/i, "")
    .replaceAll("/", "")
    .toUpperCase();
}

function createBinanceMarketDataProvider(config, { httpClient } = {}) {
  const client =
    httpClient ||
    createHttpClient({ baseURL: config.baseUrl, timeoutMs: config.timeoutMs });

  return {
    id: "binance",

    async getQuote(symbol) {
      const providerSymbol = stripBinancePrefix(symbol);
      const data = assertObject(
        await getData(client, "/api/v3/ticker/24hr", {
          symbol: providerSymbol,
        }),
      );
      const price = decimalString(data.lastPrice);
      if (price === undefined || Number(price) <= 0)
        throw invalidProviderResponse();

      const optional = [
        data.priceChange,
        data.priceChangePercent,
        data.highPrice,
        data.lowPrice,
        data.openPrice,
        data.prevClosePrice,
        data.volume,
      ];
      if (
        optional.some(
          (value) => decimalString(value, { nullable: true }) === undefined,
        )
      ) {
        throw invalidProviderResponse();
      }

      const quoteAsset =
        typeof data.symbol === "string" && /USDT$/i.test(data.symbol)
          ? "USDT"
          : null;

      return {
        symbol: `BINANCE:${providerSymbol}`,
        assetClass: "CRYPTO",
        price,
        change: decimalString(data.priceChange, { nullable: true }),
        changePercent: decimalString(data.priceChangePercent, {
          nullable: true,
        }),
        high: decimalString(data.highPrice, { nullable: true }),
        low: decimalString(data.lowPrice, { nullable: true }),
        open: decimalString(data.openPrice, { nullable: true }),
        previousClose: decimalString(data.prevClosePrice, { nullable: true }),
        volume: decimalString(data.volume, { nullable: true }),
        currency: quoteAsset,
        timestamp: isoTimestamp(data.closeTime),
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
        symbol: stripBinancePrefix(symbol),
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
        symbol: `BINANCE:${stripBinancePrefix(symbol)}`,
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
