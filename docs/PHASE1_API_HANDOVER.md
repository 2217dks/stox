# Stox Phase 1 API handover

**Repository:** `daksheshsharma2409/stox`  
**Branch inspected:** `feat/admin-account-controls` (admin account controls update)
**Base URL:** `/api/v1`

This reference is derived from the route registration, validators, controllers, services referenced by those controllers, and backend tests in the current `main` tree. It describes only endpoints that are actually mounted by `backend/src/routes/index.js`. Some older documentation lists routes that are not mounted; those are called out as absent below.

## Calling conventions

### Authentication and authorization

Protected endpoints require `Authorization: Bearer <access-token>`. The access token is a JWT issued by the auth endpoints and verified with issuer `stox`. Missing credentials produce `401 UNAUTHORIZED`; malformed, expired, or unusable tokens produce `401 INVALID_ACCESS_TOKEN`; a valid token without the required role produces `403 FORBIDDEN`.

`GET /users/:id` is the only endpoint with optional authentication. Without a token it returns the public profile and `isFollowing: null`; with a valid token it can return the caller-specific follow state. All market endpoints and `/api/v1/health` are public.

### Response and error envelopes

Successful responses use `{ "success": true, "data": ... }`. Expected errors use `{ "success": false, "error": { "code", "message", "details?" } }`. Zod validation failures are `400 VALIDATION_ERROR`; `details` is an array of `{ path, message }`. Unknown routes are `404 ROUTE_NOT_FOUND`. Unknown server errors are `500 INTERNAL_SERVER_ERROR` with a generic message. Rate limiting uses `429 RATE_LIMITED`.

### Pagination and dates

Paginated list endpoints use `page` (default `1`) and `limit` (usually default `20`, maximum `100`). Their service result contains a resource array plus a `pagination` object with `page`, `limit`, `total`, and `totalPages` unless noted otherwise. Date filters use a half-open UTC window `[from, to)`. Date-only `to=YYYY-MM-DD` includes that entire UTC day; timestamp bounds must include `Z` or an explicit offset.

### Rate limits

The app applies a global limiter to `/api/*`. Authentication routes also use `authLimiter`; order creation and cancellation use `orderLimiter`. Exact quotas are deployment configuration, so clients should handle `429` rather than assume a fixed number.

### Cross-cutting HTTP behaviour

- **Correlation id.** Every response carries `X-Request-Id`. A well-formed inbound `X-Request-Id` (8–128 chars of `A-Z a-z 0-9 . _ : -`) is reused; anything else is replaced with a generated UUID. The header is exposed through CORS so browser clients can quote it in bug reports.
- **Request size limit.** JSON bodies are limited to `REQUEST_BODY_LIMIT` (default `100kb`). An oversized body returns `413 PAYLOAD_TOO_LARGE`; malformed JSON returns `400 INVALID_JSON`; an unsupported content encoding returns `415 UNSUPPORTED_CONTENT_ENCODING`. All use the standard error envelope.
- **Security headers.** Responses carry Helmet's hardened header set, including `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: SAMEORIGIN`, HSTS, and a CSP of `default-src 'none'; frame-ancestors 'none'`. `X-Powered-By` is never sent. Header injection can be disabled with `SECURITY_HEADERS_ENABLED=false` for diagnostics only.

## Endpoint catalogue

### Health

#### `GET /health`

Public database liveness check. No inputs.

Healthy response (`200`):

```json
{"success":true,"data":{"status":"ok","database":"connected","dbLatencyMs":12,"timestamp":"2026-11-10T08:00:00.000Z"}}
```

If the database query fails, the controller deliberately returns `503` (not the usual error envelope):

```json
{"success":false,"data":{"status":"degraded","database":"unreachable","timestamp":"2026-11-10T08:00:00.000Z"}}
```

### Observability

#### `GET /metrics`

Mounted at the **root** (`/metrics`), not under `/api/v1`. Returns Prometheus text exposition format (`text/plain; version=0.0.4; charset=utf-8`) for scraping. It is not rate limited and returns no JSON envelope.

