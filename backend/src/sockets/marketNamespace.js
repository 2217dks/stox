const logger = require("../utils/logger");
const { handleEvent, reply } = require("./socketHandlers");
const { createMarketRoomRegistry } = require("./marketRooms");

/**
 * `/market` is public: market data is not user-scoped, so anonymous clients may
 * subscribe. Personal channels live on `/trading` and `/notifications`, which
 * require the authenticated handshake.
 */
function registerMarketNamespace(io, options = {}) {
  const namespace = io.of("/market");
  const rooms = createMarketRoomRegistry({ io, ...options });

  namespace.on("connection", (socket) => {
    logger.info("Market socket connected", {
      socketId: socket.id,
    });

    handleEvent(socket, "subscribe", async (currentSocket, payload, ack) => {
      const result = await rooms.subscribe(currentSocket, payload);
      reply(ack, result);
    });

    handleEvent(socket, "unsubscribe", async (currentSocket, payload, ack) => {
      const result = await rooms.unsubscribe(currentSocket, payload);
      reply(ack, result);
    });

    socket.on("disconnect", (reason) => {
      rooms.removeSocket(socket.id);

      logger.info("Market socket disconnected", {
        socketId: socket.id,
        reason,
      });
    });
  });

  return rooms;
}

module.exports = {
  registerMarketNamespace,
};
