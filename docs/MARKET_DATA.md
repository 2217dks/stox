# 📡 Market Data Integration

> **Finnhub (stocks) + Binance (crypto) integration for stox.**

---

## 📌 Table of Contents

- [Overview](#-overview)
- [API Comparison](#-api-comparison)
- [Why Both?](#-why-both)
- [Symbol Normalization](#-symbol-normalization)
- [Finnhub Integration](#-finnhub-integration)
- [Binance Integration](#-binance-integration)
- [Fallback Strategy](#-fallback-strategy)
- [Rate Limit Handling](#-rate-limit-handling)

---

## 📖 Overview

stox uses **two market data providers**:

- **Finnhub** — US stocks, forex, news, fundamentals
- **Binance** — Crypto prices, order book, trade tape

Both provide **WebSocket streams** for real-time data and **REST APIs** for historical data.

---

## 📊 API Comparison

| Feature              | Finnhub                                            | Binance             |
| -------------------- | -------------------------------------------------- | ------------------- |
| **Asset Class**      | US Stocks, Forex, Crypto                           | Crypto only         |
| **Free Tier**        | 60 calls/min                                       | Unlimited (public)  |
| **WebSocket**        | ✅ Yes                                             | ✅ Yes              |
| **API Key Required** | ✅ Yes                                             | ❌ No (public data) |
| **Rate Limit**       | 60/min (REST)                                      | 1200/min            |
| **Signup**           | [finnhub.io/register](https://finnhub.io/register) | None                |
| **Best For**         | Stocks + Forex                                     | Crypto              |

---

## 🎯 Why Both?

| Reason                         | Explanation                                  |
| ------------------------------ | -------------------------------------------- |
| **Dual asset classes**         | Users can trade both stocks AND crypto       |
| **Crypto never sleeps**        | Binance provides 24/7 live data              |
| **Stocks for professionalism** | Finnhub adds traditional finance credibility |
| **Fallback**                   | If one fails, the other keeps working        |
| **Resume value**               | Shows multiple API integration               |

---

## 🔤 Symbol Normalization & Canonical Mapping Layer

stox centralizes all instrument mapping, asset class inference, provider translation, and display formatting in `backend/src/services/symbolMappingService.js` (and re-exports helpers via `symbolUtils.js`):

```javascript
const {
    toCanonicalSymbol,
    toProviderSymbol,
    toDisplaySymbol,
    parseSymbol,
    inferAssetClass,
    normalizeAssetClass,
    resolveSymbol,
} = require("./services/symbolMappingService");

// 1. Canonical symbol mapping (provider-agnostic domain identity):
toCanonicalSymbol("BINANCE:BTCUSDT");   // -> "BTCUSDT"
toCanonicalSymbol("BTC/USDT");           // -> "BTCUSDT"
toCanonicalSymbol("FINNHUB:AAPL");       // -> "AAPL"

// 2. Provider-specific translation:
toProviderSymbol("BTCUSDT", "binance");  // -> "BTCUSDT" (for Binance REST & streams)
toProviderSymbol("AAPL", "finnhub");     // -> "AAPL"    (for Finnhub REST /quote)

// 3. Human display formatting:
toDisplaySymbol("BTCUSDT");              // -> "BTC/USDT"
toDisplaySymbol("AAPL");                 // -> "AAPL"

// 4. Structured metadata parsing:
parseSymbol("BINANCE:BTC/USDT");
// -> {
//      canonicalSymbol: "BTCUSDT",
//      providerSymbol: "BTCUSDT",
//      displaySymbol: "BTC/USDT",
//      assetClass: "CRYPTO",
//      provider: "binance",
//      exchange: "BINANCE",
//      baseAsset: "BTC",
//      quoteAsset: "USDT"
//    }

// 5. Database-backed resolution with PostgreSQL Prisma `Symbol` model:
const instrument = await resolveSymbol("AAPL", { prisma });
// -> {
//      canonicalSymbol: "AAPL",
//      assetClass: "STOCK",
//      name: "Apple Inc.",
//      exchange: "NASDAQ",
//      source: "database"
//    }
```

### Ambiguous Symbols & Disambiguation Rules

A bare suffix is not enough: tickers such as `GBTC`, `METH`, `SOL`, `COIN`, `RIOT`, `BITO`, and `ETHE` end in crypto quote assets or overlap crypto tickers, but represent equities or ETFs.
- Symbols in `KNOWN_AMBIGUOUS_STOCKS` default to `STOCK`.
- Non-empty base assets of at least 2 characters before quote assets (`USDT`, `BTC`, `ETH`) infer `CRYPTO`.
- Clients can pass an explicit `assetClass` (`STOCK` or `CRYPTO`) to override inference for ambiguous instruments.

### Database Precedence & Resolution Rules (`resolveSymbol`)

All market-data paths (`getQuote`, `getHistoricalPrices`, `getHistoricalPrice`) resolve instruments through `resolveSymbol()`:

1. **Authoritative Database Precedence**:
   - When a symbol exists in the PostgreSQL `Symbol` table, its database metadata (`assetType`, `exchange`, `currency`) takes absolute precedence over syntax-based inference.
   - For example, an equity registered as `XYZUSDT` with `assetType: "STOCK"` routes to Finnhub as a stock despite ending in `USDT`.
   - A single-token cryptocurrency registered as `ETH` with `assetType: "CRYPTO"` routes to Binance as crypto (`ETHUSDT`) despite having no slash or pair suffix.
2. **Inactive Symbol Enforcement**:
   - Inactive database records (`isActive: false`) are rejected with `404 SYMBOL_NOT_FOUND` ("Active symbol not found.") unless `includeInactive: true` is explicitly provided.
3. **Unknown Symbols & Fallback**:
   - Symbols without a database record fall back to deterministic rule-based inference (`source: "rule"`) by default.
   - When `strict: true` is supplied, unknown symbols throw `404 SYMBOL_NOT_FOUND`.
4. **Strict Prefix & Asset-Class Compatibility**:
   - Conflicting provider prefixes (`FINNHUB:BTCUSDT`, `BINANCE:AAPL`, `BINANCE:GBTC`, `FINNHUB:BTC/USDT`) throw `400 MARKET_DATA_INVALID_REQUEST`.
   - Explicit asset classes conflicting with prefixes (e.g. `FINNHUB:AAPL` with `assetClass: "CRYPTO"`, or `BINANCE:BTCUSDT` with `assetClass: "STOCK"`) throw `422 MARKET_DATA_UNSUPPORTED_ASSET_CLASS`.
   - Slash-form crypto notation with conflicting explicit asset class (`BTC/USDT` with `assetClass: "STOCK"`) throws `422 MARKET_DATA_UNSUPPORTED_ASSET_CLASS`.
   - Querying a database record with a conflicting explicit asset class (e.g. `AAPL` with `assetClass: "CRYPTO"`) throws `400 ASSET_TYPE_MISMATCH`.

---

## 🔵 Finnhub Integration

**Signup:** [finnhub.io/register](https://finnhub.io/register) — free, instant API key

**WebSocket Example:**

```javascript
const WebSocket = require("ws");
const socket = new WebSocket(`wss://ws.finnhub.io?token=${FINNHUB_API_KEY}`);

socket.on("open", () => {
    // Subscribe to Apple, Tesla
    socket.send(JSON.stringify({ type: "subscribe", symbol: "AAPL" }));
    socket.send(JSON.stringify({ type: "subscribe", symbol: "TSLA" }));
});

socket.on("message", (data) => {
    const parsed = JSON.parse(data);
    if (parsed.type === "trade") {
        parsed.data.forEach((trade) => {
            console.log(`${trade.s}: $${trade.p}`);
        });
    }
});
```

**REST Example (Historical):**

```javascript
const response = await fetch(
    `https://finnhub.io/api/v1/stock/candle?symbol=AAPL&resolution=D&from=${from}&to=${to}&token=${API_KEY}`,
);
```

**Rate Limit:** 60 calls/min (REST). Use a token-bucket limiter.

---

## 🟡 Binance Integration

**Signup:** None required for public market data.

**WebSocket Example:**

```javascript
const WebSocket = require("ws");

// Multi-stream for multiple pairs
const streams = ["btcusdt@trade", "ethusdt@trade", "solusdt@trade"];
const url = `wss://stream.binance.com:9443/stream?streams=${streams.join("/")}`;

const socket = new WebSocket(url);

socket.on("message", (data) => {
    const parsed = JSON.parse(data);
    const trade = parsed.data;

    if (trade && trade.e === "trade") {
        console.log(`${trade.s}: $${trade.p}`);
    }
});
```

**Depth Stream (for order book):**

```javascript
const depthSocket = new WebSocket(
    "wss://stream.binance.com:9443/ws/btcusdt@depth20@100ms",
);
```

**Rate Limit:** 1200 requests/min (very generous). WebSocket has no practical limit.

---

## 🔄 Fallback Strategy

```javascript
// services/priceService.js
export async function getPrice(symbol) {
    // 1. Try Redis cache first
    const cached = await cache.getPrice(symbol);
    if (cached) return cached;

    // 2. Try Finnhub REST (stocks)
    if (!symbol.startsWith("BINANCE:")) {
        try {
            await finnhubLimiter.waitIfNeeded();
            const response = await fetch(
                `https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${process.env.FINNHUB_API_KEY}`,
            );
            const data = await response.json();
            if (data.c) {
                const priceData = { symbol, price: data.c, source: "finnhub" };
                await cache.setPrice(symbol, priceData);
                return priceData;
            }
        } catch (err) {
            console.error("Finnhub failed:", err);
        }
    }

    // 3. Try Binance REST (crypto)
    if (symbol.startsWith("BINANCE:")) {
        try {
            const pair = symbol.replace("BINANCE:", "");
            const response = await fetch(
                `https://api.binance.com/api/v3/ticker/price?symbol=${pair}`,
            );
            const data = await response.json();
            if (data.price) {
                const priceData = {
                    symbol,
                    price: parseFloat(data.price),
                    source: "binance",
                };
                await cache.setPrice(symbol, priceData);
                return priceData;
            }
        } catch (err) {
            console.error("Binance failed:", err);
        }
    }

    // 4. Try Yahoo Finance (fallback for stocks)
    try {
        const yahooFinance = require("yahoo-finance2").default;
        const quote = await yahooFinance.quote(symbol);
        return { symbol, price: quote.regularMarketPrice, source: "yahoo" };
    } catch (err) {
        console.error("Yahoo failed:", err);
    }

    // 5. Return last known price from DB
    const lastKnown = await prisma.priceHistory.findFirst({
        where: { symbol: { symbol } },
        orderBy: { timestamp: "desc" },
    });

    return lastKnown
        ? { symbol, price: lastKnown.price, source: "database" }
        : null;
}
```

---

## ⏱️ Rate Limit Handling

```javascript
// utils/rateLimiter.js
class RateLimiter {
    constructor(maxRequests, windowMs) {
        this.maxRequests = maxRequests;
        this.windowMs = windowMs;
        this.requests = [];
    }

    async waitIfNeeded() {
        const now = Date.now();
        this.requests = this.requests.filter((t) => now - t < this.windowMs);

        if (this.requests.length >= this.maxRequests) {
            const oldest = this.requests[0];
            const waitTime = this.windowMs - (now - oldest);
            await new Promise((resolve) => setTimeout(resolve, waitTime));
            return this.waitIfNeeded();
        }

        this.requests.push(now);
    }
}

// Usage: Finnhub allows 60 calls/min
const finnhubLimiter = new RateLimiter(60, 60000);
```
