const logger = require("../utils/logger");

/**
 * Send an acknowledgement when the client asked for one.
 *
 * Socket.IO passes the ack callback as the last handler argument; a client that
 * emits fire-and-forget must not crash the server, so it is optional.
 */
function reply(ack, result) {
  if (typeof ack === "function") {
    ack(result);
  }
}

/**
 * Wrap an async socket handler so a rejected promise becomes a predictable
 * ack instead of an unhandled rejection that can take down the process.
 */
function handleEvent(socket, event, handler) {
  socket.on(event, (payload, ack) => {
    Promise.resolve(handler(socket, payload, ack)).catch((error) => {
      logger.error("Socket handler failed", {
        event,
        socketId: socket.id,
        message: error.message,
      });

      reply(ack, {
        ok: false,
        code: "INTERNAL_SERVER_ERROR",
        message: "Unable to complete the request.",
      });
    });
  });
}

module.exports = {
  reply,
  handleEvent,
};
