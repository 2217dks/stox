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

- Atomic order execution: `order → cash → holding → trade` in one transaction.
- Trigger evaluation for `MARKET`, `LIMIT`, `STOP_LOSS`, `TAKE_PROFIT`.
- Realized P&L on `SELL` (absolute and percentage).
- Concurrency-safe status transition and overdraw/oversell guards.
- Atomic holding writes: concurrent buys and sells cannot overwrite each
  other's quantity, cost basis, or realized P&L.
- Precision-safe cost basis: sells remove `totalInvested × sold / quantity`
  (rounded once to the column scale), so a full close lands exactly on zero
  and partial sales add back to the original invested amount.
- Inactive portfolios are filtered out of the worker's query before the batch
  limit, so their old orders cannot starve active ones.
- Unsupported asset classes (`FOREX`) are rejected before entering the queue.
- Pending-order polling worker (`npm run workers`) with expiry, permanent-error
  rejection, and a bounded retry budget per order.
- Post-commit in-app `ORDER_EXECUTED` notification.
- 41 focused tests (10 unit, 31 integration) plus full-suite coverage.

Not shipped:

- BullMQ/Redis queues, retries, persistence, dashboard, repeatable jobs.
- Socket.IO / analytics event publication.
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
| Integration contract tests | `backend/tests/integration/tradeExecution.integration.test.js` |
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
     │
     ▼
Order row (status = PENDING)
     │
     ▼
orderWorker.processPendingOrders()      every 5s (DEFAULT_INTERVAL_MS)
     │  query: status = PENDING AND portfolio.isActive = true
     │  (inactive-portfolio orders never enter the batch or consume `limit`)
     │
     ├── expiresAt <= now ──────────────► status = EXPIRED
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
     COMMIT
          │
          ├── success ───────────────────► executed
          ├── INSUFFICIENT_* / INVALID_ORDER ► status = REJECTED (no retry)
          ├── ORDER_NOT_EXECUTABLE ──────► skipped (another worker won)
          └── other error ───────────────► attempts += 1 (REJECTED at the cap)
          │
          ▼
     ORDER_EXECUTED notification (post-commit, best effort)
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
   later for the notification).
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
4. **Cash movement** with the balance condition inside the `UPDATE`:
   `updateMany({ where: { id, cashBalance: { gte: totalValue } },
   data: { cashBalance: { decrement: totalValue } } })` for `BUY`.
   Zero rows matched means `INSUFFICIENT_BALANCE`.
5. **`trade.create`** with `totalValue = quantity × price`, `fees = 0`, and
   realized P&L for sells.

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
| `INSUFFICIENT_BALANCE` | 400 | `cashBalance < quantity × price` on a buy |
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

### Outcome rules

| Situation | Order status | Counter |
| --- | --- | --- |
| `expiresAt <= now` | `EXPIRED` (conditional, so a concurrent cancel wins) | `expired` |
| Inactive portfolio | excluded from the query, never fetched | not counted |
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

There is **no BullMQ transport**. `src/queues/*.js` and
`src/workers/{alert,notification}Worker.js` are still empty. Because
`processPendingOrders` takes its quote provider and clock as options, a BullMQ
`Worker` can wrap the same function later without changing execution logic.

### Behavioural caveats

- Orders do not reserve cash or shares at placement time. Two pending buys can
  both exist against the same cash; the first to fill wins and the second is
  rejected at execution time.
- `expiresAt` is compared against the process clock. Expiring an order moves
  it to `EXPIRED`; nothing is refunded because nothing was reserved.
- Only `STOCK` (Finnhub) and `CRYPTO` (Binance) providers are wired. `FOREX`
  orders are rejected at `POST /orders` with `UNSUPPORTED_ASSET_TYPE`, before a
  `PENDING` row exists. The worker also rejects any legacy `FOREX` row without
  calling a provider. Adding FOREX end to end means adding a provider and
  extending `src/utils/assetSupport.js`.
- Inactive portfolios are excluded from the worker query, so their orders are
  not automatically expired by the worker. They stay `PENDING` until the
  portfolio is reactivated or the owner cancels them; this is the deliberate
  trade-off that prevents inactive rows from occupying the batch.
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
worker described in `docs/NOTIFICATIONS.md`. There is no Socket.IO emission
(`docs/REALTIME.md`); clients see the notification on their next
`GET /notifications` poll.

---

## 🧾 Order endpoints and lifecycle

