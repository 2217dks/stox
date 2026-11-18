# 🔌 API Specification

> REST API specification for Stox.

---

# 🌐 Base URL

```text
/api/v1
```

# 📐 API Conventions

| Property         | Convention           |
| ---------------- | -------------------- |
| Versioning       | `/api/v1`            |
| Resource names   | Plural nouns         |
| Authentication   | Bearer JWT           |
| Pagination       | `page` + `limit`     |
| Filtering        | Query parameters     |
| Sorting          | `sort` + `order`     |
| Success envelope | `{ success, data }`  |
| Error envelope   | `{ success, error }` |

---

# 🔐 Authentication

## `POST /auth/register`

Create an account.

### Request

```json
{
    "name": "John Trader",
    "email": "john@example.com",
    "password": "SecurePass123!"
}
```

### Response

```json
{
    "success": true,
    "data": {
        "user": {},
        "accessToken": "...",
        "refreshToken": "...",
        "expiresAt": "..."
    }
}
```

## `POST /auth/login`

Authenticate an existing user.

### Request

```json
{
    "email": "john@example.com",
    "password": "SecurePass123!"
}
```

## `POST /auth/google`

Authenticate using Google credentials.

### Request

```json
{
    "credential": "..."
}
```

## `POST /auth/refresh`

Refresh an access token.

### Request

```json
{
    "refreshToken": "..."
}
```

## `POST /auth/logout`

Log out using a refresh token.

### Request

```json
{
    "refreshToken": "..."
}
```

## `GET /auth/me`

Returns the authenticated user.

## `PATCH /auth/profile`

Updates profile information.

### Request

```json
{
    "name": "New Name",
    "avatarUrl": "https://..."
}
```

---

# 👤 Users

## `GET /users/me/statistics`

Get aggregate trading statistics for the authenticated user, optionally filtered by portfolio, symbol, execution side, date range, or including monthly breakdown.

Requires Bearer JWT authentication. Automatically self-scoped to the authenticated user's portfolios.

### Query Parameters

| Parameter        | Type    | Default | Description |
|------------------|---------|---------|-------------|
| `portfolioId`    | UUID    | -       | Scopes statistics to a specific portfolio owned by the caller. Returns 404 if not found or not owned. |
| `symbol`         | string  | -       | Filter by instrument symbol (e.g. `AAPL`). |
| `side`           | enum    | -       | Filter by trade side: `BUY` or `SELL`. |
| `from`           | string  | -       | Lower bound on `executedAt` (`YYYY-MM-DD` or ISO timestamp). |
| `to`             | string  | -       | Upper bound on `executedAt` (`YYYY-MM-DD` or ISO timestamp, strictly later than `from`). |
| `includeMonthly` | boolean | `false` | If `true`, includes monthly trade statistics array under `data.statistics.monthly`. |

### Response

```json
{
  "success": true,
  "data": {
    "statistics": {
      "totalTrades": 5,
      "winningTrades": 2,
      "losingTrades": 1,
      "winRate": 0.6667,
      "totalVolume": "5400.00000000",
      "averageReturn": "5.5000",
      "bestTrade": {
        "symbol": "MSFT",
        "realizedPnl": "500.00000000",
        "realizedPnlPct": "20.0000"
      },
      "worstTrade": {
        "symbol": "TSLA",
        "realizedPnl": "-300.00000000",
        "realizedPnlPct": "-8.0000"
      }
    }
  }
}
```

## `GET /users/me/statistics/monthly`

Get trade execution performance aggregated into UTC calendar-month buckets for the authenticated user.

Supports the same query filters (`portfolioId`, `symbol`, `side`, `from`, `to`).

### Response

```json
{
  "success": true,
  "data": {
    "monthly": [
      {
        "month": "2026-01",
        "totalTrades": 10,
        "winningTrades": 6,
        "losingTrades": 3,
        "winRate": 0.6667,
        "totalVolume": "15000.00000000",
        "realizedPnl": "1200.00000000",
        "averageReturn": "4.5000"
      }
    ]
  }
}
```

## `GET /users/:id`

Get a public profile containing the user's ID, name, avatar URL, follower, following, and visible-post counts.

Authenticated viewers also receive `isFollowing`; anonymous viewers receive `null`. Private account fields are never included.

## `GET /users/:id/portfolio`

Get publicly visible portfolio information.

## `GET /users/:id/trades`

Get publicly visible trading history.

---

# 💼 Portfolios

## `GET /portfolios`

List the authenticated user's portfolios.

Each portfolio includes its starting balance, cash balance, reserved cash, and available cash.

### Balance fields

| Field             | Type           | Description                                    |
| ----------------- | -------------- | ---------------------------------------------- |
| `startingBalance` | Decimal string | Portfolio's initial balance                    |
| `cashBalance`     | Decimal string | Current cash balance                           |
| `reservedCash`    | Decimal string | Cash currently reserved for pending BUY orders |
| `availableCash`   | Decimal string | Cash available for placing new BUY orders      |

`availableCash` is calculated as:

```text
availableCash = cashBalance - reservedCash
```

All monetary values are serialized as decimal strings to preserve precision.

### Example portfolio balance

```json
{
    "startingBalance": "10000",
    "cashBalance": "5000",
    "reservedCash": "1200",
    "availableCash": "3800"
}
```

## `POST /portfolios`

Create a portfolio.

The response includes the portfolio's balance fields. Newly created portfolios have `reservedCash` set to `"0"` and `availableCash` equal to `cashBalance`.

## `GET /portfolios/:id`

Get portfolio details, including its balance fields.

## `PATCH /portfolios/:id`

Update a portfolio.

## `DELETE /portfolios/:id`

Deactivate or delete a portfolio.

## `GET /portfolios/:id/holdings`

Get current holdings.

## `GET /portfolios/:id/performance`

Get performance history and statistics.

## `GET /portfolios/:id/pnl-heatmap`

Get daily P&L heatmap data and win/loss performance summary.

### Query Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `period`  | enum | `1M`    | Observation window: `1W`, `1M`, `3M`, `6M`, `1Y`, `YTD`, `ALL` |
| `year`    | int  | -       | Optional calendar year filter (e.g. `2026`) |

### Response