Exposed series: `http_requests_total`, `http_request_duration_seconds` (histogram), `http_requests_in_flight`, `db_query_duration_seconds`, `db_up`, plus process/runtime gauges (`process_uptime_seconds`, `process_resident_memory_bytes`, `nodejs_heap_used_bytes`, `nodejs_heap_total_bytes`). Labels are low-cardinality: HTTP series use the matched route pattern (for example `/api/v1/orders/:id`) or `unmatched`, never the raw URL.

`METRICS_ENABLED=false` makes the route return `404 ROUTE_NOT_FOUND`. Setting `METRICS_TOKEN` requires `Authorization: Bearer <token>` and returns `401 UNAUTHORIZED` otherwise.

**Production requirement:** the endpoint is enabled by default and only protected when `METRICS_TOKEN` is set. A deployment must either set a strong token (and send it from the Prometheus scrape config) or restrict `/metrics` at the proxy/network layer. It must not be internet-reachable without authentication.

### Authentication

#### `POST /auth/register` — public

Body: `name` (trimmed, 2–100 chars), `email` (trimmed valid email, max 254), and a password meeting the service password-strength policy. Example:

```json
{"name":"Asha Trader","email":"asha@example.com","password":"SecurePass123!"}
```

Returns `201` with `data` containing the created user, `accessToken`, `refreshToken`, and `expiresAt`. Typical service errors are `400 VALIDATION_ERROR`, `409 EMAIL_ALREADY_EXISTS`, and `500` for unexpected persistence/configuration failures.

#### `POST /auth/login` — public

Body: `{ "email": "asha@example.com", "password": "SecurePass123!" }`. Returns `200` with the same token result shape as registration. Invalid credentials are `401 INVALID_CREDENTIALS`; suspended users are rejected by the auth service.

#### `POST /auth/google` — public

Body: `{ "credential": "<Google ID token>" }`. Returns `200` with the normal user/token result. Missing credential is `400 VALIDATION_ERROR`; provider or account-link failures are surfaced as domain errors by the auth service.

#### `POST /auth/refresh` — public

Body: `{ "refreshToken": "<refresh token>" }`. Returns `200` with a refreshed access-token result. Missing, revoked, expired, or invalid refresh tokens return the auth service's `401` domain error.

#### `POST /auth/logout` — public

Body: `{ "refreshToken": "<refresh token>" }`. Returns `200`:

```json
{"success":true,"data":{"loggedOut":true,"tokenRevoked":true}}
```

The `tokenRevoked` flag reflects whether the token existed and was revoked. Body validation still applies.

#### `GET /auth/me` — authenticated

No parameters. Returns `200` as `{ success:true, data:{ user } }`. The user is resolved from the verified token, never from a request-supplied ID.

#### `PATCH /auth/profile` — authenticated

Body must include at least one of `name` (2–100 chars) or `avatarUrl` (valid URL, max 500 chars, or `null`). Example: `{ "name":"Asha S.", "avatarUrl":null }`. Returns `200` with `{ data:{ user } }`. Empty bodies and unknown/invalid fields are `400 VALIDATION_ERROR`.

### Users

#### `GET /users/me/statistics` — authenticated

No parameters. Returns `200` as `{ data:{ statistics } }`, calculated for the caller's user ID.

#### `GET /users/:id` — optional authentication

Path `id` is a UUID. Returns a public social profile under `data.user`, including public identity, follower/following/visible-post counts, and caller follow state when authenticated. Missing or suspended users are `404 USER_NOT_FOUND`.

### Portfolios

All portfolio routes are authenticated and owner-scoped to the token's user ID.

#### `GET /portfolios`

No inputs. Returns `200` as `{ data:{ portfolios:[...] } }`.

#### `POST /portfolios`

Body fields accepted by the controller are `name` and optional `description` (the route currently has no body validator, so service-level rules remain authoritative). Example: `{ "name":"Long-term", "description":"Core holdings" }`. Returns `201` as `{ data:{ portfolio } }`.

