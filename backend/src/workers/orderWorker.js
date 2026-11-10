const prisma = require("../config/database");
const marketDataService = require("../services/marketData");
const { evaluateOrder, executeOrder } = require("../services/tradeService");
const { isExecutableAssetType } = require("../utils/assetSupport");
const logger = require("../utils/logger");

const DEFAULT_INTERVAL_MS = 5000;
const DEFAULT_BATCH_SIZE = 100;

// Transient failures are retried for a bounded number of polls. Without a
// limit, an order whose symbol permanently fails (provider keeps returning a
// retryable-looking error) stays at the front of the oldest-first queue and
// can starve every newer order once the batch is full of such rows.
const DEFAULT_MAX_ATTEMPTS = 5;

// Terminal execution failures. Retrying these forever would only repeat the
// same rejection on every poll, so the worker moves the order to REJECTED.
const REJECTION_CODES = new Set([
  "INSUFFICIENT_BALANCE",
  "INSUFFICIENT_POSITION",
  "INVALID_ORDER",
  "UNSUPPORTED_ASSET_TYPE",
]);

// Provider errors that describe the request itself rather than a temporary
// outage. Retrying cannot fix them, so the order is rejected immediately.
const PERMANENT_PROVIDER_CODES = new Set([
  "MARKET_DATA_UNSUPPORTED_ASSET_CLASS",
  "MARKET_DATA_NOT_FOUND",
  "MARKET_DATA_INVALID_REQUEST",
]);

const PERMANENT_PROVIDER_STATUSES = new Set([400, 404, 422]);

function isPermanentProviderError(error) {
  if (!error) {
    return false;
  }

  if (PERMANENT_PROVIDER_CODES.has(error.code)) {
    return true;
  }

  const statusCode = error.statusCode ?? error.status;

  // Credential, rate-limit, timeout, and 5xx failures can recover without the
  // order changing, so they stay retryable.
  return (
    typeof statusCode === "number" &&
    PERMANENT_PROVIDER_STATUSES.has(statusCode)
  );
}

async function rejectPendingOrder(orderId) {
  const rejection = await prisma.order.updateMany({
    where: {
      id: orderId,
      status: "PENDING",
    },
    data: {
      status: "REJECTED",
    },
  });

  return rejection.count > 0;
}

// Returns "retry" while the order still has budget, "rejected" when this
// attempt exhausted it, and "skipped" when another worker already moved the
// order out of PENDING.
async function recordTransientFailure(orderId, now, maxAttempts) {
  const incremented = await prisma.order.updateMany({
    where: {
      id: orderId,
      status: "PENDING",
    },
    data: {
      executionAttempts: {
        increment: 1,
      },
      lastExecutionAttemptAt: now,
    },
  });

  if (incremented.count === 0) {
    return "skipped";
  }

  const current = await prisma.order.findUnique({
    where: { id: orderId },
    select: { executionAttempts: true },
  });

  if (!current || current.executionAttempts < maxAttempts) {
    return "retry";
  }

  // The condition is re-checked here so two workers observing the same order
  // cannot reject it after another one already executed it.
  const rejection = await prisma.order.updateMany({
    where: {
      id: orderId,
      status: "PENDING",
      executionAttempts: {
        gte: maxAttempts,
      },
    },
    data: {
      status: "REJECTED",
    },
  });

  return rejection.count > 0 ? "rejected" : "skipped";
}

/**
 * One polling pass over pending orders.
 *
 * The processor is deliberately separate from the transport (BullMQ or the
 * in-process fallback): it takes a quote provider, a clock, and an optional
 * portfolio filter so it can be tested without Redis or market-data calls.
 *
 * Returns a summary instead of throwing for per-order failures, so one bad
 * symbol cannot stop the rest of the batch.
 */
