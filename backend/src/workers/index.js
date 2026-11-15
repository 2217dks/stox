require("dotenv").config();

const logger = require("../utils/logger");
const { withTimeout } = require("../utils/withTimeout");
const { configureEventBus } = require("../realtime/eventBus");
const { createRedisEventBus } = require("../realtime/redisBus");
const { DEFAULT_INTERVAL_MS, startOrderWorker } = require("./orderWorker");
const { createOrderQueueWorker } = require("./orderQueueWorker");
const { startScanScheduler } = require("./scanScheduler");
const { ensureOrderScanScheduler } = require("../queues/orderQueue");
const { closeQueues, isQueuesEnabled } = require("../queues");
const { startPortfolioSnapshotWorker } = require("./portfolioSnapshotWorker");

const SHUTDOWN_TIMEOUT_MS = 5000;

const eventBus = createRedisEventBus({ withSubscriber: false });
configureEventBus(eventBus);

/**
 * Transport selection:
 *
 * - `QUEUES_ENABLED=true` (default): BullMQ owns order processing. The worker
 *   consumes `execute-order` jobs; the repeatable `scan-pending` scheduler
 *   only discovers eligible rows and enqueues more `execute-order` jobs.
 * - `QUEUES_ENABLED=false`: the in-process polling loop runs instead, so local
 *   development works without Redis.
 *
 * Both transports call the same `processOrder` processor, so execution
 * semantics do not change. The two transports are mutually exclusive: running
 * both would create two execution paths for the same pending order.
 */
const queuesEnabled = isQueuesEnabled();

const orderWorker = queuesEnabled ? null : startOrderWorker();
const queueWorker = queuesEnabled ? createOrderQueueWorker() : null;

const SCAN_INTERVAL_MS =
  Number.parseInt(process.env.ORDER_SCAN_INTERVAL_MS, 10) ||
  DEFAULT_INTERVAL_MS;

const scanScheduler = queuesEnabled
  ? startScanScheduler({
      ensureScheduler: ensureOrderScanScheduler,
      intervalMs: SCAN_INTERVAL_MS,
      log: logger,
    })
  : null;

const snapshotWorker = startPortfolioSnapshotWorker();

logger.info(
  queuesEnabled
    ? "Order worker started on the BullMQ orders queue"
    : `Order worker started; polling pending orders every ${DEFAULT_INTERVAL_MS}ms`,
);
logger.info("Portfolio snapshot worker started for daily scheduled captures");

let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  logger.info(`Workers stopping (${signal})`);

  scanScheduler?.stop();
  orderWorker?.stop();
  snapshotWorker.stop();

  if (queueWorker) {
    try {
      await withTimeout(queueWorker.close(), SHUTDOWN_TIMEOUT_MS, {
        message: "Order queue worker close timed out.",
      });
    } catch (error) {
      logger.warn("Order queue worker shutdown failed", {
        message: error.message,
      });
    }

    const queueConnection = queueWorker.queueConnection;

    if (queueConnection && queueConnection.status !== "end") {
      try {
        await queueConnection.quit();
      } catch (error) {
        queueConnection.disconnect();
      }
    }
  }

  try {
    await withTimeout(closeQueues(), SHUTDOWN_TIMEOUT_MS, {
      message: "Queue close timed out.",
    });
  } catch (error) {
    logger.warn("Queue shutdown failed", {
      message: error.message,
    });
  }

  try {
    await withTimeout(eventBus.close(), SHUTDOWN_TIMEOUT_MS, {
      message: "Realtime bus close timed out.",
    });
  } catch (error) {
    logger.warn("Realtime bus shutdown failed", {
      message: error.message,
    });
  }

  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

module.exports = {
  orderWorker,
  queueWorker,
  scanScheduler,
  snapshotWorker,
};
