# Market Data Service Layer

This document describes the provider-independent backend service contract.
`docs/API.md` defines the public crypto quote route and its response envelope;
the route currently accepts crypto pairs only. Search, history, and market
overview response schemas remain internal/provisional.

## Service construction

`backend/src/services/marketDataService.js` exports
`createMarketDataService({ config, providers })`. The returned service exposes
`getQuote`, `getHistoricalPrices`, `getMarketOverview`, and `searchSymbols`.
The service validates inputs, selects an adapter from `providerByAssetClass`,
checks normalized results, and converts provider/network failures into Stox
`AppError` values.

`backend/src/services/marketData.js` creates the default runtime service. The
composition code is in `backend/src/providers/createMarketDataProviders.js`;
provider-specific HTTP requests and response parsing live in the adapter
files. Quote wire formats are mapped by
`backend/src/providers/marketQuoteMappers.js` into the shared
`backend/src/dtos/marketQuoteDto.js` contract. The service validates and
normalizes quotes through the same DTO before returning them. Tests can inject
fake adapters directly into `createMarketDataService` and do not make external
requests.

## Methods and normalized results

### `getQuote(symbol, { assetClass? })`

- `symbol`: nonempty string, up to 30 characters. It is trimmed and uppercased.
- `assetClass`: `STOCK` or `CRYPTO`. If omitted, `BINANCE:` symbols and
  symbols ending in `USDT`, `BTC`, or `ETH` are treated as crypto, matching the
  repository's symbol normalization guidance; other symbols are treated as
  stocks.
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
from 1 to 1000. `assetClass` follows the quote rules.

Returns `{ symbol, assetClass, interval, prices }`. Each price is
`{ timestamp, open, high, low, close, volume }`; timestamps are ISO 8601 and
decimal values are strings. No data for a valid range returns an empty array.

### `getMarketOverview({ assetClass, limit? })`

`assetClass` is required (`STOCK` or `CRYPTO`). `limit` defaults to 10 and is
from 1 to 100. Returns `{ assetClass, asOf, marketStatus, movers, source }`.
`marketStatus` is provider-normalized and `movers` is an array; the initial
Finnhub adapter reports US session status with an empty movers list, while the
Binance adapter returns up to `limit` highest-percentage crypto movers. This
asset-class-specific overview is a provisional internal contract, not a public
API commitment.

### `searchSymbols(query, { assetClass?, limit? })`

`query` is a nonempty string. If `assetClass` is omitted, results from both
configured asset classes are combined. `limit`, when present, is from 1 to 100. Each result is `{ symbol, name, assetClass, exchange, currency, type,
source }`; optional provider metadata is `null` where unavailable.

## Provider adapter contract

Provider adapters are registry entries keyed by a provider id. Each implements:

```js
{
  id: "provider-id",
  assetClasses: ["STOCK"],
  getQuote(symbol),
  getHistoricalPrices(symbol, { interval, from, to, limit }),
  getMarketOverview({ assetClass, limit }),
  searchSymbols(query),
}
```

Adapters return the normalized service result shapes above and throw
`AppError` or an HTTP-client error. The service remaps unknown adapter errors
to safe domain errors. To add a provider, implement this interface, register
it in `createMarketDataProviders`, and select its id through environment
configuration. Controllers call the configured service; they do not import
HTTP clients or provider adapters.

The repository's market-data documentation names Finnhub for stocks and
Binance for crypto. Those are the default adapter selections. The service
itself does not import either provider implementation.

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
quote result or public error messages. Finnhub remains service-layer-only; the
public quote route currently accepts crypto pairs only.

### Binance quote behavior

The Binance adapter requests the public `/api/v3/ticker/24hr` endpoint using
the configured `BINANCE_API_URL` and shared request timeout. It accepts the
Stox crypto pair conventions `BTCUSDT`, `ETHBTC`, and `BINANCE:BTCUSDT`; a
slash form such as `BTC/USDT` is also normalized to `BTCUSDT`. Pair suffixes
currently supported by the adapter are `USDT`, `BTC`, and `ETH`. This is
syntax validation only; Binance determines whether a pair exists and is
trading. Stock-shaped values such as `AAPL` are rejected before an adapter
request is sent.

The returned internal quote maps Binance `lastPrice`, `priceChange`,
`priceChangePercent`, `highPrice`, `lowPrice`, `openPrice`, `prevClosePrice`,
`volume`, and `closeTime` to the normalized Stox quote fields. Numeric values
remain decimal strings. The adapter requires all those values, a positive
price, and a response symbol matching the requested pair; incomplete,
malformed, or mismatched payloads become `MARKET_DATA_INVALID_RESPONSE`.
Unknown Binance pairs become `MARKET_DATA_NOT_FOUND`. The public API exposes
this normalized crypto quote through `GET /market/quote/:symbol` as documented
in `docs/API.md`.

## Configuration

Configuration is environment-based. `backend/.env.example` contains only
placeholder values.

| Variable                         | Default                     | Purpose                                        |
| -------------------------------- | --------------------------- | ---------------------------------------------- |
| `MARKET_DATA_STOCK_PROVIDER`     | `finnhub`                   | Registered stock adapter id                    |
| `MARKET_DATA_CRYPTO_PROVIDER`    | `binance`                   | Registered crypto adapter id                   |
| `MARKET_DATA_REQUEST_TIMEOUT_MS` | `5000`                      | HTTP timeout, integer from 100 to 30000 ms     |
| `FINNHUB_API_KEY`                | unset                       | Finnhub credential; required for Finnhub calls |
| `FINNHUB_API_URL`                | `https://finnhub.io/api/v1` | Finnhub API base URL                           |
| `BINANCE_API_URL`                | `https://api.binance.com`   | Binance API base URL                           |

Missing Finnhub credentials fail lazily with `MARKET_DATA_NOT_CONFIGURED`;
they do not prevent unrelated backend modules from loading. Invalid timeout
configuration fails during configuration loading with a clear message.
Binance public market-data methods do not require credentials.

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
`5000` ms). The service does not automatically retry provider calls: retries
could amplify throttling and return stale data, and no provider-specific retry
contract is defined.

## Contract questions and assumptions

`docs/API.md` now defines the crypto quote response. It still does not define
search/history query parameters or response schemas, or a market overview
route. The internal service uses decimal strings, ISO timestamps, common
quote/candle/search fields, and an asset-class-specific overview; only the
crypto quote shape is currently public. Before exposing other market-data
operations, the maintainer should confirm their response fields, stock/crypto
overview semantics, and historical interval/range conventions.

## Tests

Run the mocked, offline market-data unit tests from `backend/`:

```sh
npm test -- --runInBand tests/unit/services/marketDataService.test.js tests/unit/services/marketDataProviders.test.js tests/unit/services/marketDataHttp.test.js tests/unit/config/marketDataConfig.test.js
```

The tests cover success for all four operations, configuration defaults and
overrides, missing credentials/provider selection, provider swapping,
Finnhub invalid symbols and authentication failures, timeouts, rate limits,
malformed payloads, Binance symbol validation, and network failures. They do
not need credentials, a database, or external API access.