```json
{
  "success": true,
  "data": {
    "portfolioId": "uuid",
    "period": "1Y",
    "heatmap": [
      {
        "date": "2026-11-01",
        "pnl": "120.00000000",
        "pnlPercent": "0.0120",
        "totalValue": "10120.00000000"
      }
    ],
    "summary": {
      "totalPnl": "120.00000000",
      "winDays": 1,
      "lossDays": 0,
      "flatDays": 0
    }
  }
}
```

## `GET /portfolios/:id/benchmark`

Get historical daily price and return series for a market benchmark.

### Query Parameters

| Parameter | Type   | Default | Description |
|-----------|--------|---------|-------------|
| `symbol`  | string | `SPY`   | Validated market ticker symbol (e.g. `SPY`, `QQQ`) |
| `period`  | enum   | `1M`    | Observation window: `1W`, `1M`, `3M`, `6M`, `1Y`, `YTD`, `ALL` |

### Response

```json
{
  "success": true,
  "data": {
    "benchmark": "SPY",
    "period": "1M",
    "prices": [
      {
        "date": "2026-11-01",
        "price": "570.25",
        "dailyReturn": null
      },
      {
        "date": "2026-11-02",
        "price": "573.10",
        "dailyReturn": "0.0050"
      }
    ]
  }
}
```

> **Note on Returns:** The first observation in the historical series has no prior close to calculate a return from, so its `dailyReturn` is explicitly `null` (not `0.0000`). Subsequent observations compute daily simple return relative to the previous trading day's close.

## `GET /portfolios/:id/risk-metrics`

Get computed quantitative risk metrics including annualized volatility, drawdown, and Sharpe ratio.

### Query Parameters

| Parameter      | Type   | Default | Description |
|----------------|--------|---------|-------------|
| `period`       | enum   | `1M`    | Observation window: `1W`, `1M`, `3M`, `6M`, `1Y`, `YTD`, `ALL` |
| `riskFreeRate` | number | `0.02`  | Annualized risk-free rate decimal fraction ($0 \le R_f \le 1.0$) |

### Response

```json
{
  "success": true,
  "data": {
    "portfolioId": "uuid",
    "period": "1M",
    "metrics": {
      "annualizedVolatility": "0.1852",
      "maxDrawdown": "-0.0825",
      "currentDrawdown": "-0.0120",
      "peakValue": "10500.00000000",
      "peakDate": "2026-11-05",
      "sharpeRatio": "1.42",
      "observationCount": 22
    }
  }
}
```

## `GET /portfolios/:id/benchmark-comparison`

Compare portfolio performance directly against a benchmark symbol over mutually available dates.

### Query Parameters

| Parameter      | Type   | Default | Description |
|----------------|--------|---------|-------------|
| `symbol`       | string | `SPY`   | Validated benchmark symbol |
| `period`       | enum   | `1M`    | Observation window: `1W`, `1M`, `3M`, `6M`, `1Y`, `YTD`, `ALL` |
| `riskFreeRate` | number | `0.02`  | Annualized risk-free rate decimal fraction |

### Response

```json
{
  "success": true,
  "data": {
    "portfolioId": "uuid",
    "benchmark": "SPY",
    "period": "1M",
    "summary": {
      "portfolioReturn": "0.0450",
      "benchmarkReturn": "0.0210",
      "alpha": "0.0240",
      "beta": "1.15",
      "correlation": "0.85"
    },
    "comparison": [
      {
        "date": "2026-11-01",
        "portfolioValue": "10000.00000000",
        "portfolioReturn": null,
        "benchmarkPrice": "570.25",
        "benchmarkReturn": null
      },
      {
        "date": "2026-11-02",
        "portfolioValue": "10450.00000000",
        "portfolioReturn": "0.0450",
        "benchmarkPrice": "582.23",
        "benchmarkReturn": "0.0210"
      }
    ]
  }
}
```

> **Note on Comparison Alignment & Returns:** 
> - Initial observations without a preceding close/value or dates with missing returns have `portfolioReturn` / `benchmarkReturn` set to `null` rather than substituted zero.
> - Statistical metrics (`alpha`, `beta`, `correlation`) are calculated strictly across mutual dates where **both** portfolio and benchmark returns are defined ($M \ge 2$). Dates where either return is `null` are excluded from covariance and variance calculations to avoid distorting risk metrics.

## `GET /portfolios/:id/analytics/monthly-performance`

Get portfolio valuation performance and P&L aggregated into UTC calendar-month buckets. (Also accessible via `GET /portfolios/:id/monthly-performance`).

Requires Bearer JWT authentication and verifies portfolio ownership.

### Query Parameters

| Parameter | Type   | Default | Description |
|-----------|--------|---------|-------------|
| `year`    | int    | -       | Optional calendar year filter (e.g. `2026`). |
| `from`    | string | -       | Optional lower bound (`YYYY-MM`, `YYYY-MM-DD`, or ISO datetime with UTC offset). `YYYY-MM` starts at the first instant of that UTC month. |
| `to`      | string | -       | Optional upper bound (`YYYY-MM`, `YYYY-MM-DD`, or ISO datetime with UTC offset). `YYYY-MM` includes the whole UTC month. |

### Response

```json
{
  "success": true,
  "data": {
    "portfolioId": "uuid",
    "months": [
      {
        "month": "2026-01",
        "startValue": "10000.00000000",
        "endValue": "10500.00000000",
        "netPnl": "500.00000000",
        "returnPct": "5.0000",
        "realizedPnl": "200.00000000",
        "unrealizedPnl": "300.00000000",
        "snapshotCount": 20
      },
      {
        "month": "2026-02",
        "startValue": "10500.00000000",
        "endValue": "11000.00000000",
        "netPnl": "500.00000000",
        "returnPct": "4.7619",
        "realizedPnl": "300.00000000",
        "unrealizedPnl": "200.00000000",
        "snapshotCount": 19
      }
    ]
  }
}
```