async function processPendingOrders({
  quoteProvider = marketDataService,
  now = new Date(),
  limit = DEFAULT_BATCH_SIZE,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  portfolioId,
} = {}) {
  const retryLimit =
    Number.isInteger(maxAttempts) && maxAttempts > 0
      ? maxAttempts
      : DEFAULT_MAX_ATTEMPTS;

  const where = {
    status: "PENDING",
  };

  if (portfolioId) {
    where.portfolioId = portfolioId;
  }

  const pendingOrders = await prisma.order.findMany({
    where,
    include: {
      portfolio: {
        select: {
          id: true,
          isActive: true,
        },
      },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: limit,
  });

  const summary = {
    scanned: pendingOrders.length,
    executed: 0,
    skipped: 0,
    expired: 0,
    rejected: 0,
    failed: 0,
  };

  for (const order of pendingOrders) {
    if (order.expiresAt && order.expiresAt <= now) {
      const expiration = await prisma.order.updateMany({
        where: {
          id: order.id,
          status: "PENDING",
        },
        data: {
          status: "EXPIRED",
        },
      });

      if (expiration.count > 0) {
        summary.expired += 1;
      }

      continue;
    }

    // Portfolios can be deactivated after an order was placed. Skip rather
    // than execute against a portfolio the owner has closed.
    if (!order.portfolio || order.portfolio.isActive === false) {
      summary.skipped += 1;
      continue;
    }

    // Defence in depth: placement rejects these already, but a legacy or
    // externally written row must not be retried forever.
    if (!isExecutableAssetType(order.assetType)) {
      if (await rejectPendingOrder(order.id)) {
        summary.rejected += 1;
      } else {
        summary.skipped += 1;
      }

      continue;
    }

    let quote;

    try {
      quote = await quoteProvider.getQuote(order.symbol, {
        assetClass: order.assetType,
      });
    } catch (error) {
      if (isPermanentProviderError(error)) {
        if (await rejectPendingOrder(order.id)) {
          summary.rejected += 1;
        } else {
          summary.skipped += 1;
        }

        continue;
      }

      const outcome = await recordTransientFailure(order.id, now, retryLimit);

      if (outcome === "rejected") {
        summary.rejected += 1;
      } else if (outcome === "retry") {
        summary.failed += 1;
      } else {
        summary.skipped += 1;
      }

      continue;
    }

    if (!quote || !evaluateOrder(order, quote.price)) {
      summary.skipped += 1;
      continue;
    }

    try {
      await executeOrder(order, quote.price);
      summary.executed += 1;
    } catch (error) {
      if (REJECTION_CODES.has(error.code)) {
        if (await rejectPendingOrder(order.id)) {
          summary.rejected += 1;
        } else {
          summary.skipped += 1;
        }

        continue;
      }

      // A concurrent worker won the PENDING -> EXECUTED transition, or the
      // order disappeared. Neither is an error for this pass.
      if (
        error.code === "ORDER_NOT_EXECUTABLE" ||
        error.code === "ORDER_NOT_FOUND"
      ) {
        summary.skipped += 1;
        continue;
      }

      const outcome = await recordTransientFailure(order.id, now, retryLimit);

      if (outcome === "rejected") {
        summary.rejected += 1;
      } else if (outcome === "retry") {
        summary.failed += 1;
      } else {
        summary.skipped += 1;
      }
    }
  }

  return summary;
}

/**
 * In-process polling fallback used by `npm run workers`.
 *
 * BullMQ is the production transport in docs/BACKGROUND_JOBS.md, but the
 * same processor can run without Redis for local development. A tick never
 * overlaps with itself; a slow provider call delays the next pass instead of
 * starting a second one.
 */
function startOrderWorker({
  intervalMs = DEFAULT_INTERVAL_MS,
  ...processOptions
} = {}) {
  let stopped = false;
  let running = false;

  const run = async () => {
    if (stopped || running) {
      return;
    }

    running = true;

    try {
      await processPendingOrders(processOptions);
    } catch (error) {
      logger.error("Order worker poll failed", {
        error: error.message,
      });
    } finally {
      running = false;
    }
  };

  const timer = setInterval(run, intervalMs);

  run();

  return {
    run,
    stop() {
      stopped = true;
      clearInterval(timer);
    },
  };
}

module.exports = {
  DEFAULT_BATCH_SIZE,
  DEFAULT_INTERVAL_MS,
  DEFAULT_MAX_ATTEMPTS,
  evaluateOrder,
  executeOrder,
  processPendingOrders,
  startOrderWorker,
};
