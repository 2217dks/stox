const prisma = require("../config/database");
const marketDataService = require("../services/marketData");
const { evaluateOrder, executeOrder } = require("../services/tradeService");
const { isExecutableAssetType } = require("../utils/assetSupport");
const { hasEventBus, publishOrderStatus } = require("../realtime/orderEvents");
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

async function transitionPendingOrder(orderId, status, extraWhere = {}) {
  return prisma.$transaction(async (tx) => {
    // Read the portfolio ID first. This is only a lookup, not a row lock.
    const orderRef = await tx.order.findUnique({
      where: { id: orderId },
      select: { portfolioId: true },
    });

    if (!orderRef) {
      return false;
    }

    // Always lock the portfolio before locking/updating the order.
    const portfolios = await tx.$queryRaw`
      SELECT "id", "reservedCash"
      FROM "Portfolio"
      WHERE "id" = ${orderRef.portfolioId}
      FOR UPDATE
    `;

    const portfolio = portfolios[0];

    if (!portfolio) {
      return false;
    }

    const currentOrder = await tx.order.findFirst({
      where: {
        id: orderId,
        status: "PENDING",
        ...extraWhere,
      },
      select: {
        side: true,
        reservedCash: true,
      },
    });

    if (!currentOrder) {
      return false;
    }

    const orderReservedCash =
      currentOrder.side === "BUY" ? currentOrder.reservedCash : 0;

    if (
      currentOrder.side === "BUY" &&
      portfolio.reservedCash.lt(orderReservedCash)
    ) {
      const error = new Error(
        "Order reservation exceeds portfolio reserved cash.",
      );
      error.code = "RESERVATION_INCONSISTENCY";
      throw error;
    }

    const transition = await tx.order.updateMany({
      where: {
        id: orderId,
        status: "PENDING",
        ...extraWhere,
      },
      data: {
        status,
        reservedCash: 0,
      },
    });

    if (transition.count === 0) {
      return false;
    }

    if (currentOrder.side === "BUY" && !orderReservedCash.isZero()) {
      await tx.portfolio.update({
        where: { id: orderRef.portfolioId },
        data: {
          reservedCash: {
            decrement: orderReservedCash,
          },
        },
      });
    }

    return true;
  });
}

async function rejectPendingOrder(orderId) {
  return transitionPendingOrder(orderId, "REJECTED");
}

// Returns "retry" while the order still has budget, "rejected" when this
// attempt exhausted it, and "skipped" when another worker already moved the
// order out of PENDING.
async function recordTransientFailure(orderId, now, maxAttempts) {
  return prisma.$transaction(async (tx) => {
    const orderRef = await tx.order.findUnique({
      where: { id: orderId },
      select: { portfolioId: true },
    });

    if (!orderRef) {
      return "skipped";
    }

    const portfolios = await tx.$queryRaw`
      SELECT "id", "reservedCash"
      FROM "Portfolio"
      WHERE "id" = ${orderRef.portfolioId}
      FOR UPDATE
    `;

    const portfolio = portfolios[0];

    if (!portfolio) {
      return "skipped";
    }

    const currentOrder = await tx.order.findFirst({
      where: {
        id: orderId,
        status: "PENDING",
      },
      select: {
        executionAttempts: true,
        side: true,
        reservedCash: true,
      },
    });

    if (!currentOrder) {
      return "skipped";
    }

    const nextAttempts = currentOrder.executionAttempts + 1;
    const shouldReject = nextAttempts >= maxAttempts;

    const orderReservedCash =
      currentOrder.side === "BUY" ? currentOrder.reservedCash : 0;

    if (
      shouldReject &&
      currentOrder.side === "BUY" &&
      portfolio.reservedCash.lt(orderReservedCash)
    ) {
      const error = new Error(
        "Order reservation exceeds portfolio reserved cash.",
      );
      error.code = "RESERVATION_INCONSISTENCY";
      throw error;
    }

    const update = await tx.order.updateMany({
      where: {
        id: orderId,
        status: "PENDING",
        executionAttempts: currentOrder.executionAttempts,
      },
      data: {
        executionAttempts: {
          increment: 1,
        },
        lastExecutionAttemptAt: now,
        ...(shouldReject
          ? {
              status: "REJECTED",
              reservedCash: 0,
            }
          : {}),
      },
    });

    if (update.count === 0) {
      return "skipped";
    }

    if (
      shouldReject &&
      currentOrder.side === "BUY" &&
      !orderReservedCash.isZero()
    ) {
      await tx.portfolio.update({
        where: { id: orderRef.portfolioId },
        data: {
          reservedCash: {
            decrement: orderReservedCash,
          },
        },
      });
    }

    return shouldReject ? "rejected" : "retry";
  });
}

