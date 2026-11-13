# ⚡ Real-Time Features

> **Authoritative contract for the implemented Socket.IO and realtime event system.**
>
> Anything in this document that is not implemented is marked **Planned**. The
> HTTP endpoints referenced for state resynchronisation are defined in
> `docs/PHASE1_API_HANDOVER.md`.

---

## 📌 Implementation status

| Area | Status |
| --- | --- |
| Socket.IO server attached to the HTTP server | Implemented (`createSocketServer`) |
| Authenticated `/trading` handshake | Implemented (`src/sockets/auth.js`) |
| `/market` namespace + subscription rooms | Implemented (`src/sockets/marketRooms.js`) |
| `/trading` namespace + portfolio rooms | Implemented (`src/sockets/tradingNamespace.js`) |
| Upstream market WebSocket streaming | Implemented (`src/services/marketStreamService.js`) |
| Polling fallback (`MARKET_STREAM_ENABLED=false`) | Implemented (`src/services/pollingPriceStream.js`) |
| Redis worker → API event bridge | Implemented (`src/realtime/*`) |
| Order, trade, and portfolio trading events | Implemented |
| `/notifications` and `/social` namespaces | **Planned** |
| Order book and trade-tape streams | **Planned** |
| Socket.IO Redis adapter / horizontal room coordination | **Planned** |

---

## 🏠 Namespaces & Rooms

| Namespace | Auth | Purpose |
| --- | --- | --- |
| `/market` | Public | Price updates for watched symbols |
| `/trading` | Required access token | Order, trade, and portfolio events |
| `/notifications` | **Planned** | Personal alerts and notifications |
| `/social` | **Planned** | Social feed updates |

| Room | Pattern | Purpose |
| --- | --- | --- |
| Stock room | `stock:{SYMBOL}` | Sockets watching one market symbol |
| Portfolio room | `portfolio:{portfolioId}` | Sockets allowed to receive that portfolio's trading events |
| User room | `user:{userId}` | **Planned** (notifications) |

Rooms are transport-level grouping only. A predictable room name is **never**
treated as authorisation: `/trading` verifies portfolio ownership before
joining.

---

## 🔐 Socket contract

### Connecting

```javascript
import { io } from "socket.io-client";

const market = io(`${process.env.NEXT_PUBLIC_SOCKET_URL}/market`, {
  transports: ["websocket", "polling"],
});

const trading = io(`${process.env.NEXT_PUBLIC_SOCKET_URL}/trading`, {
  transports: ["websocket", "polling"],
  auth: { token: accessToken },
});
```

`NEXT_PUBLIC_SOCKET_URL` is the backend origin (for example
`http://localhost:8000`), not the `/api/v1` URL.

### Authentication

- `/market` is public; anonymous clients may connect and subscribe.
- `/trading` requires a valid access token, sent as
  `io("/trading", { auth: { token } })` or as
  `Authorization: Bearer <token>` in the handshake headers.
- Handshake failures arrive as `connect_error` with `err.data.code`:
  - `UNAUTHORIZED` — no credentials were supplied.
  - `INVALID_AUTH_HEADER` — malformed `Authorization` header.
  - `INVALID_ACCESS_TOKEN` — invalid or expired token.

Identity comes only from the verified token. Client-supplied user IDs are never
trusted.

### Acknowledgements

Every client event accepts an optional acknowledgement callback. Results are
always an object:

```javascript
socket.emit("join:portfolio", { portfolioId }, (result) => {
  // success: { ok: true, portfolioId }
  // failure: { ok: false, code, message }
});
```

A client that emits without a callback is supported; the server simply does not
reply.

| Namespace | Client event | Payload |
| --- | --- | --- |
| `/market` | `subscribe` | `{ symbol, assetClass? }` or a bare symbol string |
| `/market` | `unsubscribe` | `{ symbol }` or a bare symbol string |
| `/trading` | `join:portfolio` | `{ portfolioId }` (UUID) |
| `/trading` | `leave:portfolio` | `{ portfolioId }` (UUID) |

### Market subscription errors

| Code | Meaning |
| --- | --- |
| `VALIDATION_ERROR` | Missing or malformed symbol |
| `MARKET_DATA_UNAVAILABLE` | The selected asset class has no configured provider (for example stocks without `FINNHUB_API_KEY`) |
| `SUBSCRIPTION_LIMIT_REACHED` | Per-socket or global symbol limit reached (`limit` is included) |
| `RATE_LIMITED` | Too many `subscribe` events in the current window (`retryAfterMs` is included) |

