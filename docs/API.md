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

Search tradable instruments.

Example:

```text
?query=apple
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