> **Calculation Semantics:**
> - `startValue`: Starting valuation for the month, taken from the immediately preceding calendar month's final snapshot if available without gap, or the first snapshot of this month.
> - `endValue`: Ending valuation for the month from the latest recorded snapshot.
> - `netPnl`: $V_{\text{end}} - V_{\text{start}}$.
> - `returnPct`: $\frac{V_{\text{end}} - V_{\text{start}}}{V_{\text{start}}} \times 100$.
> - `realizedPnl`: Sum of realized P&L from trades executed in that portfolio during the month.
> - `unrealizedPnl`: Net shift in unrealized holding valuation ($netPnl - realizedPnl$).
> - Months with trades but no snapshots report `snapshotCount: 0`, preserve `realizedPnl`, and set valuation fields to `null`.
> - Months following a snapshot gap do not carry forward stale multi-month baselines, starting instead from the first snapshot of that month.
> - Months without recorded snapshots or trades are omitted (never fabricated with fake zero returns).

---

# 📋 Orders

## `GET /orders`

List the authenticated user's orders.

Supported filters:

```text
status
symbol
side
type
portfolioId
date range
```

## `POST /orders`

Place an order.

### Request

```json
{
    "portfolioId": "uuid",
    "symbol": "AAPL",
    "assetType": "STOCK",
    "side": "BUY",
    "type": "LIMIT",
    "quantity": "10",
    "limitPrice": "250",
    "expiresAt": "2026-12-01T00:00:00.000Z"
}
```

`expiresAt` is optional and must be an ISO-8601 instant with an explicit UTC
offset (`Z` or `±HH:MM`) in the future. The worker moves a pending order to
`EXPIRED` once `expiresAt <= now`, releases its cash reservation, and records an
`EXPIRED` order event. A value without an offset, an unparseable value, or a
past instant is `400 VALIDATION_ERROR`. Orders without `expiresAt` never
expire. The response includes `expiresAt` as an ISO string or `null`.

#### Competition / League Portfolio Constraints
- **Active Competition Window Only**: If `portfolioId` belongs to a competition league (`isLeague: true`), orders can only be placed while the league is active ($startDate \le now \le endDate$).
  - Pre-start attempts return `400 LEAGUE_NOT_ACTIVE`.
  - Post-end attempts return `400 LEAGUE_ENDED`.
- **Short Selling Prohibited**: Naked short selling is disallowed on competition portfolios. Sell orders that exceed current held long shares return `400 SHORT_SELLING_DISALLOWED`.

## `GET /orders/:id`

Get order details.

## `GET /orders/:id/events`

Get chronological order lifecycle audit events for an order.

This endpoint is ownership-scoped: only the owner of the portfolio to which the order belongs can retrieve its event history. Foreign orders return HTTP 404 `ORDER_NOT_FOUND` to prevent identity probing.

### Response

```json
{
    "success": true,
    "data": {
        "events": [
            {
                "id": "uuid",
                "orderId": "uuid",
                "sequence": 1,
                "eventType": "CREATED",
                "previousStatus": null,
                "newStatus": "PENDING",
                "metadata": {
                    "symbol": "AAPL",
                    "assetType": "STOCK",
                    "side": "BUY",
                    "type": "MARKET",
                    "quantity": "10",
                    "reservedCash": "2265.00000000",
                    "limitPrice": null,
                    "stopPrice": null,
                    "source": "MANUAL"
                },
                "createdAt": "2026-11-14T12:00:00.000Z"
            },
            {
                "id": "uuid",
                "orderId": "uuid",
                "sequence": 2,
                "eventType": "EXECUTED",
                "previousStatus": "PENDING",
                "newStatus": "EXECUTED",
                "metadata": {
                    "tradeId": "uuid",
                    "executionPrice": "226.50000000",
                    "quantity": "10",
                    "totalValue": "2265.00000000",
                    "realizedPnl": null,
                    "realizedPnlPct": null,
                    "fees": "0"
                },
                "createdAt": "2026-11-14T12:00:05.000Z"
            }
        ]
    }
}
```

### Errors

- `401 UNAUTHORIZED`: Authentication required or invalid/expired token.
- `400 VALIDATION_ERROR`: Invalid order ID format (must be a valid UUID).
- `404 ORDER_NOT_FOUND`: Order does not exist or does not belong to the authenticated user.

## `PATCH /orders/:id`

Modify an eligible pending order.

## `DELETE /orders/:id`

Cancel an eligible pending order.

---

# 💱 Trades

## `GET /trades`

List the authenticated user's executed trades.

## `GET /trades/:id`

Get trade details.

---

# 📊 Market Data

### Symbol Conventions & Mapping Layer

Stox decouples internal canonical instruments from provider-specific formats:
- **Canonical Symbols**: Internal, provider-agnostic domain representations (e.g. `BTCUSDT`, `AAPL`). Decoupled from transport prefixes (`BINANCE:`, `FINNHUB:`) and formatting slashes (`/`).
- **Provider Representations**:
  - **Crypto (Binance)**: API endpoints accept `BTCUSDT`, `BINANCE:BTCUSDT`, and `BTC/USDT` interchangeably. Transport prefixes are stripped and slash pairs are canonicalized automatically.
  - **Stocks (Finnhub)**: Standard equity tickers (e.g. `AAPL`, `MSFT`, `BRK.B`).
- **Ambiguous Tickers**: Symbols like `GBTC`, `METH`, `SOL`, `COIN`, `RIOT`, and `BITO` default to `STOCK`. Specify `assetClass=CRYPTO` (or pass explicit asset class in orders) to override.
- **Database Resolution**: PostgreSQL `Symbol` model records are authoritative for instrument metadata (`assetType`, `exchange`, `currency`, `isActive`). Discrepancies between requested asset classes and registered symbols reject with `400 ASSET_TYPE_MISMATCH`.

## `GET /market/search`

Search supported stocks and crypto pairs through the configured market-data providers.

This public, read-only endpoint uses the global API rate limit.

### Query parameters

| Name         | Required | Contract                                                        |
| ------------ | -------- | --------------------------------------------------------------- |
| `query`      | Yes      | Trimmed text from 2 to 50 characters                            |
| `assetClass` | No       | `STOCK` or `CRYPTO`; omitted searches both configured providers |
| `limit`      | No       | Integer from 1 to 50; defaults to 20                            |

Results are returned in the standard envelope as an array in `data`.

Each item contains only `symbol`, `name`, `assetClass`, `exchange`, `currency`, `type`, and `source`.

Symbol and exchange are uppercase; currency is uppercase when known. Optional metadata is `null` when unavailable. A query with no matches returns HTTP 200 with `data: []`.