#### `GET /portfolios/:portfolioId`

UUID path parameter. Returns `200` as `{ data:{ portfolio } }`; inaccessible/missing portfolios are service domain errors, normally `404 PORTFOLIO_NOT_FOUND`.

#### `PATCH /portfolios/:portfolioId`

Body must contain at least one editable field: `name` (1–100 chars) and/or `description` (trimmed ≤500 chars or `null`). Server-controlled fields (`userId`, balances, `isActive`, etc.) are rejected/stripped by the validator. Returns `200` with the updated portfolio.

#### `DELETE /portfolios/:portfolioId`

UUID path parameter. Deactivates the portfolio and returns `200` as `{ data:{ portfolio } }`; it is not a hard-delete contract.

#### `POST /portfolios/:portfolioId/reactivate`

UUID path parameter. Reverses `DELETE /portfolios/:portfolioId` by setting `isActive` back to `true`; holdings, orders and trades are untouched. Idempotent: reactivating an already-active portfolio returns `200` with the current projection. Returns `200` as `{ data:{ portfolio } }`; inaccessible/missing portfolios are service domain errors, normally `404 PORTFOLIO_NOT_FOUND`. Owner-scoped like every other portfolio route.

#### `GET /portfolios/:portfolioId/holdings`

Returns `200` as `{ data:{ portfolioId:"...", holdings:[...] } }`. Holdings are owner-scoped.

#### `GET /portfolios/:portfolioId/cash-balance`

Returns `200` as `{ data: <cash-balance result> }`; the service result contains the portfolio identity and balance fields. Decimal values are serialized as strings.

#### `GET /portfolios/:portfolioId/summary`

Returns `200` as `{ data:{ portfolio } }`, where `portfolio` is the service's summary projection (including portfolio valuation/P&L fields present in the current service).

### Orders

All order routes are authenticated and owner-scoped.

#### `POST /orders`

Creates a market, limit, stop-loss, or take-profit order. Body:

```json
{"portfolioId":"2d2b6b0d-9e9f-4e4d-a3ce-3a0c2b7e7d20","symbol":"AAPL","assetType":"STOCK","side":"BUY","type":"LIMIT","quantity":"10","limitPrice":"250.50"}
```

`assetType` is `STOCK`, `CRYPTO`, or `FOREX`; `side` is `BUY`/`SELL`; `type` defaults to `MARKET`. Quantity and prices are positive decimal strings (or numbers converted to strings), at most 10 integer digits and 8 decimal places. `MARKET` forbids prices; `LIMIT` requires `limitPrice`; `STOP_LOSS` and `TAKE_PROFIT` require `stopPrice` and forbid `limitPrice`. Returns `201` as `{ data:{ order } }`. Business failures include insufficient cash/position, invalid order state, and non-owner portfolio errors.

Optional `expiresAt` is an ISO-8601 instant with an explicit UTC offset (`Z` or `±HH:MM`) and must be in the future; a value without an offset, an unparseable value, or a past instant is `400 VALIDATION_ERROR`. The worker moves a pending order to `EXPIRED` when `expiresAt <= now`, releases its cash reservation, and records an `EXPIRED` order event. Orders without `expiresAt` never expire. The response includes `expiresAt` (ISO-8601 or `null`).

#### `GET /orders`

Query: `page`, `limit`; optional `status` (single or comma-separated `PENDING|EXECUTED|CANCELLED|EXPIRED|REJECTED`), `symbol`, `side`, `type`, `portfolioId`, `from`, `to`. Example: `/orders?status=PENDING,EXECUTED&symbol=aapl&page=1&limit=20`. Returns `200` with the service list result, normally `{ data:{ orders:[...], pagination:{...} } }`.

#### `GET /orders/:id`

UUID order ID. Returns `200` as `{ data:{ order } }`; an order outside the caller's scope is treated as not found.

#### `GET /orders/:id/events`

