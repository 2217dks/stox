const {
  createHttpClient,
  getData,
  decimalString,
  isoTimestamp,
  invalidProviderResponse,
  assertObject,
} = require("./marketDataHttp");
const { createMarketDataError } = require("./marketDataErrors");

const FINNHUB_RESOLUTIONS = Object.freeze({
  "1m": "1",
  "5m": "5",
  "15m": "15",
  "30m": "30",
  "1h": "60",
  "4h": "240",
  "1d": "D",
  "1w": "W",
  "1M": "M",
});

function createFinnhubMarketDataProvider(config = {}, { httpClient } = {}) {
  const apiKey = typeof config.apiKey === "string" ? config.apiKey.trim() : "";
  const client =
    httpClient ||
    createHttpClient({
      baseURL: config.baseUrl,
      timeoutMs: config.timeoutMs,
      headers: apiKey ? { "X-Finnhub-Token": apiKey } : {},
    });

  function requireApiKey() {
    if (!apiKey) {
      throw createMarketDataError(
        "Finnhub credentials are not configured.",
        503,
        "MARKET_DATA_NOT_CONFIGURED",
      );
    }
  }

  return {
    id: "finnhub",
    assetClasses: ["STOCK"],

    async getQuote(symbol) {
      requireApiKey();
      const data = assertObject(await getData(client, "/quote", { symbol }));
      const price = decimalString(data.c);
      if (price === undefined || Number(price) <= 0) {
        const isZero = (value) => value === 0 || value === "0";
        if (isZero(data.c) && isZero(data.t)) {
          throw createMarketDataError(
            "Market data is unavailable for the requested symbol.",
            404,
            "MARKET_DATA_NOT_FOUND",
          );
        }
        throw invalidProviderResponse();
      }

      const optional = [data.d, data.dp, data.h, data.l, data.o, data.pc];
      if (
        optional.some(
          (value) => decimalString(value, { nullable: true }) === undefined,
        )
      ) {
        throw invalidProviderResponse();
      }

      return {
        symbol,
        assetClass: "STOCK",
        price,
        change: decimalString(data.d, { nullable: true }),
        changePercent: decimalString(data.dp, { nullable: true }),
        high: decimalString(data.h, { nullable: true }),
        low: decimalString(data.l, { nullable: true }),
        open: decimalString(data.o, { nullable: true }),
        previousClose: decimalString(data.pc, { nullable: true }),
        volume: null,
        currency: "USD",
        timestamp: isoTimestamp(data.t, { unit: "seconds" }),
        source: "finnhub",
      };
    },

    async getHistoricalPrices(symbol, { interval, from, to }) {
      requireApiKey();
      const resolution = FINNHUB_RESOLUTIONS[interval];
      if (!resolution) {
        throw createMarketDataError(
          "Historical interval is not supported.",
          400,
          "MARKET_DATA_INVALID_REQUEST",
        );
      }

      const data = assertObject(
        await getData(client, "/stock/candle", {
          symbol,
          resolution,
          from: Math.floor(from / 1000),
          to: Math.floor(to / 1000),
        }),
      );

      if (data.s === "no_data") {
        return { symbol, assetClass: "STOCK", interval, prices: [] };
      }
      if (
        data.s !== "ok" ||
        ![data.t, data.o, data.h, data.l, data.c, data.v].every(Array.isArray)
      ) {
        throw invalidProviderResponse();
      }

      const length = data.t.length;
      if (
        ![data.o, data.h, data.l, data.c, data.v].every(
          (items) => items.length === length,
        )
      ) {
        throw invalidProviderResponse();
      }

      const prices = data.t.map((timestamp, index) => {
        const candle = {
          timestamp: isoTimestamp(timestamp, { unit: "seconds" }),
          open: decimalString(data.o[index]),
          high: decimalString(data.h[index]),
          low: decimalString(data.l[index]),
          close: decimalString(data.c[index]),
          volume: decimalString(data.v[index]),
        };
        if (
          !candle.timestamp ||
          Object.values(candle).some((value) => value === undefined)
        ) {
          throw invalidProviderResponse();
        }
        return candle;
      });

      return { symbol, assetClass: "STOCK", interval, prices };
    },

    async getMarketOverview() {
      requireApiKey();
      const data = assertObject(
        await getData(client, "/stock/market-status", { exchange: "US" }),
      );
      if (typeof data.isOpen !== "boolean") throw invalidProviderResponse();
      return {
        assetClass: "STOCK",
        asOf: isoTimestamp(data.t) || new Date().toISOString(),
        marketStatus: {
          isOpen: data.isOpen,
          session: typeof data.session === "string" ? data.session : null,
          holiday: typeof data.holiday === "string" ? data.holiday : null,
          exchange: typeof data.exchange === "string" ? data.exchange : "US",
          timezone: typeof data.timezone === "string" ? data.timezone : null,
        },
        movers: [],
        source: "finnhub",
      };
    },

    async searchSymbols(query) {
      requireApiKey();
      const data = assertObject(await getData(client, "/search", { q: query }));
      if (!Array.isArray(data.result)) throw invalidProviderResponse();
      return data.result.map((item) => {
        if (!item || typeof item !== "object") throw invalidProviderResponse();
        const symbol = item.displaySymbol || item.symbol;
        if (
          typeof symbol !== "string" ||
          typeof item.description !== "string"
        ) {
          throw invalidProviderResponse();
        }
        return {
          symbol,
          name: item.description,
          assetClass: "STOCK",
          exchange: typeof item.exchange === "string" ? item.exchange : null,
          currency: "USD",
          type: typeof item.type === "string" ? item.type : null,
          source: "finnhub",
        };
      });
    },
  };
}

module.exports = { createFinnhubMarketDataProvider };