When both asset classes are requested, the service combines both provider results. If either provider fails, the entire request returns the standard market-data error envelope rather than a partial result.

Pass `assetClass` to search only one provider. Provider timeouts, throttling, and unavailability use the standard market-data domain error codes.

### Caching

Search results are cached in Redis under `stox:v1:market:search:{assetClass}:{query}:{limit}` with a 1-hour bounded TTL (`CACHE_TTL_SYMBOL_SEARCH_SECONDS`, configurable). Queries are case-insensitively normalized with trimmed whitespace so equivalent lookups hit the same cache entry. Empty match arrays (`[]`) are cached to prevent repetitive upstream provider queries on unknown symbols. If Redis is unavailable, the endpoint transparently falls back to direct provider lookups without client-facing failure.

### Example

```text
GET /api/v1/market/search?query=apple&assetClass=STOCK&limit=20
```

### Response

```json
{
    "success": true,
    "data": [
        {
            "symbol": "AAPL",
            "name": "Apple Inc.",
            "assetClass": "STOCK",
            "exchange": "NASDAQ",
            "currency": "USD",
            "type": "Common Stock",
            "source": "finnhub"
        }
    ]
}
```

## `GET /market/quote/:symbol`

Get a normalized Binance crypto quote.

This public, read-only endpoint does not require authentication and uses the global API rate limit.

Supported symbol forms include `BTCUSDT`, `BINANCE:BTCUSDT`, and `BTC/USDT`. Quote assets follow the market-data service conventions (`USDT`, `BTC`, or `ETH`).

The response uses the standard envelope, with the normalized quote DTO in `data`.

### Response

```json
{
    "success": true,
    "data": {
        "symbol": "BINANCE:BTCUSDT",
        "assetClass": "CRYPTO",
        "price": "67123.45",
        "change": "123.45",
        "changePercent": "0.18",
        "high": "68000",
        "low": "66000",
        "open": "67000",
        "previousClose": "67000",
        "volume": "1234.56",
        "currency": "USDT",
        "timestamp": "2026-11-02T12:00:00.000Z",
        "source": "binance"
    }
}
```

Prices and volume are canonical decimal strings.

Unsupported or invalid symbol formats return HTTP 400 `VALIDATION_ERROR`; unknown Binance pairs return HTTP 404 `MARKET_DATA_NOT_FOUND`.

Provider timeouts, rate limits, and unavailable provider errors use the documented market-data domain error codes.

## `GET /market/quote/stock/:symbol`

Get a normalized Finnhub stock quote.

This public, read-only endpoint does not require authentication and uses the global API rate limit.

Tickers are case-insensitive and may contain letters, digits, `.` or `-`, with a maximum length of 20 characters (for example, `AAPL` or `BRK.B`).

The response uses the same normalized quote DTO and standard envelope as the crypto quote route.

Finnhub does not return quote volume, so `volume` is `null`; optional quote fields are also `null` when absent.

### Response

```json
{
    "success": true,
    "data": {
        "symbol": "AAPL",
        "assetClass": "STOCK",
        "price": "226.5",
        "change": "1.25",
        "changePercent": "0.55",
        "high": "228.1",
        "low": "224.8",
        "open": "225.3",
        "previousClose": "225.25",
        "volume": null,
        "currency": "USD",
        "timestamp": "2026-11-02T12:00:00.000Z",
        "source": "finnhub"
    }
}
```

Malformed ticker formats return HTTP 400 `VALIDATION_ERROR`; unsupported symbols return HTTP 404 `MARKET_DATA_NOT_FOUND`.

Missing Finnhub configuration, provider timeouts, rate limits, and unavailable providers use the standard market-data domain errors.

API credentials and raw provider payloads are never included in response data or error messages.

## `GET /market/overview`

Get a current overview for one asset class.

This public, read-only endpoint uses the global API rate limit and does not cache responses.

`assetClass` is required and must be `STOCK` or `CRYPTO`; `limit` is optional, defaults to 10, and must be an integer from 1 to 100.

The response uses the standard envelope. `data` contains `assetClass`, `asOf`, `marketStatus`, `movers`, and `source`.

`asOf` is an ISO 8601 UTC timestamp for the provider's market-status data when supplied; otherwise it is the retrieval time.

`marketStatus` contains `isOpen` and provider-normalized session metadata.

Crypto movers contain `symbol`, `price`, `changePercent`, and `quoteVolume`; decimal values are strings and `quoteVolume` may be `null` if the provider omits it.

The stock provider currently supplies US market status but no mover feed, so `movers` is `null` to signal that the field is unavailable.

For a provider that supports movers, an empty array means the feed was available but returned no movers.

If the selected provider is unavailable or returns malformed data, the whole request returns the standard market-data error envelope; missing values are not fabricated.

Responses are provider-fresh and are not cached.

Invalid or missing query parameters return HTTP 400 `VALIDATION_ERROR`.

Provider timeouts, rate limits, and unavailable providers use `MARKET_DATA_TIMEOUT`, `MARKET_DATA_RATE_LIMITED`, and `MARKET_DATA_PROVIDER_UNAVAILABLE` respectively.

### Example

```text
GET /api/v1/market/overview?assetClass=CRYPTO&limit=10
```

### Response

```json
{
    "success": true,
    "data": {
        "assetClass": "CRYPTO",
        "asOf": "2026-11-02T12:00:00.000Z",
        "marketStatus": {
            "isOpen": true,
            "session": "24/7",
            "exchange": "BINANCE",
            "timezone": "UTC"
        },
        "movers": [
            {
                "symbol": "BINANCE:BTCUSDT",
                "price": "67123.45",
                "changePercent": "2.5",
                "quoteVolume": "1234567.89"
            }
        ],
        "source": "binance"
    }
}
```

## `GET /market/history/:symbol`

Get normalized historical OHLCV data.

This read-only endpoint is public and uses the configured provider for the requested asset class.

### Query parameters

