const logger = require("../utils/logger");
const { authenticateSocket } = require("./auth");

const USER_ROOM_PREFIX = "user:";

function userRoom(userId) {
  return `${USER_ROOM_PREFIX}${userId}`;
}

/**
 * `/notifications` carries one user's personal notifications.
 *
 * The room name is derived from the verified token, never from a client
 * payload. A socket therefore cannot ask to join another user's room, and the
 * bridge only emits to `user:{userId}` after validating that the room matches
 * the payload's user id.
 */
function registerNotificationsNamespace(io) {
  const namespace = io.of("/notifications");

  namespace.use(authenticateSocket);

  namespace.on("connection", (socket) => {
    const { userId } = socket.data.user;

    socket.join(userRoom(userId));

    logger.info("Notification socket connected", {
      socketId: socket.id,
      userId,
    });

    socket.on("disconnect", (reason) => {
      logger.info("Notification socket disconnected", {
        socketId: socket.id,
        userId,
        reason,
      });
    });
  });

  return namespace;
}

module.exports = {
  USER_ROOM_PREFIX,
  registerNotificationsNamespace,
  userRoom,
};