UUID order ID. Returns `200` as `{ data:{ events:[...] } }`, the order's lifecycle audit trail in chronological `sequence` order. Each event has `id`, `orderId`, `sequence`, `eventType` (`CREATED|EXECUTED|CANCELLED|EXPIRED|REJECTED`), `previousStatus`, `newStatus`, `metadata`, and `createdAt`. Foreign or missing orders are `404 ORDER_NOT_FOUND`.

#### `DELETE /orders/:id`

UUID order ID. Cancels an eligible pending order and returns `200` as `{ data:{ order } }`. Already executed/terminal orders produce a domain conflict or non-executable error.

There is no mounted `PATCH /orders/:id` route in the current branch, despite older API prose mentioning one.

### Trades

Read-only, authenticated, owner-scoped routes.

#### `GET /trades`

Query: `page`, `limit`, optional uppercase-normalized `symbol`, `side`, `portfolioId`, `from`, `to`, `sort`, and `order`. `sort` is restricted to the service allow-list; `order` is `asc` or `desc`. Default ordering is the service's executed-time descending order. Returns `{ data:{ trades:[...], pagination:{...} } }`.

#### `GET /trades/:id`

UUID trade ID. Returns `200` as `{ data:{ trade } }`; inaccessible IDs are not disclosed.

### Copy trading

All copy-trading routes are authenticated and scoped to the caller as the copier. A relationship is identified by its UUID and is invisible to other users (foreign and missing IDs both return `404 COPY_TRADING_NOT_FOUND`).

#### `GET /copy-trading`

Query: `page` (default `1`), `limit` (1–100, default `20`), optional `isActive=true|false`. Returns `200` as `{ data:{ copyTraders:[...], pagination:{ page, limit, total, totalPages } } }`. Each relationship contains:

```json
{"id":"...","copierId":"...","traderId":"...","trader":{"id":"...","name":"Asha","avatarUrl":null},"copyPortfolioId":"...","copyPortfolio":{"id":"...","name":"Main Portfolio"},"allocationPct":"50","maxTradeSize":"1000","isActive":true,"createdAt":"...","updatedAt":"..."}
```

Decimal values are strings.

#### `POST /copy-trading`

Starts copying another trader. Body:

```json
{"traderId":"<uuid>","allocationPct":"50","maxTradeSize":"1000","copyPortfolioId":"<uuid>","isActive":true}
```

- `traderId` is required and must be an existing, non-suspended user other than the caller.
- `allocationPct` is optional (default `100`) and must satisfy `0 < allocationPct <= 100` with at most 2 decimal places.
- `maxTradeSize` is optional (default `null`) and, when provided, must be greater than zero with at most 8 decimal places. It is a **notional (quote-currency) sizing cap** applied at fan-out using the source trade price. It bounds the copied quantity, not the follower's final executed notional: copied orders are `MARKET` orders and may fill at a different price. A strict execution-notional guarantee is not provided.
- `copyPortfolioId` is optional. When omitted, the copier's default active portfolio is stored. When provided, it must belong to the caller and be active.
- `isActive` is optional (default `true`).

Returns `201` as `{ data:{ copyTrader } }`. Errors include `400 COPY_TRADING_SELF_REFERENCE`, `404 USER_NOT_FOUND`, `400 USER_SUSPENDED`, `404 PORTFOLIO_NOT_FOUND`, `400 PORTFOLIO_INACTIVE`, `400 COPY_TRADING_PORTFOLIO_REQUIRED`, and `409 COPY_TRADING_ALREADY_EXISTS` (the `[copierId, copiedId]` pair is unique, including paused relationships).

#### `PATCH /copy-trading/:id`

UUID path. Strict body with at least one of `allocationPct`, `maxTradeSize`, `copyPortfolioId`, or `isActive`. Send `null` for `maxTradeSize` or `copyPortfolioId` to clear it; a cleared destination falls back to the copier's default active portfolio at fan-out time. Returns `200` as `{ data:{ copyTrader } }`.

#### `DELETE /copy-trading/:id`