| Name         | Required | Contract                                                                                                |
| ------------ | -------- | ------------------------------------------------------------------------------------------------------- |
| `interval`   | Yes      | `1m`, `5m`, `15m`, `30m`, `1h`, `4h`, `1d`, `1w`, or `1M`                                               |
| `from`       | Yes      | Inclusive Unix epoch timestamp in milliseconds                                                          |
| `to`         | Yes      | Inclusive Unix epoch timestamp in milliseconds; must be after `from` and no later than the current time |
| `limit`      | No       | Integer from 1 to 1000; defaults to 500                                                                 |
| `assetClass` | No       | `STOCK` or `CRYPTO`; omitted values use the market-data service's symbol inference                      |

The range cannot exceed `limit` intervals (for `1M`, each interval is bounded as 31 days).

Symbols may contain letters, digits, `.`, `_`, `:`, `/`, or `-`.

Both Finnhub stocks and Binance crypto support the listed intervals.

The provider adapter normalizes timestamps to ISO 8601 UTC and OHLCV values to canonical decimal strings; returned points are in ascending timestamp order.

Successful responses use:

```json
{
    "success": true,
    "data": {
        "symbol": "...",
        "assetClass": "...",
        "interval": "...",
        "prices": []
    }
}
```

Each point contains `timestamp`, `open`, `high`, `low`, `close`, and `volume`.

A valid range with no data returns `"prices": []`.

Invalid query parameters or symbols return HTTP 400 `VALIDATION_ERROR`; provider errors use the standard market-data codes, including `MARKET_DATA_NOT_FOUND`, `MARKET_DATA_RATE_LIMITED`, `MARKET_DATA_TIMEOUT`, and `MARKET_DATA_PROVIDER_UNAVAILABLE`.

### Example

```text
GET /api/v1/market/history/AAPL?interval=1d&from=1793318400000&to=1793404800000&limit=100
```

### Response

```json
{
    "success": true,
    "data": {
        "symbol": "AAPL",
        "assetClass": "STOCK",
        "interval": "1d",
        "prices": [
            {
                "timestamp": "2026-10-30T00:00:00.000Z",
                "open": "100",
                "high": "105",
                "low": "99",
                "close": "103.5",
                "volume": "1000"
            }
        ]
    }
}
```

## `GET /market/news/:symbol`

Get market news.

## `GET /market/orderbook/:symbol`

Get crypto order-book depth where supported.

## `GET /market/trades/:symbol`

Get recent market trades where supported.

---

# 🔔 Alerts

## `GET /alerts`

List the authenticated user's alerts.

## `POST /alerts`

Create an alert.

### Request

```json
{
    "symbol": "AAPL",
    "condition": "PRICE_ABOVE",
    "targetPrice": "250",
    "sendEmail": true,
    "sendPush": false
}
```

For `PERCENT_CHANGE_UP`/`PERCENT_CHANGE_DOWN`, `targetPrice` is a percentage threshold. The server captures the current quote at creation time and returns it as `baselinePrice` (with `baselineAt`); the request fails with a `MARKET_DATA_*` error if that quote is unavailable. `PRICE_ABOVE`/`PRICE_BELOW` alerts return both baseline fields as `null`.

## `PATCH /alerts/:id`

Update an alert.

## `DELETE /alerts/:id`

Delete an alert.

---

# 👥 Social

## `GET /social/feed`

Get the social feed.

### Query Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `sort` | enum | `latest` | Ordering mode: `latest` (chronological) or `trending` (decay-ranked) |
| `asOf` | string | `now()` | Optional ISO 8601 timestamp to freeze recency age decay during pagination |
| `page` | int | `1` | Page number ($\ge 1$) |
| `limit` | int | `20` | Items per page ($1 \le \text{limit} \le 50$) |

### Trending Ranking & Candidate Window

In `trending` mode, candidates are bounded to a maximum of 200 posts created within the last 7 days (`createdAt >= NOW() - INTERVAL '7 days'`). Posts from suspended authors or marked hidden are strictly excluded.

Posts are scored using the decay formula:

$$\text{Score} = \frac{\text{likes} + 1 + (\text{isFollowing} ? 2 : 0)}{(\text{ageHours} + 2)^{1.2}}$$

- **Recency stability**: Supplying `asOf` freezes the age calculation across pages. Concurrent like changes or follow relationship updates can dynamically shift scores as documented for trending feeds.
- **Tie-breakers**: Ranked by `score DESC, createdAt DESC, id ASC`.

## `POST /social/posts`

Create a social post.

## `GET /social/posts/:postId`

Get a visible post, its public author details, and the authenticated viewer's like state.

Hidden or missing posts return `404 POST_NOT_FOUND`.

## `DELETE /social/posts/:postId`

Delete the authenticated user's own post.

Missing posts and posts owned by another user return the same not-found response. Related likes are deleted by the database cascade.

## `GET /social/posts/:postId/engagement`

Get the visible post's like count and whether the authenticated viewer has liked it.

## `POST /social/posts/:postId/likes`

Like a visible post.

A user can like a post once; repeated likes return a conflict response.

## `DELETE /social/posts/:postId/likes`

Remove the authenticated user's like from a visible post.

## `GET /social/users/:userId`

Get a user's public social profile and a paginated list of their visible posts.

The profile includes follower, following, and post counts, plus whether the authenticated caller follows that user.

Email and other private account fields are not included. Suspended or missing users return `404 USER_NOT_FOUND`.

## `POST /social/follow/:userId`

Follow a user.

## `DELETE /social/follow/:userId`

Unfollow a user.

## `GET /social/followers`

Get followers.

## `GET /social/following`

Get following.

---

# 🔄 Copy Trading

All copy-trading routes are authenticated and scoped to the caller as the
copier. A relationship is identified by its UUID and is invisible to other
users (foreign and missing IDs both return `404 COPY_TRADING_NOT_FOUND`).

## `GET /copy-trading`

List the caller's copy relationships. Query: `page` (default `1`), `limit`
(1–100, default `20`), optional `isActive=true|false`. Returns
`{ data: { copyTraders: [...], pagination: {...} } }`.

## `POST /copy-trading`

Start copying a trader.

### Request

```json
{
    "traderId": "uuid",
    "allocationPct": "50",
    "maxTradeSize": "1000",
    "copyPortfolioId": "uuid",
    "isActive": true
}
```

- `allocationPct` is optional (default `100`), must be `> 0` and `<= 100` with
  at most 2 decimal places.
