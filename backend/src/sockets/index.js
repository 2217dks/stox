require("dotenv").config();

const { Server } = require("socket.io");

const logger = require("../utils/logger");
const marketDataService = require("../services/marketData");
const {
  createMarketStream,
} = require("../services/marketStreamService");
const {
  createPollingPriceStream,
} = require("../services/pollingPriceStream");
const { registerMarketNamespace } = require("./marketNamespace");
const { registerTradingNamespace } = require("./tradingNamespace");
const { registerNotificationsNamespace, userRoom } = require("./notificationsNamespace");
const {
  resolveSocketTiming,
} = require("../config/socketConfig");

const DEFAULT_CORS_ORIGIN = "http://localhost:3000";

let activeIo = null;

/**
 * WebSocket streaming is the default. `MARKET_STREAM_ENABLED=false` swaps in
 * the polling fallback, which is useful when the provider stream is blocked.
 */
function createDefaultPriceStream() {
  if (process.env.MARKET_STREAM_ENABLED === "false") {
    return createPollingPriceStream({ priceSource: marketDataService });
  }

  return createMarketStream();
}

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
  const timing = options.timing || resolveSocketTiming();

  const io = new Server(httpServer, {
    cors: {
      origin: corsOrigins,
      credentials: true,
    },
    transports: ["websocket", "polling"],
    pingInterval: timing.pingInterval,
    pingTimeout: timing.pingTimeout,
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
  registerNotificationsNamespace(io);

  const priceStream = options.marketPriceStream || createDefaultPriceStream();

  const marketRooms = registerMarketNamespace(io, {
    priceStream,
    cache: options.marketCache,
    maxSubscriptionsPerSocket: options.marketMaxSubscriptionsPerSocket,
    maxTotalSubscriptions: options.marketMaxTotalSubscriptions,
    subscriptionRateLimit: options.marketSubscriptionRateLimit,
    subscriptionRateWindowMs: options.marketSubscriptionRateWindowMs,
  });

  logger.info("Socket.IO server attached", {
    corsOrigins,
  });

  activeIo = io;

  // `priceStream` is exposed so operational/debug handlers can read its
  // `getState()` snapshot without reaching into module internals.
  return { io, marketRooms, priceStream };
}

function getSocketServer() {
  return activeIo;
}

function setSocketServer(io) {
  activeIo = io;
}

async function disconnectUserSockets(userId, ioInstance = activeIo) {
  if (!ioInstance || !userId) {
    return;
  }

  const room = userRoom(userId);

  try {
    const tradingNsp = ioInstance.of("/trading");
    const notificationsNsp = ioInstance.of("/notifications");

    if (tradingNsp?.in) {
      tradingNsp.in(room).disconnectSockets(true);
    }
    if (notificationsNsp?.in) {
      notificationsNsp.in(room).disconnectSockets(true);
    }

    for (const nsp of [tradingNsp, notificationsNsp]) {
      if (nsp?.sockets?.values) {
        for (const socket of nsp.sockets.values()) {
          if (socket.data?.user?.userId === userId) {
            socket.disconnect(true);
          }
        }
      }
    }

    logger.info("Disconnected user sockets on suspension", { userId });
  } catch (error) {
    logger.warn("Failed disconnecting user sockets", {
      userId,
      error: error.message,
    });
  }
}

module.exports = {
  createSocketServer,
  disconnectUserSockets,
  getSocketServer,
  setSocketServer,
  userRoom,
  parseOrigins,
  resolveCorsOrigins,
  resolveSocketTiming,
};
