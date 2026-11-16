const DEFAULT_PING_INTERVAL_MS = 25000;
const DEFAULT_PING_TIMEOUT_MS = 20000;

function readPositiveInteger(value, fallback) {
  const number = Number(value);

  return Number.isInteger(number) && number > 0 ? number : fallback;
}

/**
 * Resolve Socket.IO heartbeat timings.
 *
 * Socket.IO already disconnects an unresponsive client: it emits a ping every
 * `pingInterval` and closes the connection when no pong arrives within
 * `pingTimeout`. Making both values explicit and configurable lets deployments
 * tune them for their proxy idle timeouts without patching the server setup.
 *
 * Invalid, zero, negative, and non-numeric values fall back to the defaults so
 * a typo in the environment cannot disable the heartbeat.
 */
function resolveSocketTiming(env = process.env) {
  return {
    pingInterval: readPositiveInteger(
      env.SOCKET_PING_INTERVAL_MS,
      DEFAULT_PING_INTERVAL_MS,
    ),
    pingTimeout: readPositiveInteger(
      env.SOCKET_PING_TIMEOUT_MS,
      DEFAULT_PING_TIMEOUT_MS,
    ),
  };
}

module.exports = {
  DEFAULT_PING_INTERVAL_MS,
  DEFAULT_PING_TIMEOUT_MS,
  resolveSocketTiming,
};