/**
 * Process one pending order and return the summary counter to increment.
 *
 * Outcomes: `executed`, `expired`, `rejected`, `retry` (a transient failure
 * with retry budget left, counted as `failed`), or `skipped`. Keeping this
 * decision in one place means `processPendingOrders` only owns querying,
 * batching, and counters.
 */
async function runOrder(order, { quoteProvider, now, retryLimit }) {
  if (order.expiresAt && order.expiresAt <= now) {
    const expired = await transitionPendingOrder(order.id, "EXPIRED");

    return expired ? "expired" : "skipped";
  }

  // Portfolios can be deactivated after the order was placed. Skip rather
  // than execute against a portfolio the owner has closed.
  if (!order.portfolio || order.portfolio.isActive === false) {
    return "skipped";
  }

  // Defence in depth: placement rejects these already, but a legacy or
  // externally written row must not be retried forever.
  if (!isExecutableAssetType(order.assetType)) {
    return (await rejectPendingOrder(order.id)) ? "rejected" : "skipped";
  }

  let quote;

  try {
    quote = await quoteProvider.getQuote(order.symbol, {
      assetClass: order.assetType,
    });
  } catch (error) {
    if (isPermanentProviderError(error)) {
      return (await rejectPendingOrder(order.id)) ? "rejected" : "skipped";
    }

    return recordTransientFailure(order.id, now, retryLimit);
  }

  if (!quote || !evaluateOrder(order, quote.price)) {
    return "skipped";
  }

  try {
    await executeOrder(order, quote.price);
    return "executed";
  } catch (error) {
    if (REJECTION_CODES.has(error.code)) {
      return (await rejectPendingOrder(order.id)) ? "rejected" : "skipped";
    }

    // A concurrent worker won the PENDING -> EXECUTED transition, or the
    // order disappeared. Neither is an error for this pass.
    if (
      error.code === "ORDER_NOT_EXECUTABLE" ||
      error.code === "ORDER_NOT_FOUND"
    ) {
      return "skipped";
    }

    return recordTransientFailure(order.id, now, retryLimit);
  }
}

/**
 * Run one order and publish terminal lifecycle events.
 *
 * Execution events come from `tradeService.executeOrder` after its commit; this
 * wrapper only covers the transitions the execution path does not see:
 * expiry and rejection.
 */
async function processOrder(order, options) {
  const outcome = await runOrder(order, options);

  if (hasEventBus() && (outcome === "expired" || outcome === "rejected")) {
    void publishOrderStatus({
      ...order,
      status: outcome === "expired" ? "EXPIRED" : "REJECTED",
      executedPrice: null,
    });
  }

  return outcome;
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

  // Inactive portfolios are filtered before `take`, not after it. Otherwise
  // their old PENDING rows occupy the oldest slots in every batch and can
  // permanently starve valid orders belonging to active portfolios.
  const where = {
    status: "PENDING",
    portfolio: {
      isActive: true,
    },
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
    const outcome = await processOrder(order, {
      quoteProvider,
      now,
      retryLimit,
    });

    // `recordTransientFailure` says "retry"; the public summary calls it
    // "failed".
    summary[outcome === "retry" ? "failed" : outcome] += 1;
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
  processPendingOrders,
  startOrderWorker,
};
