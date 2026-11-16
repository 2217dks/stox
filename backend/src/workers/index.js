require("dotenv").config();

const logger = require("../utils/logger");
const { withTimeout } = require("../utils/withTimeout");
const { configureEventBus } = require("../realtime/eventBus");
const { createRedisEventBus } = require("../realtime/redisBus");
const { DEFAULT_INTERVAL_MS, startOrderWorker } = require("./orderWorker");
const { createOrderQueueWorker } = require("./orderQueueWorker");
const { createNotificationQueueWorker } = require("./notificationQueueWorker");
const { createAlertQueueWorker } = require("./alertQueueWorker");
const { createCopyTradeWorker } = require("./copyTradeWorker");
const { startScanScheduler } = require("./scanScheduler");
const { ensureOrderScanScheduler } = require("../queues/orderQueue");
const {
  ensureNotificationScanScheduler,
} = require("../queues/notificationQueue");
const { ensureAlertScanScheduler } = require("../queues/alertQueue");
const { ensureCopyTradeScanScheduler } = require("../queues/copyTradeQueue");
const { closeQueues, isQueuesEnabled } = require("../queues");
const { startPortfolioSnapshotWorker } = require("./portfolioSnapshotWorker");

const SHUTDOWN_TIMEOUT_MS = 5000;
const DEFAULT_NOTIFICATION_SCAN_INTERVAL_MS = 30000;
const DEFAULT_ALERT_SCAN_INTERVAL_MS = 15000;
const DEFAULT_COPY_TRADE_SCAN_INTERVAL_MS = 60000;

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
 *
 * Notification, alert, and copy-trade delivery only run on BullMQ. Their
 * durable rows are written synchronously, so a Redis outage leaves them
 * recoverable and the periodic scans pick them up when Redis returns.
 */
const queuesEnabled = isQueuesEnabled();

const orderWorker = queuesEnabled ? null : startOrderWorker();
const queueWorker = queuesEnabled ? createOrderQueueWorker() : null;
const notificationQueueWorker = queuesEnabled
  ? createNotificationQueueWorker()
  : null;
const alertQueueWorker = queuesEnabled ? createAlertQueueWorker() : null;
const copyTradeQueueWorker = queuesEnabled ? createCopyTradeWorker() : null;

const SCAN_INTERVAL_MS =
  Number.parseInt(process.env.ORDER_SCAN_INTERVAL_MS, 10) ||
  DEFAULT_INTERVAL_MS;

const NOTIFICATION_SCAN_INTERVAL_MS =
  Number.parseInt(process.env.NOTIFICATION_SCAN_INTERVAL_MS, 10) ||
  DEFAULT_NOTIFICATION_SCAN_INTERVAL_MS;

const ALERT_SCAN_INTERVAL_MS =
  Number.parseInt(process.env.ALERT_SCAN_INTERVAL_MS, 10) ||
  DEFAULT_ALERT_SCAN_INTERVAL_MS;

const COPY_TRADE_SCAN_INTERVAL_MS =
  Number.parseInt(process.env.COPY_TRADE_SCAN_INTERVAL_MS, 10) ||
  DEFAULT_COPY_TRADE_SCAN_INTERVAL_MS;

const scanScheduler = queuesEnabled
  ? startScanScheduler({
      ensureScheduler: ensureOrderScanScheduler,
      intervalMs: SCAN_INTERVAL_MS,
      log: logger,
      label: "Order",
    })
  : null;

const notificationScanScheduler = queuesEnabled
  ? startScanScheduler({
      ensureScheduler: ensureNotificationScanScheduler,
      intervalMs: NOTIFICATION_SCAN_INTERVAL_MS,
      log: logger,
      label: "Notification",
    })
  : null;

const alertScanScheduler = queuesEnabled
  ? startScanScheduler({
      ensureScheduler: ensureAlertScanScheduler,
      intervalMs: ALERT_SCAN_INTERVAL_MS,
      log: logger,
      label: "Alert",
    })
  : null;

const copyTradeScanScheduler = queuesEnabled
  ? startScanScheduler({
      ensureScheduler: ensureCopyTradeScanScheduler,
      intervalMs: COPY_TRADE_SCAN_INTERVAL_MS,
      log: logger,
      label: "Copy trade",
    })
  : null;

const snapshotWorker = startPortfolioSnapshotWorker();

logger.info(
  queuesEnabled
    ? "Order worker started on the BullMQ orders queue"
    : `Order worker started; polling pending orders every ${DEFAULT_INTERVAL_MS}ms`,
);

if (queuesEnabled) {
  logger.info(
    "Notification, alert, and copy-trade workers started on their BullMQ queues",
  );
}

logger.info("Portfolio snapshot worker started for daily scheduled captures");

let shuttingDown = false;

async function closeQueueWorker(worker, label) {
  if (!worker) {
    return;
  }

  try {
    await withTimeout(worker.close(), SHUTDOWN_TIMEOUT_MS, {
      message: `${label} close timed out.`,
    });
  } catch (error) {
    logger.warn(`${label} shutdown failed`, {
      message: error.message,
    });
  }

  const queueConnection = worker.queueConnection;

  if (queueConnection && queueConnection.status !== "end") {
    try {
      await queueConnection.quit();
    } catch (error) {
      queueConnection.disconnect();
    }
  }
}

async function shutdown(signal) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  logger.info(`Workers stopping (${signal})`);

  scanScheduler?.stop();
  notificationScanScheduler?.stop();
  alertScanScheduler?.stop();
  copyTradeScanScheduler?.stop();
  orderWorker?.stop();
  snapshotWorker.stop();

  await closeQueueWorker(queueWorker, "Order queue worker");
  await closeQueueWorker(notificationQueueWorker, "Notification queue worker");
  await closeQueueWorker(alertQueueWorker, "Alert queue worker");
  await closeQueueWorker(copyTradeQueueWorker, "Copy-trade queue worker");

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
  notificationQueueWorker,
  alertQueueWorker,
  copyTradeQueueWorker,
  scanScheduler,
  notificationScanScheduler,
  alertScanScheduler,
  copyTradeScanScheduler,
  snapshotWorker,
};
