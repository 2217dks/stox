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

Get daily P&L heatmap data.

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

List the authenticated user's executed trades.

## `GET /trades/:id`

Get trade details.

---

# 📊 Market Data

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

## `PATCH /alerts/:id`

Update an alert.

## `DELETE /alerts/:id`

Delete an alert.

---

# 👥 Social

## `GET /social/feed`

Get the social feed.

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

## `GET /copy-trading`

List active copy relationships.

## `POST /copy-trading`

Start copying a trader.

### Request

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

Get the global leaderboard.

## `GET /leaderboard/friends`

Get the leaderboard of followed users/friends.

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

## `GET /leagues`

List leagues.

## `POST /leagues/:id/join`

Join a league.

## `GET /leagues/:id/leaderboard`

Get league rankings.

---

# 🏅 Achievements

## `GET /achievements`

Get all achievements.

## `GET /achievements/mine`

Get the authenticated user's achievements.

---

# 📊 Sentiment

## `GET /sentiment/:symbol`

Get community sentiment.

## `POST /sentiment/:symbol/vote`

Submit or update a sentiment vote.

### Request

```json
{
    "sentiment": "BULLISH"
}
```

---

# 🔔 Notifications

## `GET /notifications`

List the authenticated user's notifications.

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
