const prisma = require("../config/database");
const marketDataService = require("../services/marketData");
const { evaluateOrder, executeOrder } = require("../services/tradeService");
const logger = require("../utils/logger");

const DEFAULT_INTERVAL_MS = 5000;
const DEFAULT_BATCH_SIZE = 100;

// Terminal execution failures. Retrying these forever would only repeat the
// same rejection on every poll, so the worker moves the order to REJECTED.
const REJECTION_CODES = new Set([
  "INSUFFICIENT_BALANCE",
  "INSUFFICIENT_POSITION",
]);

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
  portfolioId,
} = {}) {
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

    let quote;

    try {
      quote = await quoteProvider.getQuote(order.symbol, {
        assetClass: order.assetType,
      });
    } catch (error) {
      summary.failed += 1;
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
        const rejection = await prisma.order.updateMany({
          where: {
            id: order.id,
            status: "PENDING",
          },
          data: {
            status: "REJECTED",
          },
        });

        if (rejection.count > 0) {
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

      summary.failed += 1;
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
  evaluateOrder,
  executeOrder,
  processPendingOrders,
  startOrderWorker,
};
