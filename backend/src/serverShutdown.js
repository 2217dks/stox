const logger = require("./utils/logger");

/**
 * Close Socket.IO (which owns the HTTP server once attached) and resolve when
 * the callback fires. `io.close()` immediately stops accepting new connections
 * and disconnects clients, while the callback waits for the listening socket to
 * finish closing.
 */
function closeSocketServer(io) {
  if (!io || typeof io.close !== "function") {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    try {
      io.close(() => resolve());
    } catch (error) {
      resolve();
    }
  });
}

/**
 * Build an idempotent, asynchronous shutdown handler.
 *
 * The order matters: stop accepting HTTP/socket traffic first, release the
 * market subscriptions and bridge retry timers, wait for the HTTP server to
 * close, then close Redis. The process only exits after every cleanup step has
 * settled, so `quit()` cannot race a hard `process.exit`.
 *
 * `exit` is injectable so the lifecycle can be unit tested without terminating
 * the Jest worker.
 */
function createShutdown({
  io,
  marketRooms,
  realtimeBridge,
  eventBus,
  logger: log = logger,
  exit = (code) => process.exit(code),
} = {}) {
  let shutdownPromise = null;

  return function shutdown(signal) {
    if (shutdownPromise) {
      return shutdownPromise;
    }

    shutdownPromise = (async () => {
      log.info(`Shutting down (${signal})`);

      // Start the HTTP/socket close first so no new work is accepted while the
      // remaining resources are being released.
      const serverClosed = closeSocketServer(io);

      try {
        await marketRooms?.stop?.();
      } catch (error) {
        log.warn("Market room shutdown failed", {
          message: error.message,
        });
      }

      try {
        await realtimeBridge?.stop?.();

        if (realtimeBridge?.ready) {
          await Promise.resolve(realtimeBridge.ready).catch(() => {});
        }
      } catch (error) {
        log.warn("Realtime bridge shutdown failed", {
          message: error.message,
        });
      }

      await serverClosed;

      try {
        await eventBus?.close?.();
      } catch (error) {
        log.warn("Realtime bus shutdown failed", {
          message: error.message,
        });
      }

      log.info("Shutdown complete");

      exit(0);
    })();

    return shutdownPromise;
  };
}

module.exports = {
  createShutdown,
  closeSocketServer,
};
