const { Prisma } = require("@prisma/client");
const { createMarketDataError } = require("./marketDataErrors");
const { decimalString, isoTimestamp } = require("./marketDataHttp");

const DEFAULT_YAHOO_BASE_URL = "https://query1.finance.yahoo.com";
const YAHOO_CHART_PATH = "/v8/finance/chart";
const YAHOO_USER_AGENT = "Mozilla/5.0 (compatible; Stox/1.0)";
const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;

// Yahoo has no native 4h interval; fetch 1h and aggregate.
const YAHOO_INTERVALS = Object.freeze({
  "1m": "1m",
  "5m": "5m",
  "15m": "15m",
  "30m": "30m",
  "1h": "60m",
  "4h": "60m",
  "1d": "1d",
  "1w": "1wk",
  "1M": "1mo",
});

function invalidResponse() {
  return createMarketDataError(
    "Stock history provider returned an invalid response.",
    502,
    "MARKET_DATA_INVALID_RESPONSE",
  );
}

function providerUnavailable() {
  return createMarketDataError(
    "The stock history provider is temporarily unavailable.",
    503,
    "MARKET_DATA_PROVIDER_UNAVAILABLE",
  );
}

function mapYahooHttpError(status) {
  if (status === 404) {
    return createMarketDataError(
      "Historical prices are unavailable for this symbol.",
      404,
      "MARKET_DATA_NOT_FOUND",
    );
  }

  if (status === 429 || status === 418) {
    return createMarketDataError(
      "Stock history provider rate limit reached.",
      429,
      "MARKET_DATA_RATE_LIMITED",
    );
  }

  if (status === 408 || status === 504) {
    return createMarketDataError(
      "Stock history provider request timed out.",
      504,
      "MARKET_DATA_TIMEOUT",
    );
  }

  return providerUnavailable();
}

function isTimeoutError(error) {
  return (
    error?.name === "TimeoutError" ||
    error?.name === "AbortError" ||
    error?.code === "ETIMEDOUT" ||
    error?.code === "ECONNABORTED" ||
    /timeout|timed out/i.test(String(error?.message || ""))
  );
}

function aggregateCandles(candles, bucketMs) {
  const buckets = new Map();

  for (const candle of candles) {
    const timestampMs = new Date(candle.timestamp).getTime();
    const bucket = Math.floor(timestampMs / bucketMs) * bucketMs;
    const existing = buckets.get(bucket);

    if (!existing) {
      buckets.set(bucket, {
        timestamp: new Date(bucket).toISOString(),
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candle.volume,
      });
      continue;
    }

    try {
      const highDec = Prisma.Decimal.max(existing.high, candle.high);
      const lowDec = Prisma.Decimal.min(existing.low, candle.low);
      const volDec = new Prisma.Decimal(existing.volume).plus(
        new Prisma.Decimal(candle.volume),
      );
      existing.high = highDec.toString();
      existing.low = lowDec.toString();
      existing.volume = volDec.toString();
    } catch {
      existing.high = String(
        Math.max(Number(existing.high), Number(candle.high)),
      );
      existing.low = String(Math.min(Number(existing.low), Number(candle.low)));
      existing.volume = String(Number(existing.volume) + Number(candle.volume));
    }
    existing.close = candle.close;
  }

  return Array.from(buckets.values()).sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );
}

/**
 * Convert a Yahoo Finance chart response into the normalized historical-price
 * shape used by the market-data service. Pure so it can be unit tested without
 * network access.
 */
function mapYahooChart(payload, { symbol, interval }) {
  const chartError = payload?.chart?.error;
  if (chartError) {
    const errorMsg = String(chartError.description || chartError.code || "");
    if (/not found|no data|delisted|invalid symbol/i.test(errorMsg)) {
      throw createMarketDataError(
        "Historical prices are unavailable for this symbol.",
        404,
        "MARKET_DATA_NOT_FOUND",
      );
    }
    throw invalidResponse();
  }

  const result = payload?.chart?.result?.[0];

  if (!result) {
    throw invalidResponse();
  }

  // Yahoo omits timestamps/quote arrays when the requested window contains no
  // trading session (for example, 5m candles requested overnight).
  if (!Array.isArray(result.timestamp)) {
    return { symbol, assetClass: "STOCK", interval, prices: [] };
  }

  const quote = result.indicators?.quote?.[0];

  if (!quote) {
    return { symbol, assetClass: "STOCK", interval, prices: [] };
  }

  const lows = quote.low || [];
  const highs = quote.high || [];
  const opens = quote.open || [];
  const closes = quote.close || [];
  const volumes = quote.volume || [];

  const candles = [];

  result.timestamp.forEach((timestamp, index) => {
    const open = decimalString(opens[index]);
    const high = decimalString(highs[index]);
    const low = decimalString(lows[index]);
    const close = decimalString(closes[index]);
    const volume = decimalString(volumes[index]) ?? "0";
    const isoTs = isoTimestamp(timestamp, { unit: "seconds" });

    // Yahoo pads the series with nulls outside the trading session.
    if (!isoTs || !open || !high || !low || !close) return;

    candles.push({
      timestamp: isoTs,
      open,
      high,
      low,
      close,
      volume,
    });
  });

  return {
    symbol,
    assetClass: "STOCK",
    interval,
    prices:
      interval === "4h" ? aggregateCandles(candles, FOUR_HOURS_MS) : candles,
  };
}

function buildChartUrl(baseUrl, symbol, params) {
  const base = String(baseUrl || DEFAULT_YAHOO_BASE_URL).replace(/\/+$/, "");
  return `${base}${YAHOO_CHART_PATH}/${encodeURIComponent(symbol)}?${params.toString()}`;
}

async function fetchYahooHistoricalPrices(
  symbol,
  {
    interval,
    from,
    to,
    timeoutMs = 5000,
    baseUrl = DEFAULT_YAHOO_BASE_URL,
    fetchImpl,
    userAgent = YAHOO_USER_AGENT,
  } = {},
) {
  const yahooInterval = YAHOO_INTERVALS[interval];

  if (!yahooInterval) {
    throw createMarketDataError(
      "Historical interval is not supported.",
      400,
      "MARKET_DATA_INVALID_REQUEST",
    );
  }

  const params = new URLSearchParams({
    period1: String(Math.floor(from / 1000)),
    period2: String(Math.floor(to / 1000) + 1),
    interval: yahooInterval,
    events: "history",
  });

  const request = fetchImpl || global.fetch;
  let response;

  try {
    response = await request(buildChartUrl(baseUrl, symbol, params), {
      headers: {
        Accept: "application/json",
        "User-Agent": userAgent,
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (isTimeoutError(error)) {
      throw createMarketDataError(
        "Stock history provider request timed out.",
        504,
        "MARKET_DATA_TIMEOUT",
      );
    }
    throw providerUnavailable();
  }

  if (!response.ok) {
    throw mapYahooHttpError(response.status);
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw invalidResponse();
  }

  return mapYahooChart(payload, { symbol, interval });
}

module.exports = {
  DEFAULT_YAHOO_BASE_URL,
  YAHOO_USER_AGENT,
  aggregateCandles,
  fetchYahooHistoricalPrices,
  mapYahooChart,
};
