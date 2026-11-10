require("dotenv").config();

const { Server } = require("socket.io");

const logger = require("../utils/logger");
const { registerMarketNamespace } = require("./marketNamespace");
const { registerTradingNamespace } = require("./tradingNamespace");

const DEFAULT_CORS_ORIGIN = "http://localhost:3000";

/**
 * Turn a comma-separated origin list into the array Socket.IO expects.
 *
 * The HTTP app already reads `CORS_ORIGIN`; `ALLOWED_ORIGINS` is accepted as a
 * fallback so the value described in `docs/REALTIME.md` keeps working.
 */
function parseOrigins(value) {
  return String(value || DEFAULT_CORS_ORIGIN)
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function resolveCorsOrigins() {
  return parseOrigins(
    process.env.CORS_ORIGIN || process.env.ALLOWED_ORIGINS,
  );
}

/**
 * Attach a Socket.IO server to an existing `http.Server`.
 *
 * The HTTP server is passed in instead of created here so `src/server.js` owns
 * the listening lifecycle and tests can bind an ephemeral port. Calling
 * `listen` inside this module would make every test that imports the app hang
 * on an open handle.
 */
function createSocketServer(httpServer, options = {}) {
  if (!httpServer) {
    throw new TypeError(
      "createSocketServer requires an http.Server instance.",
    );
  }

  const corsOrigins = options.corsOrigins || resolveCorsOrigins();

  const io = new Server(httpServer, {
    cors: {
      origin: corsOrigins,
      credentials: true,
    },
    transports: ["websocket", "polling"],
  });

  io.on("connection", (socket) => {
    logger.info("Socket connected", {
      socketId: socket.id,
      namespace: socket.nsp.name,
    });

    socket.on("disconnect", (reason) => {
      logger.info("Socket disconnected", {
        socketId: socket.id,
        namespace: socket.nsp.name,
        reason,
      });
    });
  });

  registerTradingNamespace(io);

  const marketRooms = registerMarketNamespace(io, {
    priceSource: options.marketPriceSource,
    cache: options.marketCache,
    pollIntervalMs: options.marketPollIntervalMs,
  });

  logger.info("Socket.IO server attached", {
    corsOrigins,
  });

  return { io, marketRooms };
}

module.exports = {
  createSocketServer,
  parseOrigins,
  resolveCorsOrigins,
};
