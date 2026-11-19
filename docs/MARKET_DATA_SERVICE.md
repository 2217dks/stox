# Market Data Service Layer

This document describes the provider-independent backend service contract.
`docs/API.md` defines the public stock and crypto quote routes and market
overview response. Search remains internal until its full contract is agreed.

## Service construction

`backend/src/services/marketDataService.js` exports
`createMarketDataService({ config, providers })`. The returned service exposes
`getQuote`, `getHistoricalPrices`, `getMarketOverview`, and `searchSymbols`.
The service validates inputs, selects providers from the configured ordered
chains, checks normalized results, and converts provider/network failures into
Stox `AppError` values.

`backend/src/services/marketData.js` creates the default runtime service. The
composition code is in `backend/src/providers/createMarketDataProviders.js`;
that file is the single provider registry. Chain resolution, capability/market
filtering, symbol translation, and failover live in
`backend/src/providers/marketDataProviderRouter.js`, independently of any
concrete provider. Provider-specific HTTP requests and response parsing live in
the adapter files. Quote wire formats are mapped by
`backend/src/providers/marketQuoteMappers.js` into the shared
`backend/src/dtos/marketQuoteDto.js` contract. The service validates and
normalizes quotes through the same DTO before returning them. Tests can inject
fake adapters directly into `createMarketDataService` and do not make external
requests.

## Provider selection and fallback

Each asset class has an ordered provider chain, primary first:

| Asset class | Default chain    | Meaning                                      |
| ----------- | ---------------- | -------------------------------------------- |
| `STOCK`     | `finnhub,yahoo`  | Finnhub first; Yahoo history is the fallback |
| `CRYPTO`    | `binance`        | Binance public market data                   |

The service resolves candidates before making any request:

1. Read the chain for the resolved asset class.
2. Drop ids that are not registered adapters.
3. Drop adapters that do not declare the asset class.
4. Drop adapters that do not implement the requested operation
   (`quote`, `history`, `overview`, or `search`).
5. Drop adapters whose `markets` metadata does not cover the instrument's
   region. Region is inferred from the exchange suffix (`VOD.L` → `GB`,
   `7203.T` → `JP`, `RELIANCE.NS` → `IN`); plain and unrecognised suffixes
   default to `US`. `CRYPTO` is `GLOBAL`, and market-wide operations
   (`overview`, `search`) do not filter by region.

The first remaining adapter is called. On a provider-side failure the next
candidate is tried; client-side errors are returned immediately.

| Error code                            | Fall back? | Why                                       |
| ------------------------------------- | ---------- | ----------------------------------------- |
| `MARKET_DATA_INVALID_REQUEST`         | No         | The request itself is wrong               |
| `MARKET_DATA_UNSUPPORTED_ASSET_CLASS` | No         | The request itself is wrong               |
| `MARKET_DATA_NOT_CONFIGURED`          | Yes        | The next provider may be configured       |
| `MARKET_DATA_INVALID_CREDENTIALS`     | Yes        | A free plan or missing key can still fail |
| `MARKET_DATA_RATE_LIMITED`            | Yes        | Another provider may have quota           |
| `MARKET_DATA_TIMEOUT`                 | Yes        | Another provider may respond              |
| `MARKET_DATA_INVALID_RESPONSE`        | Yes        | A provider may be serving bad data        |
| `MARKET_DATA_NOT_FOUND`               | Yes        | Another provider may cover the symbol     |
| `MARKET_DATA_PROVIDER_UNAVAILABLE`    | Yes        | Network/provider outage                   |

When every candidate fails, the last safe domain error is surfaced. The
fallback attempt is logged with the operation, asset class, provider ids, and
error code; raw provider messages and response bodies are never logged or
returned. The service does not retry the same provider within one call.

### Adding a provider

Adding a provider requires one adapter module and one registry entry in
`createMarketDataProviders.js`. No service, controller, route, or symbol-mapping
change is required.

Adapters declare what they can serve:

```js
{
  id: "provider-id",
  assetClasses: ["STOCK"],                    // or ["CRYPTO"], or both
  operations: ["quote", "history"],           // omit to infer from methods
  markets: ["US", "GB"],                      // ["*"] or omit for global
  toProviderSymbol(canonicalSymbol, options), // optional translation
  getQuote(symbol),
  getHistoricalPrices(symbol, { interval, from, to, limit }),
  getMarketOverview({ assetClass, limit }),
  searchSymbols(query),
}
```

A provider that only implements `history` is automatically skipped for
quotes/search/overview. A provider that declares `markets: ["US"]` is
automatically skipped for a `VOD.L` request; a provider with `markets: ["*"]`
or no `markets` metadata remains eligible.

## Methods and normalized results

### `getQuote(symbol, { assetClass? })`