UUID path. Stops copying by setting `isActive=false` (a soft delete that preserves history); it is idempotent. Returns `200` as `{ data:{ copyTrader } }`. Re-enable the same relationship with `PATCH { "isActive": true }` rather than creating a duplicate pair.

#### Copy execution semantics

After a source order executes, the backend fans out one market order per active relationship where the source portfolio owner is the copied trader. Fan-out is post-commit, best-effort, and per-follower isolated: one follower's failure never rolls back the source trade or blocks another follower. The copied quantity is `sourceQuantity × allocationPct / 100`, capped by `maxTradeSize / sourcePrice` when a notional cap is set, and rounded down to 8 decimal places. Because the copied order is `MARKET`, the follower's actual fill price can differ from `sourcePrice`; `maxTradeSize` therefore caps the sized quantity, not the final executed notional. Copied orders use `source:"COPY_TRADE"`, are placed in `copyPortfolioId`, and pass through the normal reservation/execution path. A source trade whose own order is already `COPY_TRADE` is not copied again, which prevents copy chains. A durable `(sourceTradeId, copierId)` execution row makes replayed fan-out jobs idempotent; the recovery lookup runs before the retry-budget check so a committed order is never paired with a `FAILED` execution.

### Public market data

All six routes are public and validated, with global rate limiting.

#### `GET /market/search`

Query: required `query` (trimmed 2–50 chars); optional `assetClass=STOCK|CRYPTO`; optional `limit` 1–50 (default 20). Example: `/market/search?query=apple&assetClass=STOCK&limit=20`. Returns `200` with `data` as an array of normalized symbol records: `symbol`, `name`, `assetClass`, `exchange`, `currency`, `type`, `source`. No matches return `data: []`.

#### `GET /market/quote/:symbol`

Crypto pair path, accepted forms include `BTCUSDT`, `BINANCE:BTCUSDT`, and `BTC/USDT`; quote assets are not whitelisted; the provider is the authority for pair existence and trading status. Returns normalized quote data under `data` with `symbol`, `assetClass:"CRYPTO"`, decimal-string price/change/high/low/open/previousClose/volume, `currency`, ISO `timestamp`, and `source`. Invalid format is `400 VALIDATION_ERROR`; unknown pair is `404 MARKET_DATA_NOT_FOUND`.

#### `GET /market/quote/stock/:symbol`

Stock ticker path (letters/digits and `.`/`-`, max 20 chars). Returns the same quote DTO with `assetClass:"STOCK"`; `volume` is currently `null` because Finnhub's quote response does not provide it. Invalid ticker is `400`; unknown symbol is `404 MARKET_DATA_NOT_FOUND`.

#### `GET /market/quotes`

Batch quote read for screens that show many symbols at once. Query: required `symbols`, a comma-separated list of 1–20 symbols (each 1–30 chars, same alphabet as the single-symbol routes). Asset class is inferred per symbol. Returns `200` with `data.quotes` as an array of the same quote DTO used by the single-symbol routes, keyed by the provider-canonical `symbol` (`BTCUSDT` comes back as `BINANCE:BTCUSDT`). A symbol whose provider lookup fails is omitted from the array rather than failing the batch; the caller renders it as unavailable. Missing or empty `symbols`, more than 20 symbols, or an invalid symbol is `400 VALIDATION_ERROR`. Each symbol still goes through the normal quote cache, so repeated symbols across clients do not multiply provider calls.

#### `GET /market/history/:symbol`

Required query: `interval` (`1m|5m|15m|30m|1h|4h|1d|1w|1M`), `from`, and `to` Unix epoch milliseconds. Optional `limit` 1–1000 (default 500) and `assetClass`. The range must be chronological, not future-dated, and fit the requested point limit. Returns:

```json
{"success":true,"data":{"symbol":"AAPL","assetClass":"STOCK","interval":"1d","prices":[{"timestamp":"2026-10-30T00:00:00.000Z","open":"100","high":"105","low":"99","close":"103.5","volume":"1000"}]}}
```

#### `GET /market/overview`

