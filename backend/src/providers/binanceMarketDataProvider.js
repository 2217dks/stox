const {
  createHttpClient,
  getData,
  decimalString,
  isoTimestamp,
  invalidProviderResponse,
  assertObject,
} = require("./marketDataHttp");
const { createMarketDataError } = require("./marketDataErrors");
const { mapBinanceQuote } = require("./marketQuoteMappers");
const {
  toProviderSymbol,
  MAJOR_CRYPTO_BASE_ASSETS,
} = require("../services/symbolMappingService");
const { BINANCE_QUOTE_ASSETS } = require("../utils/cryptoQuoteAssets");

const MAJOR_CRYPTO_BASE_ASSET_SET = new Set(MAJOR_CRYPTO_BASE_ASSETS);

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

function normalizeBinanceSymbol(symbol, options = {}) {
  return toProviderSymbol(symbol, "binance", options);
}

function assertBinanceSymbolShape(symbol) {
  const upper = String(symbol || "").trim().toUpperCase();
  if (/^[A-Z0-9]{5,30}$/.test(upper)) {
    return;
  }
  if (/^[A-Z0-9]{2,5}$/.test(upper) && MAJOR_CRYPTO_BASE_ASSET_SET.has(upper)) {
    return;
  }
  throw createMarketDataError(
    "The cryptocurrency symbol format is invalid.",
    400,
    "MARKET_DATA_INVALID_REQUEST",
  );
}

function prepareBinanceSymbol(symbol) {
  const raw = String(symbol || "").trim().toUpperCase();
  // Prefixed/slash forms are normalized first; plain values must already look
  // like a pair or base asset so a stock ticker such as AAPL is rejected.
  if (!/[:/]/.test(raw)) assertBinanceSymbolShape(raw);
  const normalized = normalizeBinanceSymbol(symbol, { assetClass: "CRYPTO" });
  assertBinanceSymbolShape(normalized);
  return { requestedSymbol: normalized, rawSymbol: raw };
}

function isExplicitCryptoPair(requestedSymbol, rawSymbol) {
  const symbol = String(requestedSymbol || "").trim().toUpperCase();
  const raw = String(rawSymbol || symbol).trim().toUpperCase();

  // If raw input has a pair delimiter (/ - _), it's explicitly a pair
  if (/[/_-]/.test(raw)) {
    return true;
  }
  // If it has a provider prefix with a delimiter, e.g. BINANCE:BTC/USDT or BINANCE:SOL-ETH
  if (raw.includes(":")) {
    const afterColon = raw.split(":").slice(1).join(":");
    if (/[/_-]/.test(afterColon)) return true;
  }

  // Already ends in USDT
  if (symbol.endsWith("USDT") && symbol.length > 4) {
    return true;
  }

  // Ends in any known quote asset
  for (const quote of BINANCE_QUOTE_ASSETS) {
    if (symbol.endsWith(quote) && symbol.length > quote.length) {
      return true;
    }
  }

  // Starts with any known crypto base asset and has an explicit quote asset (e.g. SOLUNKNOWN, BTCABC, ETHXYZ)
  for (const base of MAJOR_CRYPTO_BASE_ASSETS) {
    if (symbol.startsWith(base) && symbol.length > base.length) {
      return true;
    }
  }

  return false;
}

/**
 * Binance base assets are not always obvious from the symbol alone
 * (`1000SATS`, `1INCH`, `HYPER`). If an explicit pair is rejected as unknown,
 * do NOT mutate it. If a lone base asset is queried, retry once as `<base>USDT`;
 * genuine unknown symbols still end as 404.
 */
async function getDataWithUsdtFallback(
  client,
  path,
  params,
  requestedSymbol,
  retryOptions,
  rawSymbol,
) {
  try {
    return {
      data: await getData(client, path, params, retryOptions),
      symbol: requestedSymbol,
    };
  } catch (error) {
    if (
      error?.code !== "MARKET_DATA_NOT_FOUND" ||
      isExplicitCryptoPair(requestedSymbol, rawSymbol) ||
      !/^[A-Z0-9]{2,30}$/.test(requestedSymbol)
    ) {
      throw error;
    }

    const fallbackSymbol = `${requestedSymbol}USDT`;
    return {
      data: await getData(
        client,
        path,
        { ...params, symbol: fallbackSymbol },
        retryOptions,
      ),
      symbol: fallbackSymbol,
    };
  }
}