- `symbol`: nonempty string, up to 30 characters. Normalized, canonicalized,
  and resolved via `resolveSymbol(symbol, options)` following the 7-step
  precedence hierarchy (syntax validation -> prefix separation -> database lookup
  -> prefix validation vs DB -> explicit class validation -> syntax fallback ->
  rejection of contradictory combinations). Database errors throw 500
  `DATABASE_ERROR` rather than silently triggering rule fallback.
- `assetClass`: optional `STOCK` or `CRYPTO`. Mismatches against database
  metadata reject with `400 ASSET_TYPE_MISMATCH`, conflicts with provider
  prefixes or slash notation reject with `422 MARKET_DATA_UNSUPPORTED_ASSET_CLASS`,
  and explicit `STOCK` overrides on unambiguous crypto notation (e.g. `BTCUSDT`,
  `ETHBTC`, `BINANCE:`) reject with `422 MARKET_DATA_UNSUPPORTED_ASSET_CLASS`.
- Returns `{ symbol, assetClass, price, change, changePercent, high, low,
open, previousClose, volume, currency, timestamp, source }`.
- This exact object is the internal `MarketQuoteDto`. `symbol` and
  `assetClass` are uppercase, `source` and `currency` are lowercase and
  uppercase respectively. `price` is required and positive.
- Monetary and volume values are canonical decimal strings. The DTO expands
  exponent notation and removes insignificant zeros without rounding or
  floating-point arithmetic; negative zero becomes `"0"`.
- Optional numeric values, `currency`, and `timestamp` are always present and
  use `null` when the provider omits them. A non-null timestamp is normalized
  to an ISO 8601 UTC string. Invalid non-null values reject the provider result.

### `getHistoricalPrices(symbol, options)`

`options` requires `interval`, `from`, and `to`. `from` and `to` are inclusive
Unix epoch milliseconds with `to > from`. Intervals are `1m`, `5m`, `15m`,
`30m`, `1h`, `4h`, `1d`, `1w`, or `1M`. `limit` defaults to 500 and must be
from 1 to 1000. The end time cannot be in the future, and the requested range
cannot exceed `limit` interval periods (a month is bounded to 31 days for this
check). `assetClass` follows the quote rules.

Returns `{ symbol, assetClass, interval, prices }`. Each price is
`{ timestamp, open, high, low, close, volume }`; timestamps are ISO 8601 and
decimal values are canonical strings. Results are ordered by ascending
timestamp. No data for a valid range returns an empty array.

### `getMarketOverview({ assetClass, limit? })`

`assetClass` is required (`STOCK` or `CRYPTO`). `limit` defaults to 10 and is
from 1 to 100. Returns `{ assetClass, asOf, marketStatus, movers, source }`.
`marketStatus` is provider-normalized. `movers` is `null` when unavailable or
an array when supported; an empty array means the available feed returned no
movers. The Finnhub adapter reports US session status and has no mover feed.
The Binance adapter returns up to `limit` highest-percentage crypto movers.
`asOf` is the provider data timestamp where available, otherwise retrieval
time. See `docs/API.md` for the public route contract.

### `searchSymbols(query, { assetClass?, limit? })`

`query` is a nonempty string. If `assetClass` is omitted, results from both
configured asset classes are combined. `limit`, when present, is from 1 to 100.
Each result is normalized to exactly `{ symbol, name, assetClass, exchange,
currency, type, source }`; optional provider metadata is `null` where
unavailable. The public endpoint narrows query length and result limit as
documented in `docs/API.md`.

When both asset classes are requested, their result groups are interleaved
round-robin before the limit is applied. This keeps crypto pairs visible for
mixed queries such as `BTC`; a plain concatenation lets a stock search fill
every slot and hide the crypto results.

## Provider adapter contract

Provider adapters are registry entries keyed by a provider id. Each implements:

```js
{
  id: "provider-id",
  assetClasses: ["STOCK"],
  operations: ["quote", "history", "overview", "search"],
  markets: ["US"],
  toProviderSymbol(canonicalSymbol, { assetClass }),
  getQuote(symbol),
  getHistoricalPrices(symbol, { interval, from, to, limit }),
  getMarketOverview({ assetClass, limit }),
  searchSymbols(query),
}
```

Adapters return the normalized service result shapes above and throw
`AppError` or an HTTP-client error. The service remaps unknown adapter errors
to safe domain errors. Controllers call the configured service; they do not
import HTTP clients or provider adapters.

The repository's market-data documentation names Finnhub for stocks, Binance
for crypto, and Yahoo for the stock-history fallback. Those are the default
adapter selections. The service itself does not import any provider
implementation.

### Finnhub stock quotes