Required `assetClass=STOCK|CRYPTO`; optional `limit` 1–100 (default 10). Returns `data` with `assetClass`, `asOf`, `marketStatus`, `movers`, and `source`. Crypto movers are normalized records; current stock provider behavior can return `movers: null`. Provider timeout/rate-limit/unavailability codes are `MARKET_DATA_TIMEOUT`, `MARKET_DATA_RATE_LIMITED`, and `MARKET_DATA_PROVIDER_UNAVAILABLE`.

### Alerts

Authenticated and owner-scoped.

#### `GET /alerts`

Query: `page`/`limit` (1–100, defaults 1/20), optional `status=ACTIVE|TRIGGERED|EXPIRED|CANCELLED`, optional `symbol`. Returns the service list result, normally `alerts` plus pagination.

#### `POST /alerts`

Body: `symbol`, optional `assetType=STOCK|CRYPTO|FOREX`, `condition=PRICE_ABOVE|PRICE_BELOW|PERCENT_CHANGE_UP|PERCENT_CHANGE_DOWN`, positive `targetPrice` (≤8 decimal places), optional `sendEmail` (default `true`) and `sendPush` (default `false`). Returns `201` as `{ data:{ alert } }`.

The alert object includes `baselinePrice` (decimal string or `null`) and `baselineAt` (ISO-8601 or `null`). For `PERCENT_CHANGE_UP|DOWN`, `targetPrice` is a percentage threshold and the server captures the current quote at creation time as the baseline. If that quote is unavailable the request fails with the corresponding `MARKET_DATA_*` error and no alert is created, so a percentage alert never has an undefined starting point. `PRICE_ABOVE|PRICE_BELOW` alerts keep both baseline fields `null`.

#### `PATCH /alerts/:alertId`

UUID path. Strict body accepts at least one of `condition`, `targetPrice`, `status`, `sendEmail`, `sendPush`. Returns `200` as `{ data:{ alert } }`.

Switching to a `PERCENT_CHANGE_*` condition captures a new baseline; switching away from a percentage condition clears it. Setting `status=ACTIVE` on a non-active percentage alert re-arms it with a fresh baseline.

#### `DELETE /alerts/:alertId`

UUID path. Returns `200` with the service delete result under `data`.

### Social

All mounted social routes require authentication.

#### `GET /social/feed`

Query `page`/`limit` (defaults 1/20, max 100). Returns the feed service result, including posts and pagination.

#### `POST /social/posts`

Body: required trimmed `content` (1–2000 chars), optional normalized `symbol` (≤20 chars), optional JSON `metadata` record. Returns `201` as `{ data:{ post } }`.

#### `GET /social/posts/:postId`

UUID path. Returns `200` as `{ data:{ post } }` with public author data and viewer like state. Hidden/missing posts return `404 POST_NOT_FOUND`.

#### `DELETE /social/posts/:postId`

UUID path. Deletes only the caller's own visible post; missing or another user's post is intentionally the same not-found response. Returns `200` with the service result under `data`.

#### `GET /social/posts/:postId/engagement`

Returns `200` as `{ data:{ engagement } }`, containing like count and caller `hasLiked` state.

#### `POST /social/posts/:postId/likes`

Creates the caller's like. Returns `201` as `{ data:{ engagement } }`; repeated likes are a conflict.

#### `DELETE /social/posts/:postId/likes`

Removes the caller's like. Returns `200` as `{ data:{ engagement } }`.

#### `GET /social/followers` and `GET /social/following`

No inputs. Return `200` as `{ data:{ followers:[...] } }` or `{ data:{ following:[...] } }`.

#### `POST /social/follow/:userId` and `DELETE /social/follow/:userId`

UUID target user. Follow returns `201` as `{ data:{ follow } }`; unfollow returns `200` with the service result. Self-follow, missing users, duplicate follows, and absent relationships are service-level errors.

### Leaderboards

#### `GET /leaderboard`

Authenticated. Query `period=DAILY|WEEKLY|MONTHLY|ALL_TIME` (default `ALL_TIME`), `page` (default 1), and `limit` (1–100, default 20). Returns the leaderboard service result with entries and pagination.

