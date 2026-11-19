# 📡 Market Data Integration

> **Finnhub (US stocks) + Binance (crypto) + Yahoo Finance (stock-history fallback).**

---

## 📌 Table of Contents

- [Overview](#-overview)
- [API Comparison](#-api-comparison)
- [Why Multiple Providers?](#-why-multiple-providers)
- [Symbol Normalization](#-symbol-normalization)
- [Finnhub Integration](#-finnhub-integration)
- [Binance Integration](#-binance-integration)
- [Yahoo Finance Integration](#-yahoo-finance-integration)
- [Provider Registry & Fallback Strategy](#-provider-registry--fallback-strategy)
- [Batch Quotes Endpoint](#-batch-quotes-endpoint)
- [Rate Limit Handling](#-rate-limit-handling)

---

## 📖 Overview

stox uses an ordered provider chain per asset class:

- **Finnhub** — US stock quotes, search, market status, and paid-plan candles
- **Binance** — public crypto quotes, candles, movers, and symbol search
- **Yahoo Finance** — free stock-history fallback, including international
  exchange suffixes such as `VOD.L` (London), `7203.T` (Tokyo), and
  `RELIANCE.NS` (India)

The runtime defaults are `STOCK: finnhub → yahoo` and `CRYPTO: binance`. The
service tries the primary provider first and moves to the next provider when
the primary cannot serve the request (missing/invalid credentials, free-plan
rejection, timeout, rate limit, outage, malformed response, or unknown symbol).
Client-side validation errors never trigger a fallback.

Providers are registered in `backend/src/providers/createMarketDataProviders.js`
and declare their asset classes, supported operations, and market coverage.
Adding a provider is one adapter module plus one registry entry; the service,
controllers, and routes do not change.


---

## 📊 API Comparison

| Feature              | Finnhub                                            | Binance                        | Yahoo Finance (fallback) |
| -------------------- | -------------------------------------------------- | ------------------------------ | ------------------------ |
| **Asset Class**      | US stocks                                           | Crypto only                    | Global stocks            |
| **Operations**       | Quote, history, search, market status               | Quote, history, search, movers | History only             |
| **Free Tier**        | 60 calls/min; candles require a paid plan           | Unlimited (public)             | Unofficial, rate-limited |
| **WebSocket**        | ✅ Yes                                             | ✅ Yes                         | ❌ No                    |
| **API Key Required** | ✅ Yes                                             | ❌ No (public data)            | ❌ No                    |
| **Rate Limit**       | 60/min (REST)                                       | 1200/min                       | Aggressive; no SLA       |
| **Signup**           | [finnhub.io/register](https://finnhub.io/register) | None                           | None                     |
| **Best For**         | US stock quotes + metadata                          | Crypto                         | Stock candle fallback    |

---

## 🎯 Why Multiple Providers?

| Reason                         | Explanation                                          |
| ------------------------------ | ---------------------------------------------------- |
| **Dual asset classes**         | Users can trade both stocks AND crypto               |
| **Crypto never sleeps**        | Binance provides 24/7 live data                      |
| **Stocks for professionalism** | Finnhub adds traditional finance credibility         |
| **Operational fallback**       | A Finnhub free-plan 403 no longer breaks every chart |
| **International stocks**       | Yahoo suffix routing unlocks non-US listings         |
| **Resume value**               | Shows a real provider-abstraction layer              |

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

### Quote & Ticker Fallback Logic

When querying Binance for crypto symbols:
- **Bare base assets** (e.g., `BTC`, `ETH`, `SOL`): The provider attempts to append the default quote currency (`USDT`) if a bare symbol lookup returns a 404 (e.g., query `BTC` -> fallback to `BTCUSDT`).
- **Explicit crypto pairs** (e.g., `ETHBTC`, `SOLFDUSD`, `BTCEUR`): The provider detects explicit quote asset suffixes (`BTC`, `ETH`, `BNB`, `USDT`, `USDC`, `BUSD`, `FDUSD`, `EUR`, `TRY`, `GBP`, `DAI`, `PAX`, `TUSD`). If an explicit pair is queried and returns 404 from Binance, it **does NOT** append `USDT` (e.g. `ETHBTC` is not mutated into `ETHBTCUSDT`), preventing bogus fallback lookups and immediately returning a 404 domain error (`MARKET_DATA_NOT_FOUND`).
- **Symbol search query sanitization**: `searchSymbols(query)` guards against non-string and empty inputs, trimming whitespace and returning an empty result set `[]` when queries are blank or invalid.


---

## 🟠 Yahoo Finance Integration

Yahoo is the **stock-history fallback**. It is not a full market-data provider:
the adapter declares `operations: ["history"]`, so quotes, search, and overview
never route to it.

**No API key.** The adapter calls:

```text
GET {YAHOO_FINANCE_API_URL}/v8/finance/chart/{symbol}
    ?period1=<from seconds>&period2=<to seconds + 1>&interval=<yahoo interval>&events=history
```

- A browser-like `User-Agent` is mandatory; Yahoo rejects requests without one.
- `from`/`to` are epoch **milliseconds** in the Stox API. They are converted to
  seconds for Yahoo. Passing seconds produces a 1970 window and an HTTP 400.
- `4h` is synthetic: 1h candles are aggregated into UTC 4-hour buckets.
- International listings use Yahoo's exchange suffixes: `VOD.L`, `7203.T`,
  `RELIANCE.NS`, `SHOP.TO`, `ASML.AS`, `SAP.DE`, `0700.HK`, `BHP.AX`.
- Null OHLC rows outside a trading session are skipped.
- HTTP 404 → `MARKET_DATA_NOT_FOUND`; 429/418 → `MARKET_DATA_RATE_LIMITED`;
  408/504 and fetch timeouts → `MARKET_DATA_TIMEOUT`; other failures →
  `MARKET_DATA_PROVIDER_UNAVAILABLE`.
- Yahoo is unofficial, has no SLA, and rate-limits aggressively. A 429 is not
  retried against the same provider.
- Arbitrary-precision candle bucketing: Aggregations for synthetic intervals (e.g., 4h buckets computed from 1h candles) use `Prisma.Decimal` arithmetic to eliminate floating-point precision drift in volume, open, high, low, and close values.
- Delisted & unknown ticker handling: When Yahoo returns an empty result set or error payload indicating delisted or nonexistent symbols, it maps to HTTP 404 `MARKET_DATA_NOT_FOUND`.

### 🌍 International Stock Quote Capabilities and Limitations

Because stox maintains strict provider capability declarations:
1. **Finnhub**: Declares `markets: ["US"]` and operations `["quote", "history", "search", "market-status"]`.
2. **Yahoo Finance**: Declares `markets: ["*"]` and operations `["history"]` only.

**Implications for International Instruments** (e.g. `RELIANCE.NS`, `7203.T`, `VOD.L`):
- **Historical Candlestick Charts (`GET /api/v1/market/history`)**: Fully supported via Yahoo Finance fallback. Requests for non-US symbols skip Finnhub and route directly to Yahoo Finance.
- **Live Real-Time Quotes (`GET /api/v1/market/quote`)**: Currently **unsupported** for non-US equity tickers. Finnhub cannot serve non-US markets, and Yahoo Finance does not provide a reliable real-time quote contract (`operations: ["history"]`). When a live quote is requested for an international ticker, the router exhausts the provider chain and returns `503 MARKET_DATA_PROVIDER_UNAVAILABLE`. Real-time international quotes will require registering a dedicated international quote provider (e.g. Twelve Data or Alpha Vantage) in the provider registry.


---

## 🔄 Provider Registry & Fallback Strategy

The registry lives in `backend/src/providers/createMarketDataProviders.js`.
Each adapter declares:

```javascript
{
    id: "yahoo",
    assetClasses: ["STOCK"],
    operations: ["history"], // quote | history | overview | search
    markets: ["*"],          // ["US"], ["GB", "DE"], or ["GLOBAL"]
    toProviderSymbol(canonicalSymbol, options),
    getHistoricalPrices(symbol, options),
    // ...other supported operations
}
```

The service builds an ordered candidate list before calling anything:

1. Read the asset-class chain (`STOCK: finnhub,yahoo`, `CRYPTO: binance` by
   default; override with `MARKET_DATA_STOCK_PROVIDERS` /
   `MARKET_DATA_CRYPTO_PROVIDERS`).
2. Remove ids that are not registered.
3. Remove adapters that do not serve the asset class or operation.
4. For symbol-specific calls (quote/history), remove adapters whose `markets`
   do not cover the instrument's inferred region.

The region comes from the exchange suffix (`VOD.L` → `GB`, `7203.T` → `JP`);
plain and unrecognised suffixes default to `US`, and crypto is `GLOBAL`.
`overview` and `search` are market-wide, so they are not region-filtered.

The primary provider is tried first. A provider-side failure moves to the next
provider; a client-side validation error is returned immediately.

| Failure                                   | Fallback? |
| ----------------------------------------- | --------- |
| Missing/invalid credentials               | Yes       |
| Free-plan resource rejection (Finnhub 403) | Yes       |
| Timeout, rate limit, provider outage      | Yes       |
| Unknown symbol / no data                  | Yes       |
| Malformed provider payload                | Yes       |
| Invalid request or wrong asset class      | No        |

When every provider fails, the last safe domain error is returned. The API
envelope never contains raw provider messages, response bodies, or credentials.
Fallback attempts are logged with provider ids and a stable error code.

### Adding a provider or a new country

1. Create `backend/src/providers/<id>MarketDataProvider.js` implementing the
   adapter contract.
2. Add one entry to `PROVIDER_DEFINITIONS` in `createMarketDataProviders.js`.
3. Add its environment config (base URL / key) to `marketDataConfig.js` and
   `.env.example`.
4. Put its id in the relevant `MARKET_DATA_*_PROVIDERS` chain.
5. Declare `markets` so it is selected only for the countries it covers.

No controller, route, service, or symbol-mapping change is required. The
service filters by declared capability and region, and calls the provider's own
`toProviderSymbol` so each provider can express symbols in its native format.

### Why not retry the same provider?

In-call retries amplify throttling and can return stale data. The implemented
strategy is failover to a different provider, not retry. Queue-level retries
remain the right place for transient background work.

## 📦 Batch Quotes Endpoint

`GET /api/v1/market/quotes`

The batch quote endpoint allows fetching quotes for multiple symbols (stocks and crypto) in a single HTTP round-trip:

```http
GET /api/v1/market/quotes?symbols=AAPL,MSFT,BTCUSDT
GET /api/v1/market/quotes?symbols=AAPL&symbols=BTCUSDT
```

### Query Semantics and Validation
- **Input Formats**: Accepts both comma-separated strings (`?symbols=AAPL,MSFT`) and repeated query parameters (`?symbols=AAPL&symbols=MSFT`).
- **Deduplication**: Symbols are trimmed, uppercased, and deduplicated case-insensitively before dispatching requests.
- **Symbol Boundary**: Enforces between **1 and 20** symbols per batch. Empty requests fail with `400 BAD_REQUEST`; exceeding 20 symbols fails with `400 BAD_REQUEST`.
- **Parallel Dispatch**: Symbols are fetched concurrently using `Promise.allSettled`.
- **Partial Failure Semantics**:
  - The response returns `200 OK` with an array of quote objects for all successfully resolved symbols.
  - If a particular symbol fails (e.g., nonexistent ticker, provider rate limit, or unsupported international equity quote), that symbol is omitted or reported without failing the entire batch request.
  - Frontend consumers (such as portfolio tables or market tickers) receive available quotes immediately without being blocked by an individual ticker failure.

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