The Finnhub adapter requests `/quote` with the normalized stock symbol and
sends `FINNHUB_API_KEY` in the `X-Finnhub-Token` header. It maps Finnhub's
`c`, `d`, `dp`, `h`, `l`, `o`, `pc`, and `t` fields to the Stox quote's price,
change, percentage change, high, low, open, previous close, and ISO timestamp.
Finnhub's quote response does not include volume, so the normalized `volume`
is `null`. An all-zero quote with timestamp `0` is treated as an unknown or
unavailable symbol. HTTP authentication failures, throttling, timeouts, and
malformed payloads become the corresponding safe market-data domain errors.
The credential is configured in the environment and is not included in the
quote result or public error messages. The stock quote route uses this adapter
through the provider-independent service; controllers do not call Finnhub.

Finnhub declares `markets: ["US"]`. International symbols are therefore routed
straight to the global history fallback instead of being sent to Finnhub with
an exchange suffix it does not understand.

### Finnhub and Yahoo stock history

Finnhub requests `/stock/candle` with a resolution mapping
(`1m→1`, `5m→5`, `15m→15`, `30m→30`, `1h→60`, `4h→240`, `1d→D`, `1w→W`,
`1M→M`). Its free plan currently authorises `/quote` but rejects candle
requests with HTTP 403. The adapter maps that to
`MARKET_DATA_INVALID_CREDENTIALS`; the service then tries the next stock
provider in the chain.

Yahoo Finance is the default stock-history fallback
(`backend/src/providers/yahooMarketDataProvider.js`). It declares only
`operations: ["history"]` and `markets: ["*"]`, so it is never used for quotes,
search, or overview. It requests
`GET {YAHOO_FINANCE_API_URL}/v8/finance/chart/{symbol}` with Unix-second
`period1`/`period2`, `interval`, and `events=history`, and sends a browser-like
`User-Agent` (Yahoo rejects requests without one). The interval mapping is
`1m→1m`, `5m→5m`, `15m→15m`, `30m→30m`, `1h→60m`, `4h→60m`, `1d→1d`,
`1w→1wk`, `1M→1mo`.

Yahoo has no native 4h resolution, so the adapter fetches 1h candles and
aggregates them into UTC 4-hour buckets (open = first, high/low = max/min,
close = last, volume = sum). Null OHLC rows padded outside a trading session
are skipped; a response with no timestamps returns an empty series. HTTP 404
maps to `MARKET_DATA_NOT_FOUND`, 429/418 to `MARKET_DATA_RATE_LIMITED`,
408/504 and fetch timeouts to `MARKET_DATA_TIMEOUT`, and other non-OK or
network failures to `MARKET_DATA_PROVIDER_UNAVAILABLE`; an unparsable body maps
to `MARKET_DATA_INVALID_RESPONSE`.

Yahoo is unofficial and has no SLA or documented programmatic-use guarantee.
It rate-limits aggressively, and the adapter does not honour `Retry-After`.
`from`/`to` are epoch milliseconds; passing seconds silently produces a 1970
window that Yahoo rejects with HTTP 400.

### Binance quote behavior

The Binance adapter requests the public `/api/v3/ticker/24hr` endpoint using
the configured `BINANCE_API_URL` and shared request timeout. It accepts the
Stox crypto pair conventions `BTCUSDT`, `ETHBTC`, and `BINANCE:BTCUSDT`; a
slash form such as `BTC/USDT` is also normalized to `BTCUSDT`. Quote assets are
not whitelisted: Binance is the authority for pair existence, quote assets, and
trading status. Search returns every `TRADING` pair. This is syntax validation
only; Binance determines whether a pair exists and is trading. Stock-shaped
values such as `AAPL` are rejected before an adapter request is sent.

The returned internal quote maps Binance `lastPrice`, `priceChange`,
`priceChangePercent`, `highPrice`, `lowPrice`, `openPrice`, `prevClosePrice`,
`volume`, and `closeTime` to the normalized Stox quote fields. Numeric values
remain decimal strings. The adapter requires all those values, a positive
price, and a response symbol matching the requested pair; incomplete,
malformed, or mismatched payloads become `MARKET_DATA_INVALID_RESPONSE`.
Unknown Binance pairs become `MARKET_DATA_NOT_FOUND`. The public API exposes
this normalized crypto quote through `GET /market/quote/:symbol` as documented
in `docs/API.md`.

Binance declares `markets: ["GLOBAL"]` because crypto pairs are not tied to a
listing country.

## Configuration

Configuration is environment-based. `backend/.env.example` contains only
placeholder values.

