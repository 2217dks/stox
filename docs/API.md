# 🔌 API Specification

> Final REST API specification for stox.

---

# 🌐 Base URL

```text
/api/v1
```

---

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

---

## `POST /auth/login`

```json
{
    "email": "john@example.com",
    "password": "SecurePass123!"
}
```

---

## `POST /auth/google`

```json
{
    "credential": "..."
}
```

---

## `POST /auth/refresh`

```json
{
    "refreshToken": "..."
}
```

---

## `POST /auth/logout`

```json
{
    "refreshToken": "..."
}
```

---

## `GET /auth/me`

Returns the authenticated user.

---

## `PATCH /auth/profile`

Updates profile information.

```json
{
    "name": "New Name",
    "avatarUrl": "https://..."
}
```

---

# 👤 Users

## `GET /users/:id`

Get public user profile.

## `GET /users/:id/portfolio`

Get publicly visible portfolio information.

## `GET /users/:id/trades`

Get publicly visible trading history.

---

# 💼 Portfolios

## `GET /portfolios`

List authenticated user's portfolios.

## `POST /portfolios`

Create portfolio.

## `GET /portfolios/:id`

Get portfolio details.

## `PATCH /portfolios/:id`

Update portfolio.

## `DELETE /portfolios/:id`

Deactivate/delete portfolio.

## `GET /portfolios/:id/holdings`

Get current holdings.

## `GET /portfolios/:id/performance`

Get performance history and statistics.

## `GET /portfolios/:id/pnl-heatmap`

Get daily P&L heatmap data.

---

# 📋 Orders

## `GET /orders`

List authenticated user's orders.

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

```json
{
    "portfolioId": "uuid",
    "symbol": "AAPL",
    "assetType": "STOCK",
    "side": "BUY",
    "type": "LIMIT",
    "quantity": "10",
    "limitPrice": "250"
}
```

## `GET /orders/:id`

Get order details.

## `PATCH /orders/:id`

Modify an eligible pending order.

## `DELETE /orders/:id`

Cancel an eligible pending order.

---

# 💱 Trades

## `GET /trades`

List user's executed trades.

## `GET /trades/:id`

Get trade details.

---

# 📊 Market Data

## `GET /market/search`

Search supported stocks and crypto pairs through the configured market-data
providers. This public, read-only endpoint uses the global API rate limit.

Query parameters:

| Name | Required | Contract |
| --- | --- | --- |
| `query` | Yes | Trimmed text from 2 to 50 characters |
| `assetClass` | No | `STOCK` or `CRYPTO`; omitted searches both configured providers |
| `limit` | No | Integer from 1 to 50; defaults to 20 |

Results are returned in the standard envelope as an array in `data`. Each item
contains only `symbol`, `name`, `assetClass`, `exchange`, `currency`, `type`,
and `source`. Symbol and exchange are uppercase; currency is uppercase when
known. Optional metadata is `null` when unavailable. A query with no matches
returns HTTP 200 with `data: []`.

When both asset classes are requested, the service combines both provider
results. If either provider fails, the entire request returns the standard
market-data error envelope rather than a misleading partial result. Pass
`assetClass` to search only one provider. Provider timeouts, throttling, and
unavailability use the standard market-data domain error codes.

Example:

```text
GET /api/v1/market/search?query=apple&assetClass=STOCK&limit=20
```

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

Get a normalized Binance crypto quote. This public, read-only endpoint does not
require authentication and uses the global API rate limit. Supported symbol
forms include `BTCUSDT`, `BINANCE:BTCUSDT`, and `BTC/USDT`; quote assets follow
the market-data service conventions (`USDT`, `BTC`, or `ETH`).

The response uses the standard envelope, with the normalized quote DTO in
`data`:

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

Prices and volume are canonical decimal strings. Unsupported or invalid symbol
formats return HTTP 400 `VALIDATION_ERROR`; unknown Binance pairs return HTTP
404 `MARKET_DATA_NOT_FOUND`. Provider timeouts, rate limits, and unavailable
provider errors use the documented market-data domain error codes.