- `maxTradeSize` is optional and, when provided, is a notional
  (quote-currency) sizing cap greater than zero with at most 8 decimal places.
  It is applied at fan-out using the source trade price, so it bounds the
  copied quantity rather than the follower's final executed notional (copied
  orders are `MARKET` and may fill at a different price).
- `copyPortfolioId` is optional; when omitted the copier's default active
  portfolio is stored. It must belong to the caller and be active.
- `isActive` defaults to `true`.
- `409 COPY_TRADING_ALREADY_EXISTS` covers the unique `[copierId, copiedId]`
  pair, including paused relationships.

## `PATCH /copy-trading/:id`

Update copy settings. Strict body with at least one of `allocationPct`,
`maxTradeSize`, `copyPortfolioId`, or `isActive`. Send `null` for
`maxTradeSize` or `copyPortfolioId` to clear it. Returns
`{ data: { copyTrader } }`.

## `DELETE /copy-trading/:id`

Stop copying. This is a soft delete (`isActive = false`) and is idempotent.
Re-enable the same relationship with `PATCH { "isActive": true }` instead of
creating a duplicate pair.

## Execution semantics

After a source order executes, the backend places one `MARKET` order per active
relationship whose copied trader owns the source portfolio. The copied quantity
is `sourceQuantity × allocationPct / 100`, capped by
`maxTradeSize / sourcePrice` when a notional cap is set, and rounded down to 8
decimal places. Because the copied order is `MARKET`, the follower's actual fill
price can differ from `sourcePrice`; `maxTradeSize` caps the sized quantity, not
the final executed notional. Fan-out is post-commit, per-follower isolated, and
guarded by a durable `(sourceTradeId, copierId)` execution row. A trade whose
source order is already `COPY_TRADE` is not copied again, which prevents copy
chains.

---

# 🏆 Leaderboards

## `GET /leaderboard`

Get the global leaderboard.

## `GET /leaderboard/friends`

Get the leaderboard of followed users/friends.

## `GET /leaderboard/history`

Get historical stored snapshot rankings from the persistent global leaderboard.

### Query Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `period` | enum | `ALL_TIME` | Snapshot period: `DAILY`, `WEEKLY`, `MONTHLY`, `ALL_TIME` |
| `date` | string | latest snapshot | Optional exact snapshot date (`YYYY-MM-DD`) |
| `from` | string | - | Optional start of historical snapshot date range (`YYYY-MM-DD`) |
| `to` | string | - | Optional end of historical snapshot date range (`YYYY-MM-DD`) |
| `page` | int | `1` | Page number ($\ge 1$) |
| `limit` | int | `20` | Items per page ($1 \le \text{limit} \le 100$) |

### Stored Ranks & Rank Preservation

- Queries historical entries recorded in `LeaderboardSnapshot` for `GLOBAL` scope.
- Preserves recorded `rank` values verbatim. If suspended users are omitted from output, remaining entries preserve their stored rank values with natural gaps (e.g. Rank 1, Rank 3). Ranks are never re-indexed.
- **Ordering**:
  - Date range queries: `snapshotDate DESC, rank ASC, userId ASC`.
  - Single date queries: `rank ASC, userId ASC`.

### Snapshot generation

Global leaderboard entries are calculated and saved as daily snapshots.

To generate or refresh today's `DAILY`, `WEEKLY`, `MONTHLY`, and `ALL_TIME` snapshots, run the following command from `backend/`:

```bash
npm run leaderboard:snapshot
```

Rankings use return percentage, then total value as a tiebreaker.

Period returns use realized trade P&L in the UTC period; all-time return compares current portfolio value with starting balances.

Portfolio value is cash plus the recorded invested basis of open holdings.

---

# 🏟️ Leagues

## `POST /leagues`

Create a new trading competition/league.

### Request Body

```json
{
  "name": "Global Championship 2026",
  "description": "Quarterly competition for all active traders",
  "startingBalance": 10000,
  "startDate": "2026-12-01T00:00:00.000Z",
  "endDate": "2026-12-31T23:59:59.999Z",
  "maxParticipants": 500
}
```

## `GET /leagues`

List leagues with pagination and optional status filtering.

### Query Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `status` | enum | - | Filter by status: `UPCOMING`, `ACTIVE`, `COMPLETED`, `CANCELLED` |
| `page` | int | `1` | Page number ($\ge 1$) |
| `limit` | int | `20` | Items per page ($1 \le \text{limit} \le 100$) |

## `GET /leagues/:id`

Get single league details including participant member count.

## `POST /leagues/:id/join`

Join an upcoming league.

### League Portfolio Isolation & Restrictions

- **Dedicated competition portfolios**: Every participant is provisioned an isolated competition portfolio initialized with `league.startingBalance`. Reusing or linking pre-existing personal portfolios is strictly disallowed (`portfolioId` in request is rejected with `400 PORTFOLIO_ASSIGNMENT_NOT_SUPPORTED`).
- **Atomic capacity check**: Capacity is enforced atomically with a row lock (`SELECT ... FOR UPDATE` on `League`); if `currentParticipants >= maxParticipants`, returns `400 LEAGUE_FULL`.
- **Strict registration deadline**: Late joining is disallowed once the competition starts (`joinedAt <= startDate` required; requires status `UPCOMING` and `now < startDate`). Attempting to join after start returns `400 LEAGUE_ALREADY_STARTED`.
- **Duplicate joins**: A user can join each league once; duplicate join returns `409 ALREADY_JOINED`.

## `GET /leagues/:id/leaderboard`

Get live or finalized rankings for a league.

### Scoring Formula & Mark-to-Market Valuation

$$\text{Return \%} = \frac{\text{Current Valuation} - \text{startingBalance}}{\text{startingBalance}} \times 100$$

- **Fee accounting**: Net cash strictly deducts all trade transaction fees via the `Trade.fees` column.
- **Position valuation & short liabilities**: Long holdings add `quantity * marketPrice`; short position liabilities are deducted (`quantity * marketPrice` where `quantity < 0`).
- **Strict market data enforcement**: Live and historical market quotes are strictly enforced. If market data is unavailable or fails, returns `503 MARKET_DATA_PROVIDER_UNAVAILABLE` (substituting trade execution prices is strictly prohibited).
- **Tie-breaker hierarchy**:
  1. `returnPct DESC`
  2. `totalValue DESC`
  3. `tradeCount DESC`
  4. `joinedAt ASC`
  5. `userId ASC`
