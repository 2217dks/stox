require("dotenv").config();

const http = require("http");

const app = require("./app");
const { createSocketServer } = require("./sockets");
const { configureEventBus } = require("./realtime/eventBus");
const { createRedisEventBus } = require("./realtime/redisBus");
const { startRealtimeBridge } = require("./realtime/realtimeBridge");
const logger = require("./utils/logger");

const PORT = process.env.PORT || 8000;

const server = http.createServer(app);
const { io, marketRooms } = createSocketServer(server);

const eventBus = createRedisEventBus();
configureEventBus(eventBus);

let realtimeBridge = null;

startRealtimeBridge({ io, bus: eventBus })
  .then((bridge) => {
    realtimeBridge = bridge;
    logger.info("Realtime event bridge started");
  })
  .catch((error) => {
    // The API stays usable without fan-out; HTTP and local socket rooms work.
    logger.warn("Realtime event bridge unavailable", {
      message: error.message,
    });
  });

server.listen(PORT, () => {
  logger.info(`Stox backend running on port ${PORT}`);
});

let shuttingDown = false;

function shutdown(signal) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  logger.info(`Shutting down (${signal})`);

  marketRooms.stop();

  if (realtimeBridge) {
    realtimeBridge.stop();
  }

  eventBus.close().catch((error) => {
    logger.warn("Realtime bus shutdown failed", {
      message: error.message,
    });
  });

  // Socket.IO owns the HTTP server once attached, so closing it here also
  // stops new HTTP connections and disconnects socket clients.
  io.close(() => {
    process.exit(0);
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