## `GET /market/quote/stock/:symbol`

Get a normalized Finnhub stock quote. This public, read-only endpoint does not
require authentication and uses the global API rate limit. Tickers are
case-insensitive and may contain letters, digits, `.` or `-`, with a maximum
length of 20 characters (for example, `AAPL` or `BRK.B`).

The response uses the same normalized quote DTO and standard envelope as the
crypto quote route. Finnhub does not return quote volume, so `volume` is
`null`; optional quote fields are also `null` when absent.

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

Malformed ticker formats return HTTP 400 `VALIDATION_ERROR`; unsupported
symbols return HTTP 404 `MARKET_DATA_NOT_FOUND`. Missing Finnhub configuration,
provider timeouts, rate limits, and unavailable providers use the standard
market-data domain errors. API credentials and raw provider payloads are never
included in response data or error messages.

## `GET /market/overview`

Get a current overview for one asset class. This public, read-only endpoint
uses the global API rate limit and does not cache responses. `assetClass` is
required and must be `STOCK` or `CRYPTO`; `limit` is optional, defaults to 10,
and must be an integer from 1 to 100.

The response uses the standard envelope. `data` contains `assetClass`,
`asOf`, `marketStatus`, `movers`, and `source`. `asOf` is an ISO 8601 UTC
timestamp for the provider's market-status data when supplied; otherwise it is
the retrieval time. `marketStatus` contains `isOpen` and provider-normalized
session metadata. Crypto movers contain `symbol`, `price`, `changePercent`,
and `quoteVolume`; decimal values are strings and `quoteVolume` may be `null`
if the provider omits it.

The stock provider currently supplies US market status but no mover feed, so
`movers` is `null` to signal that the field is unavailable. For a provider
that supports movers, an empty array means the feed was available but returned
no movers. If the selected provider is unavailable or returns malformed data,
the whole request returns the standard market-data error envelope; missing
values are not fabricated. Responses are provider-fresh and are not cached.

Invalid or missing query parameters return HTTP 400 `VALIDATION_ERROR`.
Provider timeouts, rate limits, and unavailable providers use
`MARKET_DATA_TIMEOUT`, `MARKET_DATA_RATE_LIMITED`, and
`MARKET_DATA_PROVIDER_UNAVAILABLE` respectively.

Example: `GET /api/v1/market/overview?assetClass=CRYPTO&limit=10`

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

Get normalized historical OHLCV data. This read-only endpoint is public and
uses the configured provider for the requested asset class.

Query parameters:

| Name | Required | Contract |
| --- | --- | --- |
| `interval` | Yes | `1m`, `5m`, `15m`, `30m`, `1h`, `4h`, `1d`, `1w`, or `1M` |
| `from` | Yes | Inclusive Unix epoch timestamp in milliseconds |
| `to` | Yes | Inclusive Unix epoch timestamp in milliseconds; must be after `from` and no later than the current time |
| `limit` | No | Integer from 1 to 1000; defaults to 500 |
| `assetClass` | No | `STOCK` or `CRYPTO`; omitted values use the market-data service's symbol inference |

The range cannot exceed `limit` intervals (for `1M`, each interval is bounded
as 31 days). Symbols may contain letters, digits, `.`, `_`, `:`, `/`, or `-`.
Both Finnhub stocks and Binance crypto support the listed intervals. The
provider adapter normalizes timestamps to ISO 8601 UTC and OHLCV values to
canonical decimal strings; returned points are in ascending timestamp order.

Successful responses use `{ "success": true, "data": { "symbol", "assetClass", "interval", "prices": [...] } }`.
Each point contains `timestamp`, `open`, `high`, `low`, `close`, and `volume`.
A valid range with no data returns `"prices": []`. Invalid query parameters or
symbols return HTTP 400 `VALIDATION_ERROR`; provider errors use the standard
market-data codes, including `MARKET_DATA_NOT_FOUND`,
`MARKET_DATA_RATE_LIMITED`, `MARKET_DATA_TIMEOUT`, and
`MARKET_DATA_PROVIDER_UNAVAILABLE`.