function createBinanceMarketDataProvider(config = {}, { httpClient } = {}) {
  const retryOptions = config.retry
    ? {
        retries: config.retry.maxRetries,
        baseDelayMs: config.retry.baseDelayMs,
        maxDelayMs: config.retry.maxDelayMs,
      }
    : {};
  const client =
    httpClient ||
    createHttpClient({
      baseURL: config.baseUrl,
      timeoutMs: config.timeoutMs,
      retry: config.retry,
    });

  return {
    id: "binance",
    assetClasses: ["CRYPTO"],
    operations: ["quote", "history", "overview", "search"],
    markets: ["GLOBAL"],

    toProviderSymbol: (symbol, options) =>
      normalizeBinanceSymbol(symbol, options),

    async getQuote(symbol) {
      const { requestedSymbol, rawSymbol } = prepareBinanceSymbol(symbol);
      const { data: payload, symbol: providerSymbol } =
        await getDataWithUsdtFallback(
          client,
          "/api/v3/ticker/24hr",
          { symbol: requestedSymbol },
          requestedSymbol,
          retryOptions,
          rawSymbol,
        );
      return mapBinanceQuote(payload, providerSymbol);
    },

    async getHistoricalPrices(symbol, { interval, from, to, limit = 500 }) {
      if (!BINANCE_INTERVALS.has(interval)) {
        throw createMarketDataError(
          "Historical interval is not supported.",
          400,
          "MARKET_DATA_INVALID_REQUEST",
        );
      }
      const { requestedSymbol, rawSymbol } = prepareBinanceSymbol(symbol);
      const { data, symbol: providerSymbol } = await getDataWithUsdtFallback(
        client,
        "/api/v3/klines",
        {
          symbol: requestedSymbol,
          interval,
          startTime: from,
          endTime: to,
          limit,
        },
        requestedSymbol,
        retryOptions,
        rawSymbol,
      );
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
        symbol: `BINANCE:${providerSymbol}`,
        assetClass: "CRYPTO",
        interval,
        prices,
      };
    },

    async getMarketOverview({ limit = 10 } = {}) {
      const data = await getData(
        client,
        "/api/v3/ticker/24hr",
        {},
        retryOptions,
      );
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
      if (typeof query !== "string" || !query.trim()) {
        return [];
      }
      const data = assertObject(
        await getData(client, "/api/v3/exchangeInfo", {}, retryOptions),
      );
      if (!Array.isArray(data.symbols)) throw invalidProviderResponse();
      const normalizedQuery = query.trim().toUpperCase();

      // exchangeInfo is not relevance-ordered, so a plain slice can put
      // ETHBTC ahead of BTCUSDT for the query "BTC". Rank exact base-asset
      // matches with a USD quote first, then fall back to prefix/substring
      // matches while preserving the provider's original order.
      return data.symbols
        .filter(
          (item) =>
            item &&
            typeof item.symbol === "string" &&
            item.status === "TRADING" &&
            item.symbol.includes(normalizedQuery),
        )
        .map((item, index) => {
          if (
            typeof item.baseAsset !== "string" ||
            typeof item.quoteAsset !== "string"
          ) {
            throw invalidProviderResponse();
          }

          const base = item.baseAsset.toUpperCase();
          const quote = item.quoteAsset.toUpperCase();
          let relevance = 0;

          if (base === normalizedQuery) relevance += 100;
          else if (base.startsWith(normalizedQuery)) relevance += 50;
          else if (item.symbol.startsWith(normalizedQuery)) relevance += 25;

          if (quote === "USDT") relevance += 10;
          else if (quote === "USDC") relevance += 5;

          return { item, index, relevance };
        })
        .sort(
          (left, right) =>
            right.relevance - left.relevance || left.index - right.index,
        )
        .slice(0, 25)
        .map(({ item }) => ({
          symbol: `BINANCE:${item.symbol}`,
          name: `${item.baseAsset}/${item.quoteAsset}`,
          assetClass: "CRYPTO",
          exchange: "BINANCE",
          currency: item.quoteAsset,
          type: "CRYPTO",
          source: "binance",
        }));
    },
  };
}

module.exports = { createBinanceMarketDataProvider };