- **Zero-trade participants**: Ranked strictly alongside all other participants using score and tie-breakers without artificial demotion.
- **Finalization & immutability**: Upon completion ($now \ge endDate$ or status `COMPLETED`), final rankings and returns are persisted to `LeagueMember.rank` and `LeagueMember.finalReturn` inside an atomic transaction, making outcomes permanent and immutable.

---

# 🏅 Achievements

## `GET /achievements`

Get all available achievements in the catalog.

### Supported Achievement Types

- `FIRST_TRADE`: First trade executed on any portfolio.
- `FIRST_PROFIT`: First trade executed with positive realized P&L (`realizedPnl > 0`).
- `TEN_SUCCESSFUL_TRADES`: Reaching 10 executed trades with positive realized P&L.
- `PORTFOLIO_MILESTONE`: Portfolio total valuation reaching or exceeding twice starting balance ($\text{totalValue} \ge \text{startingBalance} \times 2$).

## `GET /achievements/mine`

Get achievements unlocked by the authenticated caller. Each award includes its
`unlockedAt` timestamp and a `reason` snapshot of the achievement description
at the time it was granted.

### Durable Evaluation & Crash Recovery

- Achievements are evaluated post-commit during trade execution (`tradeService.executeOrder`).
- A scheduled background worker (`achievementWorker`) performs periodic reconciliation on startup and recurring intervals, guaranteeing that unrecorded achievements are granted even in the event of worker or process restarts.

---

# 📊 Sentiment

## `GET /sentiment/:symbol`

Get aggregated community sentiment for a market symbol across time windows.

### Query Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `window` | enum | `all` | Observation window: `24h`, `7d`, `30d`, `all` |

### Aggregation Rules & Thresholds

- **Sample threshold**: Requires a fixed minimum sample threshold of $N_{\min} = 5$ votes across all environments.
- **Classifications**:
  - $T = 0$: `classification = "NO_DATA"`, `status = "ZERO_VOTES"`, `sampleThresholdMet = false`.
  - $0 < T < 5$: `classification = "NO_DATA"`, `status = "INSUFFICIENT_SAMPLE"`, `sampleThresholdMet = false`, reports exact vote count.
  - $T \ge 5$: `sampleThresholdMet = true`.
    - `BULLISH`: Bullish votes exceed 50% ($p_B > 50\%$) and $B > R$.
    - `BEARISH`: Bearish votes exceed 50% ($p_R > 50\%$) and $R > B$.
    - `NEUTRAL`: Neither side exceeds 50% once minimum sample is reached.
- **Vote recency**: Changing a vote updates `updatedAt = now()`, immediately refreshing its recency into active rolling windows.

## `POST /sentiment/:symbol/vote`

Submit or update a sentiment vote for a symbol.

### Request Body

```json
{
  "sentiment": "BULLISH"
}
```

Allowed values: `BULLISH`, `BEARISH`, `NEUTRAL`.

---

# 🔔 Notifications

## `GET /notifications`

List the authenticated user's notifications.

### Supported Notification Types

- `ORDER_EXECUTED`: Order was fully executed.
- `ORDER_CANCELLED`: Order was cancelled.
- `ORDER_REJECTED`: Order was rejected during execution or validation.
- `ORDER_EXPIRED`: Order expired before execution.
- `PRICE_ALERT`: Price threshold alert triggered.
- `ACHIEVEMENT_UNLOCKED`: New achievement granted to the user.
- `COPY_TRADE_EXECUTED`: Trade executed on behalf of copier.
- `LEAGUE_UPDATE`: Final results are available for an enrolled league.
- `NEW_FOLLOWER`: A user followed the authenticated trader.
- `SYSTEM`: Platform notifications.

Order notifications are generated for execution, cancellation, rejection, and expiry. Other supported triggers are price-alert activation, achievement unlock, new follower, copied-order execution, and league completion. Each notification belongs to its recipient and includes event-specific structured data. Replayed source events reuse their existing notification row; delivery jobs and channel retries are idempotent.

## `PATCH /notifications/:id/read`

Mark a notification as read.

## `PATCH /notifications/read-all`

Mark all notifications as read.

---

# ⚙️ User Preferences

## `GET /preferences`

Returns the authenticated user's notification preferences.

**Authentication:** Bearer JWT required.

If the user has no preferences record, one is created automatically with both notification settings enabled.

### Response

```json
{
    "success": true,
    "data": {
        "preferences": {
            "id": "clxxxxxxxxxxxxxxxxxxxx",
            "userId": "user-uuid",
            "emailNotifications": true,
            "pushNotifications": true,
            "createdAt": "2026-10-26T06:50:43.000Z",
            "updatedAt": "2026-10-26T06:50:43.000Z"
        }
    }
}
```

## `PATCH /preferences`

Updates the authenticated user's notification preferences.

**Authentication:** Bearer JWT required.

### Request

At least one supported field must be supplied. Both fields are optional individually.

```json
{
    "emailNotifications": false
}
```

### Supported fields

| Field                | Type    | Default |
| -------------------- | ------- | ------- |
| `emailNotifications` | Boolean | `true`  |
| `pushNotifications`  | Boolean | `true`  |

Only the supplied fields are updated. Omitted fields retain their existing values.

### Response

Returns `200 OK` with the updated preferences in the same response structure as `GET /preferences`.

### Validation

Returns `400 Bad Request` with a `VALIDATION_ERROR` response when:

- The request body is empty.
- A preference value is not a boolean.
- The request contains unknown fields.

---

# 🛡️ Admin

All admin endpoints require a valid Bearer JWT and the `ADMIN` role unless otherwise specified.

## `GET /admin/orders`

List orders across all users and portfolios.

Read-only: only `GET` is exposed on this path.

**Authentication:** Bearer JWT required.

**Authorization:** `ADMIN` role required.

### Query parameters