Example: `GET /api/v1/market/history/AAPL?interval=1d&from=1793318400000&to=1793404800000&limit=100`

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

List user's alerts.

## `POST /alerts`

Create alert.

```json
{
    "symbol": "AAPL",
    "condition": "PRICE_ABOVE",
    "targetPrice": "250",
    "sendEmail": true,
    "sendPush": false
}
```

## `PATCH /alerts/:id`

Update alert.

## `DELETE /alerts/:id`

Delete alert.

---

# 👥 Social

## `GET /social/feed`

Get social feed.

## `POST /social/follow/:userId`

Follow user.

## `DELETE /social/follow/:userId`

Unfollow user.

## `GET /social/followers`

Get followers.

## `GET /social/following`

Get following.

---

# 🔄 Copy Trading

## `GET /copy-trading`

List active copy relationships.

## `POST /copy-trading`

Start copying a trader.

```json
{
    "traderId": "uuid",
    "allocationPct": "50",
    "maxTradeSize": "1000"
}
```

## `PATCH /copy-trading/:id`

Update copy settings.

## `DELETE /copy-trading/:id`

Stop copying.

---

# 🏆 Leaderboards

## `GET /leaderboard`

Global leaderboard.

## `GET /leaderboard/friends`

Leaderboard of followed users/friends.

---

# 🏟️ Leagues

## `GET /leagues`

List leagues.

## `POST /leagues/:id/join`

Join league.

## `GET /leagues/:id/leaderboard`

Get league rankings.

---

# 🏅 Achievements

## `GET /achievements`

Get all achievements.

## `GET /achievements/mine`

Get authenticated user's achievements.

---

# 📊 Sentiment

## `GET /sentiment/:symbol`

Get community sentiment.

## `POST /sentiment/:symbol/vote`

Submit or update sentiment vote.

```json
{
    "sentiment": "BULLISH"
}
```

---

# 🔔 Notifications

## `GET /notifications`

List user's notifications.

## `PATCH /notifications/:id/read`

Mark notification as read.

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

Supported fields:

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

# 🛡️ Admin

## `GET /admin/portfolios`

List portfolios across all users. Requires a valid Bearer token with the
`ADMIN` role. Query parameters:

| Name | Required | Contract |
| --- | --- | --- |
| `page` | No | 1-based integer from 1 to 100,000; defaults to 1 |
| `limit` | No | Integer from 1 to 100; defaults to 20 |
| `userId` | No | UUID of the portfolio owner |
| `isActive` | No | `true` or `false` |
| `search` | No | Case-insensitive match on portfolio name, owner name, or owner email |

Returns `{ "success": true, "data": { "portfolios": [...], "pagination": { "page", "limit", "total", "totalPages" } } }`.
Portfolio fields are explicitly selected: `id`, `userId`, `name`,
`description`, `startingBalance`, `cashBalance`, `isDefault`, `isActive`,
`createdAt`, `updatedAt`, and minimal `owner` details (`id`, `name`, `email`).
Balance values are decimal strings to preserve precision.

## `GET /admin/portfolios/:portfolioId`

Inspect one portfolio across users. Requires a valid Bearer token with the
`ADMIN` role and a UUID portfolio ID. Returns the selected portfolio fields
under `data.portfolio`; a missing portfolio returns HTTP 404
`PORTFOLIO_NOT_FOUND`. Admin inspection does not change ordinary owner-scoped
portfolio access.

Both endpoints return 401 for unauthenticated requests, 403 for non-admin
users, and 400 `VALIDATION_ERROR` for invalid filters or IDs.

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

Platform-wide analytics.

## `GET /admin/health`

System health.

## `GET /admin/market-data`

Market-data provider health.

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

Response:

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
