# ⚙️ Background Jobs

> **BullMQ-based async processing for stox.**

---

## 📌 Table of Contents

- [Overview](#-overview)
- [Implementation status](#-implementation-status)
- [Queue Architecture](#-queue-architecture)
- [Queue Definitions](#-queue-definitions)
- [Worker Implementation](#-worker-implementation)
- [Recurring Jobs](#-recurring-jobs)
- [Error Handling & Retries](#-error-handling--retries)
- [Monitoring](#-monitoring)

---

## 📖 Overview

Slow operations (order execution, alerts, reports, emails) are pushed to **BullMQ** queues with retries and scheduled jobs so the API stays fast. This gives us:

- **Non-blocking API** — responses return in milliseconds
- **Reliability** — retries with exponential backoff
- **Scheduling** — cron-like recurring jobs
- **Persistence** — jobs survive server restarts
- **Observability** — BullMQ dashboard for monitoring

---

## ✅ Implementation status

The BullMQ foundation and the **orders**, **notification**, **alert**,
**copy-trades**, and **snapshots** queues are implemented. All five run from the same worker
process.

### Registered queues

| Queue | Redis name | Default attempts | Backoff |
| --- | --- | --- | --- |
| Orders | `orders` | 5 | exponential, 1s |
| Notifications | `notifications` | 5 | exponential, 5s |
| Alerts | `alerts` | 2 | exponential, 1s |
| Copy trades | `copy-trades` | 3 | exponential, 2s |
| Snapshots | `snapshots` | 3 | exponential, 5s |

Redis keys are namespaced with `QUEUE_PREFIX` (default `stox`), so test runs
can use a unique prefix without touching real queues. Queues use their own
ioredis connection with `maxRetriesPerRequest: null`; the cache client's `1`
would make BullMQ throw at construction time.

### Orders job contracts

| Job | Payload | Attempts | What it does |
| --- | --- | --- | --- |
| `execute-order` | `{ orderId, portfolioId? }` | 5 | Re-reads the order, skips if it is no longer `PENDING`, then runs the shared `processOrder` |
| `scan-pending` | `{ portfolioId?, limit? }` | 3 | Discovers eligible `PENDING` orders and enqueues one `execute-order` job per order (`jobId = orderId`); it never executes orders itself |

Payloads are validated with Zod at enqueue time
(`src/queues/orderQueue.js`). `execute-order` uses the order id as its
`jobId`, so enqueueing the same order twice returns the existing job instead
of stacking duplicate work. Execution is also conditional on `PENDING`, so a
duplicate would be a no-op regardless.

The scan is a **discovery/enqueue mechanism only**. Executing from the scan as
well would create two concurrent processing paths for the same order: the
direct `execute-order` job from `POST /orders` and the periodic scan could both
fetch a quote and call `recordTransientFailure`, consuming the retry budget
twice for one logical attempt. There is exactly one canonical execution path,
the `execute-order` job; the scan only discovers rows and enqueues them.

`POST /orders` enqueues `execute-order` best-effort after the transaction
commits. A Redis outage logs a warning and returns a result instead of failing
the request; the repeatable scan and the polling fallback still pick the order
up.

### Notification job contracts

| Job | Payload | Attempts | What it does |
| --- | --- | --- | --- |
| `send-notification` | `{ notificationId }` | 5 | Loads the `Notification` row, claims delivery in the database, checks `UserPreference` + the legacy user flags, and delivers in-app (Socket.IO `/notifications`), email (Resend), and push (FCM HTTP v1) |
| `scan-pending` | `{ limit? }` | 3 | Finds notifications left at `deliveryStatus = PENDING` (for example after an enqueue timeout) and enqueues `send-notification` for each |

The notification row is written **before** the job is enqueued and is the
source of truth. Enqueueing is best-effort, so a Redis outage never hides the
in-app notification; the `notifications:scan-pending` scheduler retries the
outbound channels once Redis returns.

`Notification.deliveryAttempts` bounds that retry loop
(`NOTIFICATION_MAX_DELIVERY_ATTEMPTS`, default 5). Once the budget is spent the
row is marked `FAILED` and the scan stops picking it up. Without this budget a
provider that never recovers would be retried forever, because every transient
failure resets the row to `PENDING`.

A worker sets `deliveryStartedAt` when it claims a row. If it crashes before the
terminal update, the scan reclaims a `SENDING` row after
`NOTIFICATION_DELIVERY_LEASE_MS` (default 5 minutes) and retries it.

A permanent failure on one channel does not discard a delivery that succeeded
on another channel: the notification is marked `DELIVERED` and the failed
channel is recorded in `deliveryChannels`. A permanent failure with no
successful channel marks the row `FAILED`.

### Alert job contracts

| Job | Payload | Attempts | What it does |
| --- | --- | --- | --- |
| `evaluate-alert` | `{ alertId }` | 2 | Loads one `ACTIVE` alert, fetches its quote, evaluates the condition, and conditionally transitions it to `TRIGGERED` |
| `scan-alerts` | `{ symbol?, limit? }` | 2 | Loads `ACTIVE` alerts (optionally one symbol), fetches one quote per symbol, evaluates each alert, and reports counts |

Percentage alerts (`PERCENT_CHANGE_UP|DOWN`) compare the current quote against
`Alert.baselinePrice`, captured when the alert was created (or re-armed). The
`ACTIVE -> TRIGGERED` transition uses `updateMany` with a `status: "ACTIVE"`
filter, so two workers cannot trigger the same alert twice; the `PRICE_ALERT`
notification row is created in the same transaction as the claim.

A percentage alert created before baselines existed has `baselinePrice = null`.
The evaluator captures the current quote on its first evaluation (a conditional
`updateMany` makes this race-safe) and starts comparing from that point; the
alert does not trigger on the capture scan itself.

A single scan covers at most `limit` alerts and `ALERT_SCAN_MAX_SYMBOLS`
(default 50) distinct symbols. Alerts are ordered by `lastEvaluatedAt` (nulls
first) and the scan advances that cursor after each pass, so a large alert book
rotates instead of starving the newest alerts. The cursor records the last
**attempt**, not the last success: a symbol group whose quote request fails
transiently still advances, so the failed alerts remain `ACTIVE` and eligible
for a later retry without repeatedly occupying the scan and blocking the
deferred symbols. A permanent provider error (`MARKET_DATA_NOT_FOUND`, an
unsupported asset class, or a 400/404/422 response) moves the alert to
`EXPIRED` instead of retrying it forever.

Quotes with a provider timestamp older than `ALERT_MAX_QUOTE_AGE_MS` (default
300000 ms / 5 minutes) are treated as stale: the alert remains `ACTIVE`, is not
evaluated or notified, and the scan advances its rotation cursor so other
alerts can proceed. The next scheduled scan retries it. Quotes without a
provider timestamp are accepted because the market-data contract allows
providers to omit timestamps; freshness cannot be verified for those quotes.

### Copy-trade job contracts

| Job | Payload | Attempts | What it does |
| --- | --- | --- | --- |
| `fan-out-copy-trades` | `{ tradeId }` | 3 | Loads an executed source trade, pages through active followers, and places one `MARKET` copied order per follower through the normal order service |
| `scan-pending` | `{ limit? }` | 3 | Finds executed trades whose `copyFanOutAt` marker is null and enqueues one `fan-out-copy-trades` job per trade |

The fan-out job is enqueued after the source trade commits and is best-effort. It
never copies a trade whose source order is already `COPY_TRADE`, which prevents
copy chains. Each follower is isolated: a permanent failure (insufficient
balance/position, inactive portfolio, unsupported asset class) is recorded on
that follower's `CopyTradeExecution` row and does not fail the job or block
other followers. A transient failure leaves the row `PENDING` and throws
`COPY_TRADE_RETRY` so BullMQ applies the queue's retry policy; after the
attempt budget the row is marked `FAILED` with `MAX_ATTEMPTS_EXCEEDED`.

A completed pass sets `Trade.copyFanOutAt`. The periodic `scan-pending` job
finds trades whose marker is still null, which recovers a fan-out enqueue lost
during a Redis outage. A trade with no followers is still marked, so the scan
is finite; a trade is never replayed to a follower added after it executed.

### Snapshot job contracts

| Job | Payload | Attempts | What it does |
| --- | --- | --- | --- |
| `generate-portfolio-snapshots` | `{ targetDate?, force?, portfolioIds? }` | 3 | Checks per-portfolio coverage for target date, enforces early morning UTC settlement window (00:00 - 02:00 UTC), and generates daily EOD closing valuation snapshots for missing active portfolios. Skips idempotently when all active portfolios are recorded. |
| `prune-snapshot-retention` | `{ retentionDays? }` | 2 | Prunes historical `PerformanceSnapshot` records strictly older than the retention threshold (default 365 days, strictly validated positive integer between 1 and 3650) relative to UTC now for inactive portfolios, safely keeping the database bounded while strictly preserving complete historical snapshot series and baselines required by active portfolios for ALL-time performance. |

### Idempotency keys

| Job | Key | Guard |
| --- | --- | --- |
| `execute-order` | `jobId = orderId` | Execution is conditional on `status = PENDING`; completed jobs are removed so a resting order can be re-enqueued |
| `send-notification` | `jobId = notificationId` | `PENDING -> SENDING` is a conditional update; terminal statuses (`DELIVERED`, `SKIPPED`, `FAILED`) short-circuit a replay; per-channel results are persisted so a partial retry does not resend a successful email |
| `evaluate-alert` | `jobId = alertId` | `ACTIVE -> TRIGGERED` is a conditional update; completed jobs are removed so a still-active alert can be evaluated again |
| `fan-out-copy-trades` | `jobId = tradeId` | A durable unique `(sourceTradeId, copierId)` row guards every follower; `Order.copyTradeExecutionId` is unique, so a replay cannot create a second copied order even if the execution update was lost; `Trade.copyFanOutAt` marks a completed pass |
| `generate-portfolio-snapshots` | `jobId = snapshots:${targetDate}` | Deduplicated by target date; checks DB snapshot coverage per active portfolio; skips if all active portfolios already have snapshots for that date. |
| `prune-snapshot-retention` | none | Idempotent bulk deletion of expired snapshots strictly prior to the calculated UTC cutoff date. |
| `scan-alerts` / `scan-pending` | none | Discovery jobs; duplicate scans are harmless because the downstream work is guarded |

### Schedulers

| Scheduler id | Queue | Cadence / Interval env var | Default |
| --- | --- | --- | --- |
| `orders:scan-pending` | `orders` | `ORDER_SCAN_INTERVAL_MS` | 5000 ms |
| `notifications:scan-pending` | `notifications` | `NOTIFICATION_SCAN_INTERVAL_MS` | 30000 ms |
| `alerts:scan` | `alerts` | `ALERT_SCAN_INTERVAL_MS` | 15000 ms |
| `copy-trades:scan-pending` | `copy-trades` | `COPY_TRADE_SCAN_INTERVAL_MS` | 60000 ms |
| `snapshots:daily-generate` | `snapshots` | `PORTFOLIO_SNAPSHOT_CRON`, `PORTFOLIO_SNAPSHOT_TZ` | `0 1 * * *` (01:00 UTC) |
| `snapshots:retention-prune` | `snapshots` | `SNAPSHOT_RETENTION_CRON`, `PORTFOLIO_SNAPSHOT_TZ` | `0 3 * * *` (03:00 UTC) |

Scheduler registration is retried with bounded backoff, so a worker that starts
while Redis is briefly unavailable still registers once Redis returns.

### Transport selection

| `QUEUES_ENABLED` | Order processing |
| --- | --- |
| `true` (default) | The BullMQ worker consumes `execute-order`; a single scheduler (`orders:scan-pending`) enqueues a `scan-pending` job every `ORDER_SCAN_INTERVAL_MS` (default 5s), which in turn enqueues `execute-order` jobs for eligible rows |
| `false` | In-process polling loop (`startOrderWorker`) runs instead; no Redis queue connection is opened |

Both transports call the same `processOrder` processor, so transaction
boundaries and financial invariants do not depend on the transport. They are
mutually exclusive: the BullMQ scan never executes orders directly, and the
polling loop is selected only when queues are disabled.

### Retry and failure semantics

- **Transient** provider/execution failures throw a normal error; BullMQ backs
  off exponentially up to the attempt budget. The shared processor also
  increments `Order.executionAttempts` and rejects the order once
  `maxAttempts` is reached, so the two budgets cannot loop forever.
- Completed `execute-order` jobs are removed immediately
  (`removeOnComplete: true`). BullMQ deduplicates by `jobId` while a job is
  retained, including after completion, so keeping completed jobs would stop a
  later scan from re-enqueuing a resting LIMIT/STOP/TAKE_PROFIT order that is
  still `PENDING`. Failed jobs are still retained by the queue-level
  `removeOnFail` policy for inspection and replay.
- **Permanent** failures (`UnrecoverableError`): a missing order or an unknown
  job name. No retry.
- **Terminal business outcomes** (`rejected`) complete the job normally; the
  order row is the record, and duplicating it in the queue history would be
  noise.
- Failed jobs stay in Redis under `removeOnFail` with their payload, attempt
  count, and reason. Inspect and replay them with
  `listFailedOrderJobs()` / `retryFailedOrderJob(jobId)` from
  `src/queues/orderQueue.js`.
- Enqueue is bounded by `QUEUE_ENQUEUE_TIMEOUT_MS` (default 1500 ms). A
  disconnected Redis with `maxRetriesPerRequest: null` never settles, so
  without the bound every `POST /orders` would leave a pending enqueue
  promise. The API never awaits the enqueue, so a timeout is invisible to the
  client.
- The repeatable scan is registered with bounded retry backoff. A worker that
  starts while Redis is briefly unavailable would otherwise never re-evaluate
  resting LIMIT/STOP/TAKE_PROFIT orders.

### Adding a queue

1. Add the name to `QUEUE_NAMES` and a policy to `QUEUE_POLICIES` in
   `src/queues/definitions.js`.
2. Add an enqueue module with a Zod payload schema (follow `orderQueue.js`).
3. Add a worker that routes job names to a processor and exports the handler
   separately so it can be unit tested without Redis.
4. Register the worker in `src/workers/index.js` and close it on `SIGINT` /
   `SIGTERM`.
5. Add unit tests for payload validation and job routing, plus an integration
   test that uses a unique `QUEUE_PREFIX`.

### Running it

```bash
cd backend
npm run workers        # starts the order, notification, alert, and copy-trade workers (or polling if queues are disabled)
```

### Known gaps and follow-ups

- **Portfolio deactivation leaves non-expiring pending orders behind.**
  Deactivating a portfolio does not cancel its `PENDING` orders. The execution
  query skips inactive portfolios, so a non-expiring order stays `PENDING`
  with its reservation held until the owner cancels it or gives it an
  `expiresAt`. Overdue orders are settled by the expiry sweep regardless of
  portfolio activity, so expiry is not stranded. The remaining follow-up is to
  cancel or reject non-expiring pending orders on deactivation in the same
  transaction; until then, treat deactivation as a stop for new executions,
  not as a full settlement of resting orders.
- **Copy-trade fan-out is market-only.** Copied orders always use `MARKET` so
  sizing is deterministic. Mirroring `LIMIT`/`STOP_LOSS`/`TAKE_PROFIT` triggers
  is a larger design and is not implemented.

---

## 🏗️ Queue Architecture



```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          BULLMQ QUEUE SYSTEM                                │
├─────────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                         REDIS (BullMQ Backend)                       │   │
│  └──────────┬──────────┬──────────┬──────────┬──────────┬─────────────┘   │
│             │          │          │          │          │                  │
│             ▼          ▼          ▼          ▼          ▼                  │
│  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐       │
│  │ Orders │ │ Alerts │ │ Notifs │ │Reports │ │  Copy  │ │Achieve │       │
│  │ Queue  │ │ Queue  │ │ Queue  │ │ Queue  │ │ Queue  │ │ Queue  │       │
│  └───┬────┘ └───┬────┘ └───┬────┘ └───┬────┘ └───┬────┘ └───┬────┘       │
│      │          │          │          │          │          │             │
│      ▼          ▼          ▼          ▼          ▼          ▼             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                         WORKER PROCESSES                             │   │
│  │  - Order Worker      - Alert Worker      - Notification Worker      │   │
│  │  - Report Worker     - Copy Trade Worker - Achievement Worker       │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 📋 Queue Definitions

```javascript
// queues/index.js
import { Queue } from "bullmq";
import Redis from "ioredis";

const connection = new Redis(process.env.REDIS_URL, {
    maxRetriesPerRequest: null,
});

// ═══════════════════════════════════════════════════════════════
// ORDER QUEUE
// ═══════════════════════════════════════════════════════════════
export const orderQueue = new Queue("orders", {
    connection,
    defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 1000 },
        removeOnComplete: 100,
        removeOnFail: 1000,
    },
});

// ═══════════════════════════════════════════════════════════════
// ALERT QUEUE
// ═══════════════════════════════════════════════════════════════
export const alertQueue = new Queue("alerts", {
    connection,
    defaultJobOptions: {
        attempts: 2,
        removeOnComplete: 50,
    },
});

// ═══════════════════════════════════════════════════════════════
// NOTIFICATION QUEUE
// ═══════════════════════════════════════════════════════════════
export const notificationQueue = new Queue("notifications", {
    connection,
    defaultJobOptions: {
        attempts: 5,
        backoff: { type: "exponential", delay: 5000 },
        removeOnComplete: 200,
    },
});

// ═══════════════════════════════════════════════════════════════
// REPORT QUEUE
// ═══════════════════════════════════════════════════════════════
export const reportQueue = new Queue("reports", {
    connection,
    defaultJobOptions: {
        attempts: 2,
        removeOnComplete: 20,
    },
});

// ═══════════════════════════════════════════════════════════════
// COPY TRADE QUEUE
// ═══════════════════════════════════════════════════════════════
export const copyTradeQueue = new Queue("copy-trades", {
    connection,
    defaultJobOptions: {
        attempts: 3,
        removeOnComplete: 100,
    },
});

// ═══════════════════════════════════════════════════════════════
// ACHIEVEMENT QUEUE
// ═══════════════════════════════════════════════════════════════
export const achievementQueue = new Queue("achievements", {
    connection,
    defaultJobOptions: {
        attempts: 2,
        removeOnComplete: 100,
    },
});
```

---

## 👷 Worker Implementation

```javascript
// workers/orderWorker.js
import { Worker } from "bullmq";
import { prisma } from "../lib/prisma.js";
import { getPrice } from "../services/priceService.js";
import { notificationQueue } from "../queues/index.js";
import Redis from "ioredis";

const connection = new Redis(process.env.REDIS_URL, {
    maxRetriesPerRequest: null,
});

const orderWorker = new Worker(
    "orders",
    async (job) => {
        if (job.name === "check-pending") {
            const pendingOrders = await prisma.order.findMany({
                where: { status: "PENDING" },
                include: { portfolio: true },
            });

            for (const order of pendingOrders) {
                const currentPrice = await getPrice(order.symbol);
                if (!currentPrice) continue;

                const shouldExecute = evaluateOrder(order, currentPrice.price);

                if (shouldExecute) {
                    await executeOrder(order, currentPrice.price);
                }
            }
        }
    },
    {
        connection,
        concurrency: 5,
    },
);

function evaluateOrder(order, currentPrice) {
    switch (order.type) {
        case "LIMIT":
            if (order.side === "BUY") return currentPrice <= order.limitPrice;
            return currentPrice >= order.limitPrice;
        case "STOP_LOSS":
            return currentPrice <= order.stopPrice;
        case "TAKE_PROFIT":
            return currentPrice >= order.stopPrice;
        default:
            return false;
    }
}

async function executeOrder(order, price) {
    await prisma.$transaction(async (tx) => {
        // 1. Update order status
        await tx.order.update({
            where: { id: order.id },
            data: {
                status: "EXECUTED",
                executedPrice: price,
                executedAt: new Date(),
            },
        });

        // 2. Create trade record
        const trade = await tx.trade.create({
            data: {
                portfolioId: order.portfolioId,
                orderId: order.id,
                symbol: order.symbol,
                assetType: order.assetType,
                side: order.side,
                quantity: order.quantity,
                price: price,
                totalValue: Number(order.quantity) * price,
            },
        });

        // 3. Update portfolio holdings
        await updatePortfolio(tx, order, price);

        // 4. Queue notification
        await notificationQueue.add("order-executed", {
            userId: order.portfolio.userId,
            orderId: order.id,
            tradeId: trade.id,
        });

        return trade;
    });
}

async function updatePortfolio(tx, order, price) {
    const existing = await tx.holding.findFirst({
        where: { portfolioId: order.portfolioId, symbol: order.symbol },
    });

    if (order.side === "BUY") {
        if (existing) {
            const totalQty = Number(existing.quantity) + Number(order.quantity);
            const totalCost =
                Number(existing.totalInvested) + Number(order.quantity) * price;
            await tx.holding.update({
                where: { id: existing.id },
                data: {
                    quantity: totalQty,
                    totalInvested: totalCost,
                    averageBuyPrice: totalCost / totalQty,
                },
            });
        } else {
            await tx.holding.create({
                data: {
                    portfolioId: order.portfolioId,
                    symbol: order.symbol,
                    assetType: order.assetType,
                    quantity: order.quantity,
                    totalInvested: Number(order.quantity) * price,
                    averageBuyPrice: price,
                },
            });
        }
        // Deduct cash
        await tx.portfolio.update({
            where: { id: order.portfolioId },
            data: {
                cashBalance: { decrement: Number(order.quantity) * price },
            },
        });
    } else {
        // SELL logic
        await tx.holding.update({
            where: { id: existing.id },
            data: { quantity: { decrement: Number(order.quantity) } },
        });
        await tx.portfolio.update({
            where: { id: order.portfolioId },
            data: {
                cashBalance: { increment: Number(order.quantity) * price },
            },
        });
    }
}

export default orderWorker;
```

---

## 🔁 Recurring Jobs

```javascript
// queues/scheduled.js
import {
    orderQueue,
    alertQueue,
    achievementQueue,
    reportQueue,
} from "./index.js";

// Check pending orders every 5 seconds
await orderQueue.add(
    "check-pending",
    {},
    { repeat: { every: 5000 }, jobId: "check-pending-orders" },
);

// Check alerts every 5 seconds
await alertQueue.add(
    "check-alerts",
    {},
    { repeat: { every: 5000 }, jobId: "check-alerts" },
);

// Check achievements every minute
await achievementQueue.add(
    "check-all",
    {},
    { repeat: { every: 60000 }, jobId: "check-achievements" },
);

// Daily report at midnight
await reportQueue.add(
    "daily-report",
    {},
    { repeat: { pattern: "0 0 * * *" }, jobId: "daily-report" },
);

// Weekly digest every Monday at 9 AM
await reportQueue.add(
    "weekly-digest",
    {},
    { repeat: { pattern: "0 9 * * 1" }, jobId: "weekly-digest" },
);
```

---

## 🔄 Error Handling & Retries

| Queue         | Attempts | Backoff                              |
| ------------- | -------- | ------------------------------------ |
| orders        | 5        | Exponential (1s, 2s, 4s, 8s)         |
| alerts        | 2        | Exponential (1s, 2s)                 |
| notifications | 5        | Exponential (5s, 10s, 20s, 40s, 80s) |
| reports       | 2        | Default                              |
| copy-trades   | 3        | Exponential (2s, 4s)                 |
| achievements  | 2        | Default                              |

**Failed job handling:**

```javascript
worker.on("failed", (job, err) => {
    logger.error({
        queue: worker.name,
        jobId: job.id,
        jobName: job.name,
        attemptsMade: job.attemptsMade,
        error: err.message,
    });
});

worker.on("completed", (job) => {
    logger.info({
        queue: worker.name,
        jobId: job.id,
        duration: job.finishedOn - job.processedOn,
    });
});
```

---

## 📊 Monitoring

**BullMQ Dashboard** (via `@bull-board/express`):

```javascript
import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { ExpressAdapter } from "@bull-board/express";

const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath("/admin/queues");

createBullBoard({
    queues: [
        new BullMQAdapter(orderQueue),
        new BullMQAdapter(alertQueue),
        new BullMQAdapter(notificationQueue),
        new BullMQAdapter(reportQueue),
    ],
    serverAdapter,
});

app.use("/admin/queues", serverAdapter.getRouter());
```

Access at: `http://localhost:5000/admin/queues`

---

## 📈 In-Process Scheduled Workers & Batch Scripts

For environments running without full BullMQ / Redis worker clusters, or for daily market close rollups, Stox provides dedicated in-process workers and CLI batch scripts:

### 1. Portfolio Snapshot Worker (`src/workers/portfolioSnapshotWorker.js`)
- **Execution:** Started automatically by `npm run workers` (`src/workers/index.js`).
- **Cadence & Window:** Evaluates once per interval (default 60s). Scheduled captures execute within the post-midnight UTC settlement window (`00:00 - 02:00 UTC`, configurable via `PORTFOLIO_SNAPSHOT_WINDOW_HOURS`).
- **End-of-Day Semantics:** Targets yesterday's completed date ($D = T - 1$), computing valuations and P&L as of $D\text{T}23:59:59.999\text{Z}$ using historical closing prices (`getHistoricalPrice` / `getHistoricalPrices`), not live execution-time quotes, and persisting idempotently for `snapshotDate = D`.
- **Per-Portfolio Restart & Retry Guardrails:** 
  - On restart or interval poll, verifies coverage per active portfolio for the target date.
  - If a prior run was partially successful, retries target ONLY the portfolios still missing snapshots.
  - If a scheduled run was missed and execution occurs outside the settlement window, it logs an alert with missing counts and skips to avoid polluting historical EOD data with live intraday quotes.
  - Current date ($T$) is never snapshotted mid-day before closing.
- **Graceful Shutdown:** Handles `SIGINT` / `SIGTERM` signals cleanly with timer cancellation.

### 2. Leaderboard Snapshot Worker (`src/workers/leaderboardSnapshotWorker.js`)
- **Execution:** Started automatically by `npm run workers` (`src/workers/index.js`).
- **Cadence:** Daily schedule at 02:00 UTC targeting completed date $D = T - 1$.
- **Distributed Locking & Concurrency Control:**
  - Uses Redis key `leaderboard:snapshot:lock` with a unique worker identifier token.
  - **Fail-Closed Locking**: Aborts immediately if Redis is unreachable, preventing uncoordinated, duplicate snapshot generation across multi-replica worker environments.
  - **Atomic Lua Lease Release**: Releases the lease via an atomic Lua script verifying token ownership, preventing race conditions where slow workers clear another instance's lock.
  - **Heartbeat Lease Renewal**: A 10-second interval heartbeat extends the Redis lease by 30 seconds for long runs, ensuring the lock never expires prematurely mid-execution.

### 3. League Completion Worker (`src/workers/leagueCompletionWorker.js`)
- **Execution:** Started automatically by `npm run workers` (`src/workers/index.js`).
- **Cadence & Interval:** Evaluates once per interval (default 60s, configurable via `LEAGUE_COMPLETION_INTERVAL_MS`). Runs an initial tick immediately on startup.
- **Completion & Final Rankings:** Discovers ending leagues (`endDate <= now`) or `COMPLETED` leagues requiring ranking/notification reconciliation. Evaluates member returns, persists final ranks and returns atomically, and enqueues completion notifications (`LEAGUE_UPDATE`).
- **Idempotency & Reconciliation:** Idempotently repairs completed leagues with missing notification records or ranks without overwriting previously finalized standings or generating duplicate alerts.

### 4. Standalone Snapshot Scripts
- **Leaderboard Snapshots:** `npm run leaderboard:snapshot` (`scripts/generate-leaderboard-snapshots.js`)
- **Portfolio Snapshots:** `npm run portfolio:snapshot` (`scripts/generate-portfolio-snapshots.js`)
  - Supports `--date=YYYY-MM-DD` to target a specific date's EOD valuation.
  - Supports `--force` to bypass settlement window checks during operational backfills.

