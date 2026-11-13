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

## 🔤 Symbol Normalization

```javascript
// services/marketDataService.js

// Stocks are the default: any ticker Finnhub recognises, not a fixed list.
// Crypto is inferred only for "BINANCE:..." or a pair with a real base asset
// and one of the adapter-supported quote assets (USDT, BTC, ETH).
const CRYPTO_PAIR = /^([A-Z0-9]{2,20})(?:USDT|BTC|ETH)$/;

function inferAssetClass(symbol) {
    if (symbol.startsWith("BINANCE:")) return "CRYPTO";
    return CRYPTO_PAIR.test(symbol) ? "CRYPTO" : "STOCK";
}

export function parseSymbol(symbol) {
    if (symbol.startsWith("BINANCE:")) {
        return {
            exchange: "BINANCE",
            pair: symbol.replace("BINANCE:", ""),
            assetType: "CRYPTO",
        };
    }
    return {
        exchange: "FINNHUB",
        ticker: symbol,
        assetType: "STOCK",
    };
}

export function formatSymbolForDisplay(symbol) {
    if (symbol.startsWith("BINANCE:")) {
        const pair = symbol.replace("BINANCE:", "");
        return pair.replace("USDT", "/USDT");
    }
    return symbol;
}
```

A bare suffix is not enough: tickers such as `GBTC` and `METH` end in `BTC`
and `ETH` but are stocks. Clients can also pass an explicit `assetClass` to
override inference for genuinely ambiguous symbols. Examples such as `AAPL`
and `MSFT` are illustrative; they are not an allow-list.

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