Limits count **distinct** symbols. Repeating an existing subscription is
idempotent and does not create another upstream subscription. Unsubscribing or
disconnecting releases capacity. Defaults (configurable, see
[Operational configuration](#-operational-configuration)):

- 25 distinct symbols per socket.
- 200 distinct symbols per API process.
- 30 `subscribe` events per socket per 10 seconds.

### Symbol and room normalisation

- Symbols are trimmed and uppercased.
- The `BINANCE:` provider prefix is stripped for the internal symbol, so
  `BINANCE:BTCUSDT`, `binance:btcusdt`, and `BTCUSDT` address the same stream
  and the same `stock:BTCUSDT` room.
- Crypto is inferred only for a `BINANCE:`-prefixed symbol or a well-formed
  pair whose base asset is at least two characters (`BTCUSDT`, `ETHBTC`,
  `SOLUSDT`). Ambiguous single tickers such as `GBTC`, `METH`, or `SOL` default
  to stocks, so legitimate stock symbols are never silently routed to Binance.
- Clients may send `{ symbol, assetClass }` to resolve an ambiguous ticker
  explicitly. Omitting `assetClass` uses the inference above.
- There is **no stock allow-list**. `AAPL`/`MSFT` appear in examples, tests,
  and optional seed fixtures only; any Finnhub-recognized stock ticker can be
  subscribed to or ordered through the normal validation path.
- `price-update` payloads carry the internal symbol, not the provider's
  spelling.

### Lifecycle

- `join:portfolio` verifies ownership through `portfolioService`; a foreign or
  missing portfolio returns the same `PORTFOLIO_NOT_FOUND`, so existence is not
  leaked.
- `leave:portfolio` is idempotent and needs no ownership lookup.
- `subscribe` joins the symbol room, replays the last cached price if present,
  and starts one upstream subscription per symbol shared by all watchers.
- The last subscriber leaving or disconnecting releases the upstream
  subscription. A disconnect releases every subscription that socket held.

---

## 📡 Event reference

### `/market` namespace

| Event | Direction | Payload |
| --- | --- | --- |
| `subscribe` | Client → Server | `{ symbol, assetClass? }` (ack: `{ ok, symbol, assetClass }`) |
| `unsubscribe` | Client → Server | `{ symbol }` (ack: `{ ok, symbol }`) |
| `price-update` | Server → Client | `{ symbol, price, volume, timestamp }` |

`price-update` payload:

| Field | Type | Notes |
| --- | --- | --- |
| `symbol` | string | Internal symbol, uppercase, no provider prefix |
| `price` | string | Decimal string; never converted to a JS float |
| `volume` | string \| null | Decimal string when the provider supplies it |
| `timestamp` | string | ISO-8601 timestamp from the provider tick |

`orderbook-update` and `trade-tape` are **not emitted yet**; they require the
Binance depth/trade streams.

### `/trading` namespace

All trading events are room-scoped to `portfolio:{portfolioId}`.

| Event | Direction | Description |
| --- | --- | --- |
| `order-status` | Server → Client | Every order lifecycle transition: `PENDING`, `EXECUTED`, `CANCELLED`, `EXPIRED`, `REJECTED` |
| `trade-executed` | Server → Client | A committed fill |
| `portfolio-update` | Server → Client | Post-fill portfolio valuation |

#### `order-status`

```json
{
  "orderId": "6d0f...",
  "portfolioId": "0f6a...",
  "symbol": "AAPL",
  "side": "BUY",
  "type": "MARKET",
  "status": "EXECUTED",
  "quantity": "2",
  "price": "100",
  "updatedAt": "2026-11-11T10:00:00.000Z"
}
```

- `quantity` and `price` are decimal strings.
- `price` is `null` until the order has an execution price.
- `updatedAt` is generated when the event is published.

#### `trade-executed`

```json
{
  "tradeId": "9b31...",
  "orderId": "6d0f...",
  "portfolioId": "0f6a...",
  "symbol": "AAPL",
  "side": "BUY",
  "quantity": "2",
  "price": "100",
  "totalValue": "200",
  "realizedPnl": null,
  "executedAt": "2026-11-11T10:00:00.000Z"
}
```

- All monetary and quantity values are decimal strings.
- `realizedPnl` is `null` for buys and a decimal string for sells (including
  `"0"`).
- `executedAt` is the database execution timestamp serialised as ISO-8601.

#### `portfolio-update`

```json
{
  "portfolioId": "0f6a...",
  "cashBalance": "9800",
  "holdingsValue": "200",
  "totalValue": "10000",
  "pnl": "0",
  "asOf": "2026-11-11T10:00:01.000Z"
}
```

- `holdingsValue` is the invested cost basis of open positions in Phase 2
  (`Holding.totalInvested`).
- `pnl` is account-level performance against the starting balance.
- `portfolio-update` is supplementary. If its valuation query fails, the
  `order-status` and `trade-executed` events are still published.

---

## 🔄 Delivery semantics and resynchronisation

Realtime events are **notifications, not the authoritative financial record**.

Trading is committed in PostgreSQL first. Publishing to Redis/Socket.IO is
best-effort so a broker outage can never roll back a trade. Consequences:

- A committed trade can succeed while its realtime event is lost.
- A client may see the same event twice after a reconnect or provider retry.
- Events are therefore hints to refresh state, not a ledger.

### Client resynchronisation checklist

After connecting, reconnecting, or detecting a missed event:

1. Rejoin every portfolio room with `join:portfolio`.
2. Re-subscribe to every market symbol.
3. Refresh authoritative state over HTTP:
   - `GET /api/v1/orders` — paginated order history and current statuses.
   - `GET /api/v1/orders/:id` — one order.
   - `GET /api/v1/trades` — committed fills.
   - `GET /api/v1/trades/:id` — one trade.
   - `GET /api/v1/portfolios` and `GET /api/v1/portfolios/:portfolioId`.
   - `GET /api/v1/portfolios/:portfolioId/summary` — cash, holdings value,
     total value.
   - `GET /api/v1/portfolios/:portfolioId/holdings` — current positions.
   - `GET /api/v1/portfolios/:portfolioId/cash-balance` — cash balance.
4. Treat an event whose IDs are already known as an update, not a new record.
   Payload IDs (`orderId`, `tradeId`, `portfolioId`) make de-duplication
   straightforward.

There is intentionally no durable outbox or event sequence number in this
phase. A future phase may add event IDs or version numbers so clients can detect
stale or duplicated updates; until then, HTTP state is the reconciliation
source.

---

## 📡 Market data services

### WebSocket streaming (default)

`src/services/marketStreamService.js` keeps one upstream connection per
provider:

- Finnhub for stocks (requires `FINNHUB_API_KEY`).
- Binance for crypto.

Connections are lazy: nothing opens until the first symbol of that provider is
watched. Symbols are normalised to internal form, and one upstream subscription
is shared by every socket watching the same symbol. A successful reconnect
resubscribes every active symbol.

Reconnection policy:

1. Exponential backoff with bounded jitter (`1s` base, `30s` cap).
2. After the retry budget (10 attempts), the provider is marked `unavailable`
   and enters a 60-second cooldown.
3. After the cooldown it attempts again. The retry budget is reset, so a
   provider that recovers minutes later is not abandoned until restart.
4. `stop()` cancels every pending retry/cooldown timer and closes the socket.

### Polling fallback

Set `MARKET_STREAM_ENABLED=false` to use
`src/services/pollingPriceStream.js`. It exposes the same
`subscribe(symbol, listener)` contract and polls `marketDataService.getQuote`
once per symbol.

The next poll is scheduled **after** the previous request settles. A slow
provider therefore delays the next poll instead of starting overlapping
requests. A response that resolves after `unsubscribe`/`stop` is dropped rather
than broadcast. A failed quote does not stop future polls.

### Provider health and observability

Both implementations expose a `getState()` snapshot for logs or operational
tooling:

```javascript
marketStream.getState();
// {
//   mode: "websocket",
//   running: true,
//   providers: {
//     stock: {
//       enabled: true,
//       state: "connected" | "connecting" | "reconnecting" | "unavailable" | "stopped" | "idle",
//       activeSubscriptions: ["AAPL"],
//       reconnectAttempts: 0,
//       lastConnectedAt: "2026-11-11T10:00:00.000Z",
//       lastUpdateAt: "2026-11-11T10:00:01.000Z",
//       lastError: null
//     },
//     crypto: { /* same shape */ }
//   }
// }

pollingStream.getState();
// {
//   mode: "polling",
//   running: true,
//   intervalMs: 5000,
//   subscriptions: [{
//     symbol, assetClass, intervalMs, listenerCount,
//     inFlight, lastPollStartedAt, lastSuccessAt, lastError
//   }]
// }
```

---

## 🧵 Redis event bus and bridge

Trading events cross process boundaries through Redis Pub/Sub:

```
order API / worker  ──publish──▶  stox:realtime:events  ──subscribe──▶  API bridge  ──▶  Socket.IO rooms
```

- `src/realtime/eventBus.js` is the process-wide bus abstraction. It falls back
  to a no-op when nothing is configured, so the financial path never depends on
  Redis.
- `src/realtime/redisBus.js` gives the API a publisher plus a dedicated
  subscriber connection, and the worker a publisher-only connection.
- The worker publishes after the database transaction commits.
- `src/realtime/realtimeBridge.js` is the only component that knows about
  Socket.IO.

### Startup and reconnection behaviour

- The bridge retries the initial subscriber subscription with exponential
  backoff. A Redis instance that is down while the API boots therefore does not
  permanently disable fan-out.
- The returned bridge handle exists immediately (`bridge.ready` is a promise),
  so shutdown can cancel an in-progress startup.
- Starting the bridge twice for the same Socket.IO server and bus returns the
  same registration; duplicate handlers and duplicate deliveries are prevented.
- On a subscriber reconnect, the channel subscription is restored. The message
  listener is attached exactly once, so reconnecting does not deliver events
  twice.
- `eventBus.connectionState()` reports publisher/subscriber states, whether the
  channel is subscribed, the handler count, the last error, and the last ready
  time. `bridge.getState()` reports `connecting`, `connected`, `reconnecting`,
  or `stopped`, plus attempts and the last error.

### Message validation

The bridge only accepts the implemented contract:

| Namespace | Allowed events |
| --- | --- |
| `/market` | `price-update` |
| `/trading` | `order-status`, `trade-executed`, `portfolio-update` |

Every implemented event is room-scoped. Validation requires a non-empty room
with the namespace's prefix (`stock:` for `/market`, `portfolio:` for
`/trading`). This prevents an accidentally roomless `/trading` message from
broadcasting portfolio data to every authenticated client.

Messages with an unknown namespace/event, a non-object payload, a missing or
mistyped room, invalid numeric fields, or missing required fields are ignored
and logged as `Realtime message rejected` with the reason. Payload contents are
never logged. Validation uses own-property lookup, so prototype keys such as
`constructor` cannot masquerade as event names.

---

## 🛑 Graceful shutdown

`src/server.js` uses `src/serverShutdown.js`, which:

1. Starts closing the HTTP/Socket.IO server so no new connections are accepted
   and connected clients are disconnected.
2. Stops market subscriptions and upstream retry timers.
3. Stops the realtime bridge, cancelling a pending startup and unsubscribing
   from Redis.
4. Waits for the HTTP server to finish closing.
5. Awaits `eventBus.close()` so Redis `quit()` completes.
6. Exits only after cleanup settles.

The handler is idempotent: repeated `SIGINT`/`SIGTERM` signals share the same
shutdown promise and exit once. A failure in one cleanup step is logged and does
not prevent the others or the exit.

---

## 🔌 Scaling notes

The current deployment assumption is a **single API instance for Socket.IO room
coordination**.

- Worker-to-API fan-out already works with multiple API instances: each API
  instance subscribes to the Redis channel and broadcasts the event to its own
  local Socket.IO clients. Every client still receives the event exactly once
  from the instance it is connected to.
- What is **not** implemented is Socket.IO cross-instance room management and
  socket coordination. For example, an API route that emits directly to
  `io.to(room)` only reaches clients connected to that instance.
- Horizontal Socket.IO scaling requires the Socket.IO Redis adapter
  (`@socket.io/redis-adapter`) and deployment configuration. It is not part of
  this phase.
- Each API instance also maintains its own upstream market-data connections. A
  multi-instance deployment needs either a shared market-data service or a
  deliberate restriction to one streaming instance.

---

## ⚙️ Operational configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `REDIS_URL` | `redis://localhost:6379` | Realtime Pub/Sub transport and cache backend |
| `FINNHUB_API_KEY` | unset | Required for stock streaming; without it stock symbols stay dormant |
| `MARKET_STREAM_ENABLED` | `true` | `false` selects the polling fallback |
| `CORS_ORIGIN` | `http://localhost:3000` | HTTP and Socket.IO allowed origin (comma-separated list supported) |
| `ALLOWED_ORIGINS` | unset | Fallback origin list when `CORS_ORIGIN` is unset |
| `JWT_ACCESS_SECRET` | required | Verifies `/trading` handshake tokens |
| `MARKET_MAX_SUBSCRIPTIONS_PER_SOCKET` | `25` | Distinct symbols per `/market` socket |
| `MARKET_MAX_TOTAL_SUBSCRIPTIONS` | `200` | Distinct symbols per API process |
| `MARKET_SUBSCRIPTION_RATE_LIMIT` | `30` | `subscribe` events per socket per window |
| `MARKET_SUBSCRIPTION_RATE_WINDOW_MS` | `10000` | Rate-limit window |

### Degraded behaviour

| Failure | Effect |
| --- | --- |
| Redis unavailable at API startup | HTTP, `/market` local streaming, and `/trading` room joins keep working; trading fan-out is retried in the background until Redis returns |
| Redis unavailable during operation | Realtime events are dropped best-effort; committed trades are unaffected; clients must resynchronise over HTTP |
| Finnhub key missing | Stock subscriptions are rejected with `MARKET_DATA_UNAVAILABLE`; crypto streaming and polling remain available |
| Finnhub/Binance unavailable | The stream retries with backoff, enters cooldown after the retry budget, then tries again; polling fallback can be enabled with `MARKET_STREAM_ENABLED=false` |
| Redis cache unavailable | Price broadcasts keep working; cache reads/writes are skipped with a warning |