#### `GET /leaderboard/friends`

Same query and response shape, scoped to users followed by the caller.

### Notifications

Authenticated and self-scoped.

#### `GET /notifications`

Query `page`, `limit` (defaults 1/20, max 100), optional `isRead=true|false`. Returns the notification list result with pagination.

#### `PATCH /notifications/:notificationId/read`

UUID path. Marks one caller-owned notification read; returns `200` as `{ data:{ notification } }`.

#### `PATCH /notifications/read-all`

No inputs. Marks all caller notifications read; returns `200` with the service result under `data`.

### User preferences

#### `GET /preferences` — authenticated

No inputs. Creates default preferences on first read if needed. Returns `200` as `{ data:{ preferences:{ id,userId,emailNotifications,pushNotifications,createdAt,updatedAt } } }`.

#### `PATCH /preferences` — authenticated

Strict body; at least one field required. Supported booleans are `emailNotifications` and `pushNotifications`; unknown fields and `{}` are `400 VALIDATION_ERROR`. Returns the same preference envelope as GET.

### Admin

All admin endpoints require a valid JWT whose role is exactly `ADMIN`.

#### `GET /admin/orders`

Cross-user order listing. Query: `page`/`limit`, optional comma-separated `status`, `symbol`, `side`, `type`, `portfolioId`, `userId`, `from`, `to`. Filters combine with AND; newest `createdAt` first with deterministic tie-breaking. Returns `{ data:{ orders:[...], pagination:{...} } }`; order decimals are strings and each order includes selected `portfolio` and owner (`id`, `name`, `email`) projections.

#### `GET /admin/portfolios`

Query: `page` (1–100000), `limit` (1–100), optional `search` (portfolio name/owner name/email), `userId`, and `isActive=true|false`. Returns `{ data:{ portfolios:[...], pagination:{...} } }` with explicit portfolio fields and minimal owner details.

#### `GET /admin/portfolios/:portfolioId`

UUID path. Returns `200` as `{ data:{ portfolio } }`; missing portfolio is `404 PORTFOLIO_NOT_FOUND`.

#### `GET /admin/users`

Query: `page`/`limit`, optional `search`, `role=TRADER|MODERATOR|ADMIN`, `isSuspended=true|false`, and `isVerified=true|false`. Returns `{ data:{ users:[...], pagination:{...} } }`.

#### `GET /admin/users/:userId`

UUID path. Returns `200` as `{ data:{ user } }` with the admin service's selected user projection.

`PATCH /admin/users/:userId/suspend` is mounted and documented in `docs/API.md`. It requires an active ADMIN, accepts `{isSuspended, reason}`, and returns the minimal admin user projection. Analytics, audit-log listing, system-health, report, and market-data admin routes are not mounted. Suspension revokes refresh tokens, blocks protected HTTP requests even for previously issued access tokens, cancels pending orders and releases their reservations, and rejects new socket handshakes. Established socket sessions are not forcibly disconnected. Admin state changes are durably recorded in `AdminAccountAction`.

## Confirmed absent from the current route graph

The following paths appear in older API prose but are not registered under `backend/src/routes/index.js`: user portfolio/trade subroutes; portfolio performance and P&L heatmap; order modification (`PATCH /orders/:id`); market news/orderbook/trades; social user profile route; leagues; achievements; sentiment; and all unmounted admin operations listed above. They should not be used by a Phase 1 client without a route being added and tested.

## Test and implementation confidence

The repository contains integration coverage for auth, portfolios, orders, trades, order events, copy trading, social, alerts, notifications, leaderboards, preferences, market data, validation, and trade execution, plus unit coverage for the main services and validators. Route registration is the source of truth for the catalogue above; examples are realistic request/response shapes assembled from validators and controller envelopes. Where a service's exact internal projection is not visible at the controller boundary (for example holdings and statistics fields), this document intentionally describes the confirmed envelope and labels the nested object as service-defined rather than inventing field names.

