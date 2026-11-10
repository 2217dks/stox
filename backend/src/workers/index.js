require("dotenv").config();

const logger = require("../utils/logger");
const { configureEventBus } = require("../realtime/eventBus");
const { createRedisEventBus } = require("../realtime/redisBus");
const { DEFAULT_INTERVAL_MS, startOrderWorker } = require("./orderWorker");

const eventBus = createRedisEventBus({ withSubscriber: false });
configureEventBus(eventBus);

const worker = startOrderWorker();

logger.info(
  `Order worker started; polling pending orders every ${DEFAULT_INTERVAL_MS}ms`,
);

function shutdown(signal) {
  logger.info(`Order worker stopping (${signal})`);
  worker.stop();

  eventBus
    .close()
    .catch((error) => {
      logger.warn("Realtime bus shutdown failed", {
        message: error.message,
      });
    })
    .finally(() => process.exit(0));
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

module.exports = worker;
