# Market Data Service Layer

This document describes the provider-independent backend service contract. It
does not add or finalize public HTTP response schemas. The public API spec lists
market search, quote, and history routes, but does not define their response
fields or a market-overview route.

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
files. Tests can inject fake adapters directly into `createMarketDataService`
and do not make external requests.

## Methods and normalized results

### `getQuote(symbol, { assetClass? })`

- `symbol`: nonempty string, up to 30 characters. It is trimmed and uppercased.
- `assetClass`: `STOCK` or `CRYPTO`. If omitted, `BINANCE:` symbols are
  crypto and other symbols are treated as stocks.
- Returns `{ symbol, assetClass, price, change, changePercent, high, low,
open, previousClose, volume, currency, timestamp, source }`.
- Monetary and volume values are decimal strings. Optional values may be
  `null`; `timestamp` is an ISO 8601 string or `null` if the provider omits it.

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
| `MARKET_DATA_INVALID_REQUEST`         |         400 | Invalid symbol, range, interval, or limit              |
| `MARKET_DATA_NOT_FOUND`               |         404 | Symbol or requested data is unavailable                |
| `MARKET_DATA_UNSUPPORTED_ASSET_CLASS` |         422 | Asset class is outside stock/crypto scope              |
| `MARKET_DATA_NOT_CONFIGURED`          |         503 | Required provider selection or credentials are missing |
| `MARKET_DATA_INVALID_CREDENTIALS`     |         503 | Provider rejects configured credentials                |
| `MARKET_DATA_RATE_LIMITED`            |         429 | Provider returns HTTP 429 or 418                       |
| `MARKET_DATA_TIMEOUT`                 |         504 | Provider request times out                             |
| `MARKET_DATA_INVALID_RESPONSE`        |         502 | Provider payload does not match its adapter contract   |
| `MARKET_DATA_PROVIDER_UNAVAILABLE`    |         503 | Network or provider service failure                    |

Provider response bodies, credential values, and raw network errors are not
included in public messages.

## Contract questions and assumptions

`docs/API.md` identifies `/market/search`, `/market/quote/:symbol`, and
`/market/history/:symbol`, but does not give query parameters or response
schemas. It does not define market overview at all. The internal service
therefore uses decimal strings, ISO timestamps, common quote/candle/search
fields, and an asset-class-specific overview as a provisional adapter
contract. Before a public controller/route is added, the maintainer should
confirm response field names, stock/crypto overview semantics, and historical
interval/range conventions.

## Tests

Run the mocked, offline market-data unit tests from `backend/`:

```sh
npm test -- --runInBand tests/unit/services/marketDataService.test.js tests/unit/services/marketDataProviders.test.js tests/unit/config/marketDataConfig.test.js
```

The tests cover success for all four operations, configuration defaults and
overrides, missing credentials/provider selection, provider swapping,
timeouts, rate limits, malformed payloads, and network failures. They do not
need credentials, a database, or external API access.
