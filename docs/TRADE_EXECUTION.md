# ⚙️ Trade Execution Engine

> **The order execution write path — implemented behaviour, invariants, and known gaps.**

This document describes what the backend actually does when an order executes.
`docs/BACKGROUND_JOBS.md`, `docs/ARCHITECTURE.md`, and `docs/DATABASE.md`
describe the **target** design (BullMQ, Redis, Socket.IO, analytics
publication). Where the shipped code differs, the difference is stated here
explicitly instead of being hidden.

---

## 📌 Table of Contents

- [Status summary](#-status-summary)
- [Where the code lives](#-where-the-code-lives)
- [Execution pipeline](#-execution-pipeline)
- [Trigger evaluation](#-trigger-evaluation)
- [The execution transaction](#-the-execution-transaction)
- [Financial semantics](#-financial-semantics)
- [Error codes](#-error-codes)
- [Pending-order worker](#-pending-order-worker)
- [Execution notifications](#-execution-notifications)
- [Order endpoints and lifecycle](#-order-endpoints-and-lifecycle)
- [Tests](#-tests)
- [Known gaps](#-known-gaps)
- [Gap analysis notes](#-gap-analysis-notes)
- [Related documents](#-related-documents)

---

## ✅ Status summary

Shipped:

- Socket.IO trading events for order status, executed trades, and portfolio
  valuation updates, published through the realtime event bus.
- Redis Pub/Sub bridge between the worker and API processes, with
  best-effort delivery and reconnect-aware subscription.
- Realtime market price streaming through the `/market` namespace, with
  polling fallback when market streaming is disabled.
- Atomic order execution: `order → cash → holding → trade` in one transaction.
- Trigger evaluation for `MARKET`, `LIMIT`, `STOP_LOSS`, `TAKE_PROFIT`.
- Realized P&L on `SELL` (absolute and percentage).
- Concurrency-safe status transition and overdraw/oversell guards.
- Atomic holding writes: concurrent buys and sells cannot overwrite each
  other's quantity, cost basis, or realized P&L.
- Precision-safe cost basis: sells remove `totalInvested × sold / quantity`
  (rounded once to the column scale), so a full close lands exactly on zero
  and partial sales add back to the original invested amount.
- Cash reservations for pending BUY orders (`Order.reservedCash` plus the
  portfolio aggregate `Portfolio.reservedCash`), released on execution,
  cancellation, expiry, and terminal rejection.
- An expiry sweep that also settles overdue rows in inactive portfolios, which
  the execution batch deliberately excludes.
- Inactive portfolios are filtered out of the execution query before the batch
  limit, so their old orders cannot starve active ones.
- Unsupported asset classes (`FOREX`) are rejected before entering the queue.
- Pending-order polling worker (`npm run workers`) with expiry, permanent-error
  rejection, and a bounded retry budget per order.
- Post-commit in-app `ORDER_EXECUTED` notification and copy-trade fan-out.
- Durable copy-trade execution rows with per-follower isolation and bounded
  retries.
- Focused unit and integration suites for advanced orders, expiry, and copy
  trading, plus full-suite coverage.

Not shipped:

- BullMQ dashboard (`@bull-board/express`); failed jobs are inspected through
  `listFailedOrderJobs()` and replayable with `retryFailedOrderJob()`.
- Analytics event publication for downstream analytics consumers.
- Durable realtime event history, replay, or guaranteed delivery.
- Email and push delivery for `ORDER_EXECUTED` (in-app row only).
- `PATCH /orders/:id` (modify) — see
  [Order endpoints and lifecycle](#-order-endpoints-and-lifecycle), short
  selling, and a fee model.
- A dedicated open-orders route (the documented `status` filter covers it).

---

## 📂 Where the code lives

| Concern | File |
| --- | --- |
| `evaluateOrder`, `executeOrder`, BUY/SELL helpers | `backend/src/services/tradeService.js` |
| One polling pass + in-process loop | `backend/src/workers/orderWorker.js` |
| Worker process entrypoint (`npm run workers`) | `backend/src/workers/index.js` |
| Executable asset-class allowlist | `backend/src/utils/assetSupport.js` |
| `ORDER_EXECUTED` notification writer | `backend/src/services/notificationEvents.js` |
| Re-export for API/service consumers | `backend/src/services/notificationService.js` |
| Copy-trade sizing/fan-out/recovery | `backend/src/services/copyTradeService.js` |
| Copy-trade queue + scheduler | `backend/src/queues/copyTradeQueue.js` |
| Copy-trade worker | `backend/src/workers/copyTradeWorker.js` |
| Integration contract tests | `backend/tests/integration/tradeExecution.integration.test.js` |
| Advanced-order tests | `backend/tests/integration/advancedOrders.integration.test.js` |
| Expiry tests | `backend/tests/integration/orderExpiry.integration.test.js` |
| Copy-trade tests | `backend/tests/integration/copyTradeExecution.integration.test.js` |
| Worker contract tests | `backend/tests/integration/orderWorker.integration.test.js` |
| Trigger-condition unit tests | `backend/tests/unit/services/tradeExecution.test.js` |
| Trade serialization unit tests | `backend/tests/unit/services/tradeService.test.js` |

`POST /api/v1/orders` still creates a `PENDING` row and returns immediately.
It does not enqueue anything and does not execute. Execution happens on the
worker's next polling pass, so market orders fill within ~5 seconds while
`npm run workers` is running.

---

## 🔁 Execution pipeline

```text
POST /orders
     │  BUY: reserve quote/limit/stop notional on the portfolio
     ▼
Order row (status = PENDING, reservedCash)
     │
     ▼
expiry sweep (every polling pass / scan)
     │  status = PENDING AND expiresAt <= now
     │  includes inactive portfolios; releases the reservation
     │
     ▼
BullMQ execute-order job (production)   or   processPendingOrders() polling fallback
     │  the execute job loads one order by id; the polling pass queries PENDING rows
     │  query: status = PENDING AND portfolio.isActive = true
     │  (inactive-portfolio orders never enter the execution batch or consume `limit`)
     │
     ├── expiresAt <= now (race guard) ─► status = EXPIRED
     │                                     (provider is never called)
     │
     ├── portfolio deactivated after the query ──► skip (defensive; stays PENDING)
     │
     ├── unsupported asset class ───────► status = REJECTED (no provider call)
     │
     ├── getQuote(symbol, { assetClass })
     │        ├── permanent error ──────► status = REJECTED (no retry)
     │        └── transient error ──────► attempts += 1 (REJECTED at the cap)
     │
     ├── evaluateOrder(order, price) ───► false → skip (stays PENDING)
     │
     └── true
          │
          ▼
     executeOrder(order, price)
          │
          ▼
     BEGIN
       conditional PENDING → EXECUTED
       atomic holding create / merge / decrement
       cash debit / credit
       trade.create (totalValue = quantity × price)
       orderEvent.create (audit trail: PENDING → EXECUTED, sequence locked)
     COMMIT
          │
          ├── success ───────────────────► executed
          ├── INSUFFICIENT_* / INVALID_ORDER ► status = REJECTED (no retry)
          ├── ORDER_NOT_EXECUTABLE ──────► skipped (another worker won)
          └── other error ───────────────► attempts += 1 (REJECTED at the cap)
          │
          ▼
     ORDER_EXECUTED notification (post-commit, best effort)
     copy-trade fan-out job (post-commit, best effort)
```

---

## 🎯 Trigger evaluation

`evaluateOrder(order, currentPrice)` is pure and never throws. Comparisons use
`Prisma.Decimal`, so `0.1 + 0.2` style floating-point drift cannot flip a
fill decision.

| Type | Side | Fills when |
| --- | --- | --- |
| `MARKET` | any | always (any positive price) |
| `LIMIT` | `BUY` | `currentPrice <= limitPrice` |
| `LIMIT` | `SELL` | `currentPrice >= limitPrice` |
| `STOP_LOSS` | any | `currentPrice <= stopPrice` |
| `TAKE_PROFIT` | any | `currentPrice >= stopPrice` |

A missing, non-numeric, zero, or negative trigger price returns `false`: the
order stays `PENDING` rather than throwing inside the polling loop. A
non-positive or unparseable market price also returns `false`. Unknown order
types return `false`.

Conditions are inclusive at the trigger price, matching
`docs/BACKGROUND_JOBS.md`.

---

## 🔒 The execution transaction

`executeOrder(orderOrId, price)` accepts either an order row (as the worker
passes it) or a UUID. It re-reads the order inside the transaction, so a stale
caller copy cannot drive a second execution.

Inside `prisma.$transaction`:

1. **Re-read the order** with its portfolio owner (`portfolio.userId` is needed
   later for the notification and copy-trade fan-out). If `expiresAt <= now`,
   the transaction aborts with `ORDER_EXPIRED`; the order stays `PENDING` and
   the worker's next pass records `EXPIRED`. This closes the race between a
   quote fetched just before the deadline and the execution transaction.
2. **Conditional status transition**
   `updateMany({ where: { id, status: "PENDING" }, data: { status: "EXECUTED",
   executedPrice, executedAt } })`. Zero rows matched means
   `ORDER_NOT_EXECUTABLE` and the transaction aborts.
3. **Holding write — one atomic statement per side.**
   - `BUY`: `INSERT ... ON CONFLICT ("portfolioId", "symbol") DO UPDATE`
     computes quantity, invested amount, and weighted average from the row's
     **current** values. Concurrent buys and first-time-holding races cannot
     base their totals on the same stale snapshot.
   - `SELL`: `SELECT ... WHERE quantity >= sold FOR UPDATE` locks the row and
     returns its current `quantity` and `totalInvested`. The removed basis is
     `totalInvested × sold / quantity`, rounded once to 8 decimal places; a
     full close uses `totalInvested` itself. Zero rows means
     `INSUFFICIENT_POSITION`.
4. **Cash movement** for `BUY`. The portfolio row was locked in step 1, so the
   service computes `available = cashBalance − reservedCash` and
   `additionalRequired = max(totalValue − order.reservedCash, 0)`. If
   `available < additionalRequired` it throws `INSUFFICIENT_BALANCE`; otherwise
   the same `portfolio.update` decrements `cashBalance` by `totalValue` and
   `reservedCash` by this order's reservation. The order's `reservedCash` is
   then set to zero. A `SELL` credits cash and never touches reservations.
5. **`trade.create`** with `totalValue = quantity × price`, `fees = 0`, and
   realized P&L for sells.
6. **`orderEvent.create`** (audit trail) recording `PENDING → EXECUTED` with
   causally monotonic sequence numbers per order (allocated via `SELECT FOR UPDATE`
   on the latest order event) and execution metadata (`tradeId`, `executionPrice`,
   `quantity`, `totalValue`, `realizedPnl`, `fees`).

Holding is written before cash so every execution takes locks in the same
order (`holding → portfolio`). A `BUY` and a `SELL` on the same symbol
therefore cannot deadlock against each other. If the cash guard fails after a
buy's holding write, the whole transaction rolls back and the holding
contribution disappears with it.

### Why the conditions live inside the `UPDATE`

A read-check-then-write sequence has a race window: two workers can both read
`PENDING`, both see enough cash, and both write. PostgreSQL's default
`READ COMMITTED` re-evaluates an `UPDATE` predicate after it acquires the row
lock, so the loser matches zero rows and aborts cleanly. This is why the
service does not rely on a `findUnique` + `if` guard for the critical
invariants.

The same principle applies to the holding. An earlier version read the
holding into application code, calculated absolute totals, and wrote them
back. Two buys for the same symbol could both read the same snapshot, both
debit cash successfully, and the last write silently discarded the other
fill. The current implementation lets PostgreSQL perform the read and write in
one statement, so the row lock and the current values are guaranteed to refer
to the same version.

Concurrency tests cover:

- the same order executed twice (exactly one `EXECUTED`, one trade),
- two different buys against one holding (both fills survive),
- two first-time buys with no holding row (the unique constraint resolves the
  insert race),
- two sells against one cost basis,
- a buy and a sell interleaving without losing quantity or cash,
- a buy that loses the cash race (its holding contribution rolls back).

---

## 💰 Financial semantics

All amounts are `Decimal(18, 8)` end to end. No `Number()` casts are used in
the execution path.

### BUY

- Cash: `cashBalance -= quantity × price`.
- No existing holding: create with
  `quantity`, `averageBuyPrice = price`, `totalInvested = quantity × price`,
  `isShort = false`.
- Existing holding:
  `totalInvested += quantity × price`,
  `quantity += quantity`,
  `averageBuyPrice = totalInvested / quantity` (weighted average),
  `isShort = false`.

### SELL

- Requires `holding.quantity >= order.quantity`; otherwise
  `INSUFFICIENT_POSITION`.
- Cash: `cashBalance += quantity × price`.
- Holding: `quantity -= quantity`, and the removed cost basis is proportional
  to the **stored total invested**, not the rounded average:
  - `exactRemaining = totalInvested × (quantity − sold) / quantity`
  - `newTotalInvested = round(exactRemaining, 8)` (the column scale)
  - `removedCostBasis = totalInvested − newTotalInvested`
  - a **full close** sets `quantity = 0` and `totalInvested = 0` explicitly,
    so a repeating average such as `3.02 / 3 = 1.00666667` cannot leave a
    `-0.00000001` residual.
  - `averageBuyPrice` is unchanged.
- Realized P&L uses the same basis that is actually removed:
  - `realizedPnl = quantity × price − removedCostBasis`
  - `realizedPnlPct = realizedPnl / removedCostBasis × 100`
    (`null` when the removed basis is zero)
- Because every partial sale stores `totalInvested − removedCostBasis`, the
  removed amounts from successive sales plus the final remainder add back to
  the original invested amount exactly at 8 decimal places.
- A **full close leaves the holding row at `quantity = 0`,
  `totalInvested = 0`** with the original `averageBuyPrice` and the trade
  history intact. The row is not deleted: `portfolioService` computes portfolio
  value as `cash + sum(totalInvested)`, so a zero row contributes nothing, and
  auditability is preserved.

### Both sides

- `fees` is written as `0`. No fee model exists in the schema, validators, or
  environment configuration yet.
- `Trade.orderId` is `@unique`, so the database itself rejects a second trade
  for one order even if application logic were bypassed.
- `Trade.executedAt` and `Order.executedAt` are the same timestamp.

---

## ❌ Error codes

Thrown as `AppError`, so `src/middleware/errorHandler.js` owns the envelope.

| Code | Status | When |
| --- | --- | --- |
| `INVALID_ORDER` | 400 | Caller passed no order or an invalid side |
| `INVALID_EXECUTION_PRICE` | 400 | Price is missing, unparseable, zero, or negative |
| `ORDER_NOT_FOUND` | 404 | Order id does not exist |
| `ORDER_NOT_EXECUTABLE` | 400 | Order is not `PENDING` (cancelled, expired, already executed, rejected, or lost a race) |
| `ORDER_EXPIRED` | 400 | Execution reached the transaction after `expiresAt`; the worker records `EXPIRED` |
| `INVALID_EXPIRES_AT` | 400 | `expiresAt` is unparseable or not in the future at the service boundary |
| `INSUFFICIENT_BALANCE` | 400 | Available (unreserved) cash is below the amount this fill needs beyond its own reservation |
| `INSUFFICIENT_POSITION` | 400 | No holding, or `holding.quantity < quantity` on a sell |
| `UNSUPPORTED_ASSET_TYPE` | 400 | `POST /orders` asked for an asset class the pipeline cannot price (`FOREX`) |
| `PORTFOLIO_NOT_FOUND` | 404 | Portfolio row disappeared mid-transaction |

`details` on `INSUFFICIENT_BALANCE` includes `required` and `available` as
decimal strings.

`UNSUPPORTED_ASSET_TYPE` is returned by `POST /api/v1/orders`. The remaining
codes exist only inside the execution engine and worker today; no HTTP route
returns them until an execution trigger, modify endpoint, or manual execution
endpoint is added.

---

## 👷 Pending-order worker

### `processPendingOrders(options)`

One polling pass, transport-agnostic. Options:

| Option | Default | Purpose |
| --- | --- | --- |
| `quoteProvider` | `services/marketData` | Object exposing `getQuote(symbol, { assetClass })` |
| `now` | `new Date()` | Clock, injectable for expiry tests |
| `limit` | `100` | Batch size |
| `maxAttempts` | `5` | Transient-failure budget before an order is rejected |
| `portfolioId` | — | Restrict the pass to one portfolio (tests, admin tooling) |

Query: `status = PENDING AND portfolio.isActive = true`, ordered by
`createdAt asc, id asc` for deterministic FIFO processing. Inactive portfolios
are excluded **before** `take`, so their old rows never occupy a batch slot.
The post-fetch `isActive` check remains as a defensive guard for a portfolio
that is deactivated between the query and the loop body.

Summary counters: `scanned`, `executed`, `skipped`, `expired`, `rejected`,
`failed`. A per-order failure never aborts the batch — one unavailable symbol
must not block the rest.

In BullMQ mode this function is used only by the polling fallback. The queue's
`scan-pending` job calls `discoverPendingOrders()` and enqueues one
`execute-order` job per row instead of executing anything itself.

### Outcome rules

| Situation | Order status | Counter |
| --- | --- | --- |
| `expiresAt <= now` | `EXPIRED` (conditional, so a concurrent cancel wins) | `expired` |
| Overdue order in an inactive portfolio | `EXPIRED` by the sweep, reservation released | `expired` |
| Inactive portfolio, not overdue | excluded from the execution query, never fetched | not counted |
| Portfolio deactivated between query and loop | unchanged (defensive) | `skipped` |
| Unsupported `assetType` (e.g. `FOREX`) | `REJECTED`, provider not called | `rejected` |
| Provider returns a permanent error (400/404/422, unsupported class, not found) | `REJECTED`, no retry | `rejected` |
| Provider returns a transient error (timeout, rate limit, 5xx, credentials) | unchanged until the retry cap | `failed` |
| Transient failure reaches `maxAttempts` | `REJECTED` | `rejected` |
| Quote missing or trigger unmet | unchanged | `skipped` |
| `executeOrder` succeeds | `EXECUTED` | `executed` |
| `INSUFFICIENT_*` / `INVALID_ORDER` | `REJECTED`, no retry | `rejected` |
| `ORDER_NOT_EXECUTABLE` / `ORDER_NOT_FOUND` | unchanged | `skipped` |
| Anything else | unchanged until the retry cap | `failed` |

Terminal failures become `REJECTED` deliberately: retrying an unfundable order
every 5 seconds forever would only hide the problem. Transient failures leave
the order `PENDING` so the next pass retries, but each attempt increments
`executionAttempts` (`lastExecutionAttemptAt` records the time). Once the
budget is spent the order is rejected, so a permanently failing row cannot
occupy the oldest-first queue and starve newer valid orders. The
`executionAttempts >= maxAttempts` condition lives in the rejection `UPDATE`,
so two workers cannot reject an order another one just executed.

### Running it

```bash
cd backend
npm run workers        # node src/workers/index.js
```

`startOrderWorker({ intervalMs = 5000, ...processOptions })` runs `run()` once
immediately, then on an interval. Ticks never overlap: a slow provider call
delays the next pass instead of stacking a second one. `SIGINT`/`SIGTERM` stop
the loop.

BullMQ is the production transport. `src/queues/` defines the queue registry,
retry policies, and the orders job contracts. `src/workers/orderQueueWorker.js`
consumes `execute-order` jobs and calls the same `processOrder` processor used
by the polling loop. The repeatable `scan-pending` job is a discovery/enqueue
mechanism only: it finds eligible `PENDING` orders and enqueues one
`execute-order` job per order (`jobId = orderId`), so the direct job from
`POST /orders` and the periodic scan cannot process the same order in parallel.
Completed `execute-order` jobs are removed so a resting order can be enqueued
again on a later scan; failed jobs remain inspectable. `QUEUES_ENABLED=false`
selects the polling loop for local development. The notification and alert
queues are registered but their workers are still pending.

### Behavioural caveats

- Deactivating a portfolio does not cancel its non-expiring `PENDING` orders.
  The execution batch skips inactive portfolios, so those rows stay `PENDING`
  with `reservedCash` held until the owner cancels them or gives them an
  `expiresAt`. Overdue orders are settled by the expiry sweep regardless of
  portfolio activity, so an expiry is not stranded by deactivation. The
  remaining lifecycle gap is tracked in
  [`docs/BACKGROUND_JOBS.md`](./BACKGROUND_JOBS.md#known-gaps-and-follow-ups).
- BUY orders reserve cash at placement: the market quote for `MARKET`, the
  limit price for `LIMIT`, and the stop price for `STOP_LOSS`/`TAKE_PROFIT`.
  The reservation is held on `Order.reservedCash` and aggregated on
  `Portfolio.reservedCash`. A fill consumes its own reservation; a fill above
  the reservation needs additional unreserved cash. SELL orders reserve
  nothing (positions are checked at execution). Two pending buys therefore
  cannot spend the same reserved cash, though a buy can still be rejected if
  the price gaps above its reservation and the remaining cash is insufficient.
- `expiresAt` is compared against the process clock. The sweep moves overdue
  orders to `EXPIRED` and releases the reservation; the execution transaction
  repeats the check so a quote fetched before the deadline cannot fill after
  it. Orders without `expiresAt` never expire.
- Only `STOCK` (Finnhub) and `CRYPTO` (Binance) providers are wired. `FOREX`
  orders are rejected at `POST /orders` with `UNSUPPORTED_ASSET_TYPE`, before a
  `PENDING` row exists. The worker also rejects any legacy `FOREX` row without
  calling a provider. Adding FOREX end to end means adding a provider and
  extending `src/utils/assetSupport.js`.
- Inactive portfolios are excluded from the execution query, so their
  non-expiring orders are not automatically executed or expired. Overdue rows
  are still settled by the separate expiry sweep, which prevents their cash
  reservations from being stranded. This split preserves the starvation guard
  while making expiry correct.
- The worker process is separate from the API process. If it is not running,
  orders never leave `PENDING`.

---

## 🔔 Execution notifications

After the transaction commits, `createOrderExecutedNotification` inserts one
`Notification` row:

| Field | Value |
| --- | --- |
| `type` | `ORDER_EXECUTED` |
| `title` | `Order executed` |
| `message` | e.g. `BUY 2 AAPL executed at 100.` |
| `data` | `orderId`, `tradeId`, `symbol`, `side`, `quantity`, `price`, `totalValue` (decimal strings) |
| `isRead` | `false` |

Two rules:

1. **Post-commit only.** A notification must never roll back a committed trade.
2. **Best effort.** Failures are logged with `logger.warn` and swallowed; the
   trade still returns successfully.

The writer lives in `notificationEvents.js` rather than
`notificationService.js` because the latter imports `authService`, which throws
at require time when `JWT_*` secrets are missing. Keeping execution decoupled
from auth startup validation keeps the engine usable in worker/test contexts.

No email or push is sent, and user preferences (`emailAlerts`,
`pushEnabled`) are not consulted yet — those belong to the notification
worker described in `docs/NOTIFICATIONS.md`.

The in-app `ORDER_EXECUTED` notification is still persisted as a database
row and is retrieved through the notifications API. Separately, the trading
realtime pipeline publishes `order-status`, `trade-executed`, and
`portfolio-update` events to the portfolio's Socket.IO room after execution.

These are separate mechanisms: the realtime trading events do not replace
the persisted notification row, and the notification row is not itself
broadcast as a Socket.IO notification event.

---

## 🔄 Copy-trade execution

After a source trade commits, `executeOrder` enqueues a `fan-out-copy-trades`
job on the `copy-trades` queue. The job is post-commit and best-effort: a Redis
or follower failure never rolls back the source trade.

The fan-out:

1. Loads the source trade with its order and source-portfolio owner.
2. Refuses to copy a trade whose own order source is `COPY_TRADE`, preventing
   copy chains and feedback loops.
3. Pages through active `CopyTrader` rows where `copiedId` is the source user.
4. For each follower, creates or loads a durable `CopyTradeExecution` row
   uniquely keyed by `(sourceTradeId, copierId)`.
5. Sizes the order as
   `sourceQuantity × allocationPct / 100`, capped by
   `maxTradeSize / sourcePrice` when a notional cap is configured, rounded down
   to 8 decimal places.
6. Places a `MARKET` order through `orderService.createOrder` with
   `source: "COPY_TRADE"`, the copier as owner, and `copyPortfolioId` (or the
   copier's default active portfolio) as the destination. Balance, position,
   reservation, and ownership checks are therefore the normal order checks.
7. Records `PLACED`, `FAILED`, or `SKIPPED` on the execution row. Permanent
   failures (insufficient balance/position, inactive portfolio, unsupported
   asset class) are terminal for that follower; transient failures stay
   `PENDING` and are retried up to the attempt budget.

The copied order carries a unique `Order.copyTradeExecutionId`. If the order
commits but the execution update does not, a replay finds the existing order
instead of placing a second one. `orderService.createOrder` also fast-paths an
existing `copyTradeExecutionId`, so a retry does not call the quote provider or
re-reserve cash.

Follower failures are isolated: the loop continues after a failure, and the
job only fails (for BullMQ retry) when at least one follower has a retryable
failure. A completed pass sets `Trade.copyFanOutAt`; the periodic
`copy-trades:scan-pending` job re-enqueues trades whose marker is still null,
recovering an enqueue lost during a Redis outage. A trade with no followers is
still marked, so the scan is finite.

Integration coverage lives in
`tests/integration/copyTradeExecution.integration.test.js`; the configuration
API is covered by `tests/integration/copyTradingConfig.integration.test.js`.

## 🧾 Order endpoints and lifecycle

`PENDING` is the only non-terminal order status. `EXECUTED`, `CANCELLED`,
`EXPIRED`, and `REJECTED` are final, so an order that leaves `PENDING` can
never execute afterwards.

| Method | Path | Controller | Status |
| --- | --- | --- | --- |
| `POST` | `/api/v1/orders` | `createOrder` | Implemented — validates, reserves cash, and stores `PENDING` with optional `expiresAt`; the worker executes |
| `GET` | `/api/v1/orders` | `listOrders` | Implemented — order history and open orders |
| `GET` | `/api/v1/orders/:id` | `getOrder` | Implemented |
| `GET` | `/api/v1/orders/:id/events` | `getOrderEvents` | Implemented — chronological order-event audit trail |
| `DELETE` | `/api/v1/orders/:id` | `cancelOrder` | Implemented — conditional `PENDING → CANCELLED` |
| `PATCH` | `/api/v1/orders/:id` | — | **Not implemented** (documented in `docs/API.md`; see below) |

### Order-event audit trail

Every order lifecycle transition persists a row to `OrderEvent` within the exact same database transaction that alters order status:

- **Order creation:** Persists `CREATED` with `sequence: 1`, `previousStatus: null`, `newStatus: "PENDING"`.
- **Order execution:** Persists `EXECUTED` with `previousStatus: "PENDING"`, `newStatus: "EXECUTED"`, and trade metadata.
- **Order cancellation:** Persists `CANCELLED` with `previousStatus: "PENDING"`, `newStatus: "CANCELLED"`.
- **Worker expiration:** Persists `EXPIRED` with `previousStatus: "PENDING"`, `newStatus: "EXPIRED"`.
- **Worker rejection:** Persists `REJECTED` with `previousStatus: "PENDING"`, `newStatus: "REJECTED"`, and rejection reason.

Sequence numbers are protected against concurrent writers via row-level locks on the latest event (`SELECT ... FOR UPDATE`) and database-level `@@unique([orderId, sequence])` constraint. Retrievals via `GET /api/v1/orders/:id/events` are scoped strictly to the authenticated order owner.

### Open orders

Open orders are `PENDING` orders. There is no dedicated `GET /orders/open`
route and none is defined in `docs/API.md`; the project expresses the same
capability through the list endpoint's `status` filter:

```http
GET /api/v1/orders?status=PENDING
GET /api/v1/orders?status=PENDING&symbol=AAPL&limit=50
GET /api/v1/orders?status=PENDING,EXECUTED
```

How it is built:

1. **Route** — `orderRoutes.js` validates the query with
   `listOrdersQuerySchema` into `req.validatedQuery`.
2. **Validator** — `orderValidator.statusFilter` splits a comma-separated
   value, trims, uppercases, checks each segment against `OrderStatus`, and
   deduplicates. A single value (`PENDING`) and a list (`PENDING,EXECUTED`)
   both reach the service as an array.
3. **Service** — `orderService.listOrders` applies
   `where.status = { in: status }` and always scopes the query through
   `portfolio.userId`, so a foreign `portfolioId` yields an empty page, never
   another user's orders.
4. **Response** — `{ orders, pagination }`, where `pagination` is
   `{ page, limit, total, totalPages }`; newest first (`createdAt desc`),
   Decimal fields as strings.

The filter composes with `symbol`, `side`, `type`, `portfolioId`, and the
`from`/`to` window, so "open orders in one portfolio" or "open AAPL orders"
need no new endpoint.

Tests: `tests/integration/orderValidation.integration.test.js` —
`status=PENDING` returns only pending orders (`:868`), pagination under the
filter (`:885`), multi-status list (`:911`), unknown query params stripped
(`:925`). The seeder prints the same URL as its "try it" hint.

### Modify order (`PATCH /orders/:id`) — planned

`docs/API.md` lists `PATCH /orders/:id` as "Modify an eligible pending order".
It is **not routed**: `orderRoutes.js` mounts only `POST /`, `GET /`,
`GET /:id`, and `DELETE /:id`, so a `PATCH` request falls through to the
app-level not-found handler and returns HTTP 404 with code `ROUTE_NOT_FOUND`.

Nothing exists for modify — no validator, controller, service function, or
test. To add it consistently with the rest of the order domain:

- **Allowed fields** should be the pending order's adjustable inputs:
  `quantity` plus the trigger price that belongs to its type (`limitPrice` for
  `LIMIT`, `stopPrice` for `STOP_LOSS` / `TAKE_PROFIT`), and optionally
  `expiresAt`. Reuse the type-conditional rules in `orderValidator.js`; a
  `MARKET` order has nothing to modify, and mismatched fields (for example
  `limitPrice` on a stop order) must be rejected exactly as at creation.
- **Ownership and eligibility** follow `cancelOrder`: owner-scoped lookup,
  404 `ORDER_NOT_FOUND` for missing or foreign orders, and a `400` domain code
  for orders that are no longer `PENDING`.
- **Concurrency** must reuse the conditional-write pattern from cancellation:
  `updateMany({ where: { id, status: "PENDING" }, data: ... })` plus a re-read
  when zero rows match, so a modify can never overwrite an order that the
  worker executed (or the user cancelled) between read and write.
- **No financial side effects.** Pending orders reserve nothing (see
  [Behavioural caveats](#behavioural-caveats)), so changing quantity or a
  trigger price touches neither cash nor holdings. If reservation is added
  later, modify has to adjust the reserved amount in the same transaction.
- **Tests** should mirror the cancel suite: 401, 400 validation per type,
  404 foreign/missing, non-pending rejection, success plus read-back, and a
  unit race test with a mocked Prisma boundary like
  `tests/unit/services/orderService.test.js`.

---

## 🧪 Tests

```bash
cd backend
npx jest --runInBand tests/unit/services/tradeExecution.test.js
npx jest --runInBand tests/integration/tradeExecution.integration.test.js
npx jest --runInBand tests/integration/orderWorker.integration.test.js
npm test -- --runInBand          # full suite
```

Coverage:

- **Trigger/unit** — truth table for every order type and side, inclusive
  boundaries, missing trigger prices, `MARKET` at any positive price, Decimal
  precision; trade serialization keeps zero realized P&L as `"0"` and buys as
  `null`.
- **Execution integration** — buy debit + trade + holding; weighted average
  add-on; overdraw rollback; partial sell with realized P&L; oversell
  rollback; full close; non-pending rejection; missing order; invalid price;
  notification payload; concurrent executions; concurrent buys/sells; a buy
  that loses the cash race; FOREX rejected at placement; telescoping cost
  basis.
- **Worker integration** — market fill; unmet limit; expiry; unfundable
  rejection; provider failure; inactive-portfolio exclusion and expiry sweep;
  FOREX rejection; permanent vs transient provider errors; retry cap;
  starvation guard.
- **Advanced orders** (`advancedOrders.integration.test.js`) — take-profit,
  stop-loss, and limit boundaries; price gaps through the trigger; duplicate
  processing; unfundable trigger rejection; cancellation for every advanced
  type; reservation release; lifecycle events.
- **Expiry** (`orderExpiry.integration.test.js`) — `expiresAt` API validation
  and persistence; exact-boundary expiry; inactive-portfolio sweep;
  idempotent sweep; concurrent cancel/expiry and execute/expiry races.
- **Copy trading** (`copyTradingConfig.integration.test.js`,
  `copyTradeExecution.integration.test.js`) — configuration CRUD, ownership,
  duplicate/self/unknown-user/bounds validation; sizing, notional cap,
  rounding, destination fallback; per-follower isolation; retry budget;
  duplicate replay; chain prevention; recovery-scan marker.

The worker suites inject a fake quote provider, so no test calls Finnhub or
Binance. Integration tests use the local PostgreSQL database from
`backend/.env`, create their own user/portfolio rows, and clean up through the
user cascade in `afterAll`.

Last verified: `131 suites, 1612 tests passed` on the full backend suite.

---

## 🚧 Known gaps

| Area | Gap | Impact |
| --- | --- | --- |
| Queues | Order, notification, alert, and copy-trade queues are implemented | Async work is retried through BullMQ; polling remains the local fallback for orders |
| Asset classes | `FOREX` exists in the enum but has no market-data provider | FOREX orders are rejected at placement; only `STOCK` and `CRYPTO` execute |
| Transport | BullMQ is the default; the in-process `setInterval` loop is a `QUEUES_ENABLED=false` fallback | Execution continues in the worker process; a stopped worker means no fills |
| Analytics | No analytics event publication on execution | Analytics consumers see trades through database reads |
| Realtime delivery | Redis Pub/Sub is best-effort and has no durable replay | Events can be missed during disconnection; clients must resynchronise from the API/database |
| Notifications | In-app row plus Resend email and FCM push, gated by preferences | Providers are no-ops until their credentials are configured |
| Modify order | `PATCH /orders/:id` is documented but not routed (see [Order endpoints and lifecycle](#-order-endpoints-and-lifecycle)) | Pending orders can only be created or cancelled |
| Short selling | `isShort` is always written `false`; sells require a long position | No short positions despite `docs/FEATURES.md` |
| Fees | `Trade.fees` is always `0` | No fee/commission modelling |
| Open orders | No `GET /orders/open` route | Intentional: `GET /orders?status=PENDING` is the documented equivalent (see [Order endpoints and lifecycle](#-order-endpoints-and-lifecycle)) |
| Manual execution | No API/admin endpoint calls `executeOrder` | Execution only happens through the worker poll |
| Reservation | Pending BUY orders reserve cash; SELL orders reserve no shares | A fill above its reservation can still be rejected if unreserved cash is insufficient |
| Copy trading | Copied orders are always `MARKET`; partial fills are not modelled | Limit/stop mirroring and partial fills would need a larger execution model |

---

## 🧭 Gap analysis notes

The write path was audited before implementation. The original state:

- `tradeService` exposed only reads (`getTrade`, `listTrades`); no
  `trade.create` call existed anywhere in `src/`.
- `orderWorker.js`, `queues/*.js`, and `workers/index.js` were empty.
- Cash and holdings were never written by application code; only the seeder
  produced trades and realized P&L.
- As a result, `PENDING` orders could only ever become `CANCELLED` or
  `EXPIRED`; every downstream consumer of trades (win/loss stats, average
  trade return, best/worst trade, leaderboard period returns) was starved.

That gap is now closed by the components listed in
[Where the code lives](#-where-the-code-lives).

The second audited item, "open-orders API", needs no implementation:
`docs/API.md` defines no `GET /orders/open` endpoint, and
`GET /orders?status=PENDING` already provides ownership-scoped, paginated,
tested access to open orders (`orderValidation.integration.test.js`). The
seeder's own closing hint points users at that URL. Adding a dedicated route
would extend the contract beyond the docs.

---

## 🔗 Related documents

- `docs/ARCHITECTURE.md` — target order-execution flow and the financial
  consistency invariant.
- `docs/BACKGROUND_JOBS.md` — BullMQ queue names, job contracts, retry policies.
- `docs/API.md` — order and trade contracts, error categories.
- `docs/DATABASE.md` — `Order`, `Holding`, `Trade`, `Notification` models.
- `docs/NOTIFICATIONS.md` — target notification pipeline and channels.
- `docs/ERROR_HANDLING.md` — `AppError` and the centralized envelope.
