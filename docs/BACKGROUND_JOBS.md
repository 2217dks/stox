# ⚙️ Background Jobs

> **BullMQ-based async processing for stox.**

---

## 📌 Table of Contents

- [Overview](#-overview)
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
| orders        | 3        | Exponential (1s, 2s, 4s)             |
| alerts        | 2        | Default                              |
| notifications | 5        | Exponential (5s, 10s, 20s, 40s, 80s) |
| reports       | 2        | Default                              |
| copy-trades   | 3        | Exponential                          |
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
- **Cadence:** Evaluates once per interval (default 60s) whether the current UTC calendar date has been snapshotted.
- **Action:** Computes and upserts end-of-day valuations, cash balances, and P&L metrics into `PerformanceSnapshot` for all active portfolios.
- **Graceful Shutdown:** Handles `SIGINT` / `SIGTERM` signals cleanly with timer cancellation.

### 2. Standalone Snapshot Scripts
- **Leaderboard Snapshots:** `npm run leaderboard:snapshot` (`scripts/generate-leaderboard-snapshots.js`)
- **Portfolio Snapshots:** `npm run portfolio:snapshot` (`scripts/generate-portfolio-snapshots.js`)

