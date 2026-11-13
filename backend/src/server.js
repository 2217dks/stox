require("dotenv").config();

const http = require("http");

const app = require("./app");
const { createSocketServer } = require("./sockets");
const { configureEventBus } = require("./realtime/eventBus");
const { createRedisEventBus } = require("./realtime/redisBus");
const { startRealtimeBridge } = require("./realtime/realtimeBridge");
const { createShutdown } = require("./serverShutdown");
const logger = require("./utils/logger");

const PORT = process.env.PORT || 8000;

const server = http.createServer(app);
const { io, marketRooms } = createSocketServer(server);

const eventBus = createRedisEventBus();
configureEventBus(eventBus);

// The handle exists immediately even if Redis is down. Startup retries in the
// background, and shutdown can cancel a pending attempt.
const realtimeBridge = startRealtimeBridge({ io, bus: eventBus });

realtimeBridge.ready.then((connected) => {
  // The bridge logs a successful connection itself; only surface the case where
  // shutdown raced a still-pending startup.
  if (!connected) {
    logger.warn("Realtime event bridge stopped before connecting");
  }
});

server.listen(PORT, () => {
  logger.info(`Stox backend running on port ${PORT}`);
});

const shutdown = createShutdown({
  io,
  marketRooms,
  realtimeBridge,
  eventBus,
});

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
