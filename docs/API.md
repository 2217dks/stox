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

Get current market quote.

## `GET /market/history/:symbol`

Get historical OHLCV data.

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

## `GET /admin/orders`

List orders across all users and portfolios. Read-only: only `GET` is exposed on
this path.

**Authentication:** Bearer JWT required.

**Authorization:** `ADMIN` role required.

### Query parameters

| Parameter     | Type    | Required | Default | Description                                                    |
| ------------- | ------- | -------: | ------: | -------------------------------------------------------------- |
| `page`        | integer |       No |     `1` | Page number (`>= 1`)                                           |
| `limit`       | integer |       No |    `20` | Page size (`1..100`)                                           |
| `status`      | enum    |       No |       — | One or more statuses, comma-separated                          |
| `symbol`      | string  |       No |       — | Exact symbol match; trimmed and normalized to uppercase        |
| `side`        | enum    |       No |       — | `BUY` or `SELL`                                                |
| `type`        | enum    |       No |       — | `MARKET`, `LIMIT`, `STOP_LOSS`, or `TAKE_PROFIT`               |
| `portfolioId` | uuid    |       No |       — | Restrict to a single portfolio                                 |
| `userId`      | uuid    |       No |       — | Restrict to the portfolios owned by a single user              |
| `from`        | date    |       No |       — | Inclusive lower bound on `createdAt`                           |
| `to`          | date    |       No |       — | Exclusive upper bound on `createdAt`                           |

Filters combine with **AND**: supplying `userId` and `portfolioId` together
returns only orders that satisfy both. Unknown query parameters are ignored.

`from` / `to` accept `YYYY-MM-DD` (interpreted as a UTC day) or an ISO datetime
with an explicit UTC offset (`Z` or `±HH:MM`). Datetimes without an offset are
rejected. A date-only `to` covers the whole selected day.

### Ordering

Newest first by `createdAt`. Orders that share a `createdAt` are ordered
deterministically, so walking consecutive pages never duplicates or skips a row.

### Errors

| Status | Code                   | When                                                    |
| ------ | ---------------------- | ------------------------------------------------------- |
| 401    | `UNAUTHORIZED`         | No credentials supplied                                 |
| 401    | `INVALID_ACCESS_TOKEN` | Malformed or expired access token                       |
| 403    | `FORBIDDEN`            | Authenticated, but the caller is not an `ADMIN`         |
| 400    | `VALIDATION_ERROR`     | Invalid query parameter; `details` lists `{ path, message }` |

Authentication and authorization run before query validation, so a request
without a valid admin token never reports validation errors.

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

Decimal fields are serialized as strings. Only the order fields above, the
portfolio identity/flags, and the owner's `id`, `name`, and `email` are
exposed; credentials, tokens, and unrelated private user data are never
included.

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
