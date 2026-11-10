require("dotenv").config();

const http = require("http");

const app = require("./app");
const { createSocketServer } = require("./sockets");
const logger = require("./utils/logger");

const PORT = process.env.PORT || 8000;

const server = http.createServer(app);
const { io, marketRooms } = createSocketServer(server);

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

  // Socket.IO owns the HTTP server once attached, so closing it here also
  // stops new HTTP connections and disconnects socket clients.
  io.close(() => {
    process.exit(0);
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
