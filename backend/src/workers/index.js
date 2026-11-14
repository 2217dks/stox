require("dotenv").config();

const logger = require("../utils/logger");
const { configureEventBus } = require("../realtime/eventBus");
const { createRedisEventBus } = require("../realtime/redisBus");
const { DEFAULT_INTERVAL_MS, startOrderWorker } = require("./orderWorker");
const { createOrderQueueWorker } = require("./orderQueueWorker");
const { ensureOrderScanScheduler } = require("../queues/orderQueue");
const { closeQueues, isQueuesEnabled } = require("../queues");
const { createQueueConnection } = require("../queues/connection");
const { startPortfolioSnapshotWorker } = require("./portfolioSnapshotWorker");

const eventBus = createRedisEventBus({ withSubscriber: false });
configureEventBus(eventBus);

/**
 * Transport selection:
 *
 * - `QUEUES_ENABLED=true` (default): BullMQ owns order processing. The worker
 *   consumes `execute-order` and `scan-pending` jobs, and a repeatable
 *   scheduler enqueues the scan every `ORDER_SCAN_INTERVAL_MS`.
 * - `QUEUES_ENABLED=false`: the in-process polling loop runs instead, so local
 *   development works without Redis.
 *
 * Both transports call the same processor, so execution semantics do not
 * change. Running both at once would only duplicate scans.
 */
const queuesEnabled = isQueuesEnabled();

const orderWorker = queuesEnabled ? null : startOrderWorker();

// The worker owns this connection; BullMQ will not close a caller-supplied
// ioredis instance, so shutdown closes it explicitly.
const queueConnection = queuesEnabled ? createQueueConnection() : null;
const queueWorker = queuesEnabled
  ? createOrderQueueWorker({ connection: queueConnection })
  : null;

if (queuesEnabled) {
  ensureOrderScanScheduler({
    every:
      Number.parseInt(process.env.ORDER_SCAN_INTERVAL_MS, 10) ||
      DEFAULT_INTERVAL_MS,
  })
    .then((result) => {
      if (result.scheduled) {
        logger.info("Order scan scheduler registered");
      } else {
        logger.warn("Order scan scheduler not registered", {
          reason: result.reason,
        });
      }
    })
    .catch((error) => {
      logger.error("Order scan scheduler registration crashed", {
        message: error.message,
      });
    });
}

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

  orderWorker?.stop();
  snapshotWorker.stop();

  if (queueWorker) {
    await queueWorker.close().catch((error) => {
      logger.warn("Order queue worker shutdown failed", {
        message: error.message,
      });
    });
  }

  if (queueConnection && queueConnection.status !== "end") {
    try {
      await queueConnection.quit();
    } catch (error) {
      queueConnection.disconnect();
    }
  }

  await closeQueues();

  try {
    await eventBus.close();
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
  snapshotWorker,
};
