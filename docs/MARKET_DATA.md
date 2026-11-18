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
- **Ambiguous symbols** (e.g. `ETH`, `GBTC`, `SOL`, `XYZ`): Single-token symbols that cannot be unambiguously classified from syntax alone accept explicit asset-class overrides (`STOCK` or `CRYPTO`), subject to authoritative database validation.
- **Unambiguous crypto instruments** (e.g. `BTCUSDT`, `ETHBTC`, `SOLUSDT`, `BTC/USDT`, `BINANCE:BTCUSDT`): Identified by major crypto base assets (`BTC`, `ETH`, `SOL`, `XRP`, `BNB`, etc.) or slash notation. An explicit `STOCK` override contradicting unambiguous crypto format is rejected with `422 MARKET_DATA_UNSUPPORTED_ASSET_CLASS`.

### 7-Step Resolution Precedence Hierarchy (`resolveSymbol`)

All market-data paths (`getQuote`, `getHistoricalPrices`, `getHistoricalPrice`) resolve instruments through `resolveSymbol()` according to a strict 7-step hierarchy:

1. **Step 1 — Basic Syntax Validation**:
   - Verify string type, non-empty, trimmed uppercase representation, and allowed character set (`[A-Z0-9._/:-]`).
2. **Step 2 — Separate Provider Prefix**:
   - Parse and extract provider prefix (`FINNHUB:`, `BINANCE:`, or none) via `parseProviderPrefix`. Unsupported prefixes (e.g. `UNKNOWN:`) are rejected with `400 MARKET_DATA_INVALID_REQUEST`.
   - Derive the underlying canonical symbol (e.g. `BINANCE:BTC/USDT` -> `BTCUSDT`, `FINNHUB:XYZUSDT` -> `XYZUSDT`).
   - Enforce prefix-level asset-class constraints upfront (`FINNHUB` + `CRYPTO` -> 422; `BINANCE` + `STOCK` -> 422).
3. **Step 3 — Authoritative Database Lookup**:
   - Query the PostgreSQL Prisma `Symbol` table for the underlying canonical symbol.
   - **Database Error Handling**: Database failures (connection drops, query errors) throw `500 DATABASE_ERROR` and do **NOT** silently fall back to rule-based inference. An explicit opt-in (`allowFallbackOnError: true`) is required to allow fallback during DB degradation.
4. **Step 4 — Validate Provider Prefix against DB Asset Class**:
   - If a database record exists, enforce that `FINNHUB:` targets a `STOCK` and `BINANCE:` targets a `CRYPTO`. Mismatches throw `400 MARKET_DATA_INVALID_REQUEST`.
   - Tickers like `FINNHUB:XYZUSDT` succeed when registered as `STOCK` in the database.
   - Enforce active status: inactive symbols throw `404 SYMBOL_NOT_FOUND` unless `includeInactive: true` is passed.
5. **Step 5 — Validate Explicit Asset Class against DB Metadata**:
   - If an explicit `assetClass` was requested and contradicts the database `assetType`, throw `400 ASSET_TYPE_MISMATCH`.
   - If all checks pass, return authoritative database metadata (`source: "database"`).
6. **Step 6 — Syntax-Based Inference (No Database Record)**:
   - If no database record exists (and `strict: true` is not set), apply deterministic syntax inference (`KNOWN_AMBIGUOUS_STOCKS`, `CRYPTO_PAIR_PATTERN`, `CRYPTO_SLASH_PATTERN`).
7. **Step 7 — Reject Contradictory Prefixes and Asset Classes**:
   - For unregistered symbols, reject prefixes that contradict inferred syntax (e.g. `FINNHUB:BTCUSDT` or unregistered `FINNHUB:XYZUSDT` where suffix infers crypto -> 400; `BINANCE:AAPL` -> 400).
   - Reject explicit `STOCK` overrides on unambiguous crypto notation (`422 MARKET_DATA_UNSUPPORTED_ASSET_CLASS`).
   - If valid, return rule-inferred metadata (`source: "rule"`).

### Database Query Deduplication

To prevent duplicate Prisma database lookups between `marketData.js` (caching wrapper) and `marketDataService.js` (provider execution service):
- `marketData.getQuote` and `marketData.getHistoricalPrice` resolve the symbol once upfront.
- Resolved metadata is passed into `marketDataService` via an internal `_resolved` property.
- `resolveSymbol` validates that `_resolved` matches the requested symbol and asset class, reusing it directly and avoiding redundant database queries.

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