| Parameter     | Type    | Required | Default | Description                                             |
| ------------- | ------- | -------- | ------- | ------------------------------------------------------- |
| `page`        | integer | No       | `1`     | Page number (`>= 1`)                                    |
| `limit`       | integer | No       | `20`    | Page size (`1..100`)                                    |
| `status`      | enum    | No       | —       | One or more statuses, comma-separated                   |
| `symbol`      | string  | No       | —       | Exact symbol match; trimmed and normalized to uppercase |
| `side`        | enum    | No       | —       | `BUY` or `SELL`                                         |
| `type`        | enum    | No       | —       | `MARKET`, `LIMIT`, `STOP_LOSS`, or `TAKE_PROFIT`        |
| `portfolioId` | UUID    | No       | —       | Restrict to a single portfolio                          |
| `userId`      | UUID    | No       | —       | Restrict to the portfolios owned by a single user       |
| `from`        | date    | No       | —       | Inclusive lower bound on `createdAt`                    |
| `to`          | date    | No       | —       | Exclusive upper bound on `createdAt`                    |

Filters combine with **AND**: supplying `userId` and `portfolioId` together returns only orders that satisfy both.

Unknown query parameters are ignored.

`from` and `to` accept `YYYY-MM-DD` (interpreted as a UTC day) or an ISO datetime with an explicit UTC offset (`Z` or `±HH:MM`).

Datetimes without an offset are rejected. A date-only `to` covers the whole selected day.

### Ordering

Newest first by `createdAt`.

Orders that share a `createdAt` are ordered deterministically, so walking consecutive pages never duplicates or skips a row.

### Errors

| Status | Code                   | When                                                         |
| ------ | ---------------------- | ------------------------------------------------------------ |
| 401    | `UNAUTHORIZED`         | No credentials supplied                                      |
| 401    | `INVALID_ACCESS_TOKEN` | Malformed or expired access token                            |
| 403    | `FORBIDDEN`            | Authenticated, but the caller is not an `ADMIN`              |
| 400    | `VALIDATION_ERROR`     | Invalid query parameter; `details` lists `{ path, message }` |

Authentication and authorization run before query validation, so a request without a valid admin token never reports validation errors.

### Response

```json
{
    "success": true,
    "data": {
        "orders": [
            {
                "id": "uuid",
                "portfolioId": "uuid",
                "symbol": "AAPL",
                "assetType": "STOCK",
                "side": "BUY",
                "type": "LIMIT",
                "status": "PENDING",
                "quantity": "10",
                "limitPrice": "250.5",
                "stopPrice": null,
                "executedPrice": null,
                "executedAt": null,
                "expiresAt": null,
                "notes": null,
                "source": "MANUAL",
                "createdAt": "2026-10-09T10:00:00.000Z",
                "updatedAt": "2026-10-09T10:00:00.000Z",
                "portfolio": {
                    "id": "uuid",
                    "name": "Main Portfolio",
                    "isActive": true
                },
                "owner": {
                    "id": "uuid",
                    "name": "John Trader",
                    "email": "john@example.com"
                }
            }
        ],
        "pagination": {
            "page": 1,
            "limit": 20,
            "total": 1,
            "totalPages": 1
        }
    }
}
```

Decimal fields are serialized as strings.

Only the order fields above, the portfolio identity/flags, and the owner's `id`, `name`, and `email` are exposed. Credentials, tokens, and unrelated private user data are never included.

## `GET /admin/portfolios`

List portfolios across all users.

Requires a valid Bearer token with the `ADMIN` role.

### Query parameters

| Name       | Required | Contract                                                             |
| ---------- | -------- | -------------------------------------------------------------------- |
| `page`     | No       | 1-based integer from 1 to 100,000; defaults to 1                     |
| `limit`    | No       | Integer from 1 to 100; defaults to 20                                |
| `userId`   | No       | UUID of the portfolio owner                                          |
| `isActive` | No       | `true` or `false`                                                    |
| `search`   | No       | Case-insensitive match on portfolio name, owner name, or owner email |

### Response

Returns:

```json
{
    "success": true,
    "data": {
        "portfolios": [],
        "pagination": {
            "page": 1,
            "limit": 20,
            "total": 0,
            "totalPages": 0
        }
    }
}
```

Portfolio fields are explicitly selected:

- `id`
- `userId`
- `name`
- `description`
- `startingBalance`
- `cashBalance`
- `isDefault`
- `isActive`
- `createdAt`
- `updatedAt`
- Minimal `owner` details (`id`, `name`, `email`)

Balance values are decimal strings to preserve precision.

## `GET /admin/portfolios/:portfolioId`

Inspect one portfolio across users.

Requires a valid Bearer token with the `ADMIN` role and a UUID portfolio ID.

Returns the selected portfolio fields under `data.portfolio`.

A missing portfolio returns HTTP 404 `PORTFOLIO_NOT_FOUND`.

Admin inspection does not change ordinary owner-scoped portfolio access.

## `GET /admin/users`

List users.

Supported filters:

```text
page
limit
search
role
isSuspended
isVerified
```

## `GET /admin/users/:id`

Get user details.

## `PATCH /admin/users/:id/suspend`

Suspend or unsuspend a user.

## `GET /admin/analytics`

Get platform-wide analytics.

## `GET /admin/health`

Get system health.

## `GET /admin/market-data`

Get market-data provider health.

## `POST /admin/reports`

Generate administrative reports.

## `GET /admin/audit-logs`

Search audit activity.

---

# 📦 Response Format

## Success

```json
{
    "success": true,
    "data": {}
}
```

## Error

```json
{
    "success": false,
    "error": {
        "code": "INSUFFICIENT_BALANCE",
        "message": "Insufficient portfolio cash.",
        "details": {
            "required": "2500",
            "available": "1200"
        }
    }
}
```

---

# 📄 Pagination

Paginated endpoints use:

```text
?page=1&limit=20
```

### Response

```json
{
    "success": true,
    "data": {
        "items": [],
        "pagination": {
            "page": 1,
            "limit": 20,
            "total": 120,
            "totalPages": 6
        }
    }
}
```

---

# ❌ Standard Error Categories

```text
VALIDATION_ERROR
UNAUTHORIZED
FORBIDDEN
NOT_FOUND
CONFLICT
INSUFFICIENT_BALANCE
INSUFFICIENT_POSITION
INVALID_ORDER
ORDER_NOT_EXECUTABLE
RATE_LIMITED
MARKET_DATA_UNAVAILABLE
INTERNAL_SERVER_ERROR
```
