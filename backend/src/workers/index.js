require("dotenv").config();

const logger = require("../utils/logger");
const { DEFAULT_INTERVAL_MS, startOrderWorker } = require("./orderWorker");

const worker = startOrderWorker();

logger.info(
  `Order worker started; polling pending orders every ${DEFAULT_INTERVAL_MS}ms`,
);

function shutdown(signal) {
  logger.info(`Order worker stopping (${signal})`);
  worker.stop();
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

module.exports = worker;