| Variable                          | Default                            | Purpose                                          |
| --------------------------------- | ---------------------------------- | ------------------------------------------------ |
| `MARKET_DATA_STOCK_PROVIDERS`     | `finnhub,yahoo`                    | Ordered stock provider chain, primary first      |
| `MARKET_DATA_CRYPTO_PROVIDERS`    | `binance`                          | Ordered crypto provider chain, primary first     |
| `MARKET_DATA_STOCK_PROVIDER`      | `finnhub`                          | Legacy primary stock id; fallbacks remain after  |
| `MARKET_DATA_CRYPTO_PROVIDER`     | `binance`                          | Legacy primary crypto id                         |
| `MARKET_DATA_REQUEST_TIMEOUT_MS`  | `5000`                             | HTTP timeout, integer from 100 to 30000 ms       |
| `FINNHUB_API_KEY`                 | unset                              | Finnhub credential; required for Finnhub calls   |
| `FINNHUB_API_URL`                 | `https://finnhub.io/api/v1`        | Finnhub API base URL                             |
| `BINANCE_API_URL`                 | `https://api.binance.com`          | Binance API base URL                             |
| `YAHOO_FINANCE_API_URL`           | `https://query1.finance.yahoo.com` | Yahoo chart API base URL                         |

The `*_PROVIDERS` chain always wins over the legacy single-provider variable.
Chain entries are trimmed, lowercased, de-duplicated, and must contain at least
one id. The first chain entry is the primary provider. The legacy variable
selects the primary and keeps the documented fallbacks after it, so an
existing `.env` with `MARKET_DATA_STOCK_PROVIDER=finnhub` still gets the Yahoo
history fallback.

Missing Finnhub credentials fail lazily with `MARKET_DATA_NOT_CONFIGURED`;
they do not prevent unrelated backend modules from loading. Invalid timeout or
empty-chain configuration fails during configuration loading with a clear
message. Binance and Yahoo public market-data methods do not require
credentials.

## Domain errors

Expected provider failures use the existing `{ success: false, error }` API
envelope through the standard error middleware.

| Code                                  | HTTP status | Behavior                                               |
| ------------------------------------- | ----------: | ------------------------------------------------------ |
| `MARKET_DATA_INVALID_REQUEST`         |         400 | Invalid input or provider-rejected request syntax      |
| `MARKET_DATA_NOT_FOUND`               |         404 | Invalid/unsupported symbol or unavailable market data  |
| `MARKET_DATA_UNSUPPORTED_ASSET_CLASS` |         422 | Asset class is outside stock/crypto scope              |
| `MARKET_DATA_NOT_CONFIGURED`          |         503 | Required provider selection or credentials are missing |
| `MARKET_DATA_INVALID_CREDENTIALS`     |         503 | Provider rejects configured credentials                |
| `MARKET_DATA_RATE_LIMITED`            |         429 | Provider returns HTTP 429 or 418                       |
| `MARKET_DATA_TIMEOUT`                 |         504 | Request times out or provider returns HTTP 408/504     |
| `MARKET_DATA_INVALID_RESPONSE`        |         502 | Provider payload does not match its adapter contract   |
| `MARKET_DATA_PROVIDER_UNAVAILABLE`    |         503 | Network, provider 5xx, or unexpected provider failure  |

`marketDataErrors.js` maps HTTP statuses, provider symbol errors, and common
timeout/network failures to these codes. Known market-data `AppError` values
are rebuilt from a fixed code/message allowlist; unknown adapter errors become
`MARKET_DATA_PROVIDER_UNAVAILABLE`. Raw provider messages, response bodies,
error details, credentials, and upstream stacks are not copied to the API
response or the error-handler log. The standard error middleware returns the
usual `{ success: false, error: { code, message } }` envelope.

Requests use the configured bounded timeout (`100` to `30000` ms, default
`5000` ms). The service does not retry the same provider: retries could amplify
throttling and return stale data, and no provider-specific retry contract is
defined. Fallback is a different provider, not a retry.

## Contract questions and assumptions

`docs/API.md` defines the crypto quote and asset-class-specific market overview
responses. Search still lacks a public query/response contract. History has a
documented API contract added with its route; its interval/range constraints
are shared with the internal service.

Region metadata is inferred from common exchange suffixes. A future
country-specific provider only needs `markets` metadata; per-region provider
chains are a possible extension if one asset class needs different primary
providers per country.

## Tests

Run the mocked, offline market-data unit tests from `backend/`:

```sh
npm test -- --runInBand tests/unit/services/marketDataService.test.js tests/unit/services/marketDataFallback.test.js tests/unit/services/marketDataProviders.test.js tests/unit/services/marketDataHttp.test.js tests/unit/config/marketDataConfig.test.js tests/unit/providers
```

The tests cover success for all four operations, configuration defaults and
overrides, ordered chains, primary/fallback routing, terminal client errors,
provider/operation/market filtering, per-adapter symbol translation, missing
credentials/provider selection, provider swapping, Finnhub invalid symbols and
authentication failures, Yahoo history mapping/aggregation/error mapping,
timeouts, rate limits, malformed payloads, Binance symbol validation, and
network failures. They do not need credentials, a database, or external API
access.