`PENDING` is the only non-terminal order status. `EXECUTED`, `CANCELLED`,
`EXPIRED`, and `REJECTED` are final, so an order that leaves `PENDING` can
never execute afterwards.

| Method | Path | Controller | Status |
| --- | --- | --- | --- |
| `POST` | `/api/v1/orders` | `createOrder` | Implemented — validates and stores `PENDING`; the worker executes |
| `GET` | `/api/v1/orders` | `listOrders` | Implemented — order history and open orders |
| `GET` | `/api/v1/orders/:id` | `getOrder` | Implemented |
| `DELETE` | `/api/v1/orders/:id` | `cancelOrder` | Implemented — conditional `PENDING → CANCELLED` |
| `PATCH` | `/api/v1/orders/:id` | — | **Not implemented** (documented in `docs/API.md`; see below) |

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

Coverage (41 new tests):

- **Unit (10)** — trigger truth table for every order type and side, inclusive
  boundaries, missing trigger prices, `MARKET` at any positive price, Decimal
  precision; trade serialization keeps zero realized P&L as `"0"` and buys as
  `null`.
- **Execution integration (19)** — buy debit + trade + holding; weighted
  average add-on; overdraw rollback (order stays `PENDING`, cash untouched);
  partial sell with realized P&L; oversell rollback; full close leaves
  quantity 0; non-pending rejection; missing order; invalid price;
  notification payload; two concurrent executions of one order; concurrent
  buys (existing holding and first-time create); concurrent sells; concurrent
  buy + sell; a buy that loses the cash race; FOREX rejected at placement;
  full close with a repeating weighted average; partial sale followed by a
  full close; seven successive partial sells whose removed bases telescope
  back to the original invested amount.
- **Worker integration (12)** — market fill at the provider quote; unmet limit
  stays pending then fills at the limit; expiry without a provider call;
  unfundable order becomes `REJECTED`; provider failure leaves `PENDING`;
  inactive portfolio is excluded from the batch; an older inactive order
  cannot block a newer active order with `limit: 1`; pending FOREX rejected
  without a provider call; permanent provider error rejected without retry;
  transient failure increments attempts; retry cap rejects; a poisoned oldest
  order cannot starve a newer valid order.

The worker suites inject a fake quote provider, so no test calls Finnhub or
Binance. Integration tests use the local PostgreSQL database from
`backend/.env`, create their own user/portfolio rows, and clean up through the
user cascade in `afterAll`.

Last verified: `42 suites, 799 tests passed` on the full backend suite.

---

## 🚧 Known gaps

| Area | Gap | Impact |
| --- | --- | --- |
| Queues | `orderQueue`, `notificationQueue`, `alertQueue`, `queues/index.js` are empty | No transport-level retries, backoff, job persistence, or dashboard (the in-process worker has a bounded attempt counter, not a queue) |
| Asset classes | `FOREX` exists in the enum but has no market-data provider | FOREX orders are rejected at placement; only `STOCK` and `CRYPTO` execute |
| Transport | In-process `setInterval` instead of BullMQ | Execution stops when the worker process stops; no horizontal scaling |
| Real-time | No Socket.IO emission on execution | Clients poll instead of receiving pushes |
| Analytics | No analytics event on execution | Analytics consumers see trades only via database reads |
| Notifications | In-app row only; no email/push, no preference checks | Users get no external alert on a fill |
| Modify order | `PATCH /orders/:id` is documented but not routed (see [Order endpoints and lifecycle](#-order-endpoints-and-lifecycle)) | Pending orders can only be created or cancelled |
| Short selling | `isShort` is always written `false`; sells require a long position | No short positions despite `docs/FEATURES.md` |
| Fees | `Trade.fees` is always `0` | No fee/commission modelling |
| Open orders | No `GET /orders/open` route | Intentional: `GET /orders?status=PENDING` is the documented equivalent (see [Order endpoints and lifecycle](#-order-endpoints-and-lifecycle)) |
| Manual execution | No API/admin endpoint calls `executeOrder` | Execution only happens through the worker poll |
| Reservation | Placing orders does not hold cash or shares | Later fills can be rejected despite an earlier accepted order |

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
- `docs/BACKGROUND_JOBS.md` — target BullMQ/Redis worker design.
- `docs/API.md` — order and trade contracts, error categories.
- `docs/DATABASE.md` — `Order`, `Holding`, `Trade`, `Notification` models.
- `docs/NOTIFICATIONS.md` — target notification pipeline and channels.
- `docs/ERROR_HANDLING.md` — `AppError` and the centralized envelope.
