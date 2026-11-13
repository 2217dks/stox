const { io: createClient } = require("socket.io-client");

const DEFAULT_CONNECT_TIMEOUT_MS = 5000;
const DEFAULT_ACK_TIMEOUT_MS = 3000;
const DEFAULT_EVENT_TIMEOUT_MS = 5000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Bind an already-created http.Server to an ephemeral loopback port.
 *
 * Tests run against a real listening socket so the Socket.IO client exercises
 * the same handshake and transport path as a browser would.
 */
function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

/**
 * Connect a Socket.IO client and resolve only once the namespace handshake has
 * completed. `connect_error` rejects so authentication failures stay visible.
 */
function connectSocket(baseUrl, namespace = "", options = {}) {
  const {
    connectTimeoutMs = DEFAULT_CONNECT_TIMEOUT_MS,
    ...socketOptions
  } = options;

  const client = createClient(`${baseUrl}${namespace}`, {
    transports: ["websocket"],
    reconnection: false,
    forceNew: true,
    ...socketOptions,
  });

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      client.close();
      reject(
        new Error(
          `Socket "${namespace || "/"}" did not connect within ${connectTimeoutMs}ms.`,
        ),
      );
    }, connectTimeoutMs);

    client.once("connect", () => {
      clearTimeout(timer);
      resolve(client);
    });

    client.once("connect_error", (error) => {
      clearTimeout(timer);
      client.close();
      reject(error);
    });
  });
}

/**
 * Emit a client event and wait for its acknowledgement. A missing ack rejects
 * instead of silently returning a placeholder, so a broken handler is loud.
 */
function emitWithAck(client, event, payload, timeoutMs = DEFAULT_ACK_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`No acknowledgement for "${event}" within ${timeoutMs}ms.`));
    }, timeoutMs);

    client.emit(event, payload, (ack) => {
      clearTimeout(timer);
      resolve(ack);
    });
  });
}

/**
 * Resolve with the first event payload matching `predicate`.
 *
 * Predicates keep tests robust when a socket has joined several rooms: events
 * from earlier subscriptions cannot satisfy a later assertion. Timeouts reject
 * with the event name so a missing broadcast is diagnosable.
 */
function waitForEvent(
  client,
  event,
  { predicate = () => true, timeoutMs = DEFAULT_EVENT_TIMEOUT_MS, description } = {},
) {
  return new Promise((resolve, reject) => {
    let timer;

    const finish = () => {
      clearTimeout(timer);
      client.off(event, handler);
    };

    const handler = (payload) => {
      let matches;

      try {
        matches = predicate(payload);
      } catch (error) {
        finish();
        reject(error);
        return;
      }

      if (matches) {
        finish();
        resolve(payload);
      }
    };

    timer = setTimeout(() => {
      finish();
      reject(
        new Error(
          `Timed out after ${timeoutMs}ms waiting for "${event}"${
            description ? ` (${description})` : ""
          }.`,
        ),
      );
    }, timeoutMs);

    client.on(event, handler);
  });
}

/**
 * Collect every event received during a fixed window. Used for negative
 * assertions ("this client must not receive anything").
 */
function collectEvents(client, event, durationMs) {
  return new Promise((resolve) => {
    const events = [];
    const handler = (payload) => events.push(payload);

    client.on(event, handler);

    setTimeout(() => {
      client.off(event, handler);
      resolve(events);
    }, durationMs);
  });
}

/**
 * Poll an asynchronous condition. Retries replace fixed sleeps in places where
 * the exact scheduling (WebSocket handshake, Redis pub/sub) is not observable.
 */
async function waitFor(
  condition,
  { timeoutMs = 5000, intervalMs = 10, description = "condition" } = {},
) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const value = await condition();

    if (value) {
      return value;
    }

    await sleep(intervalMs);
  }

  throw new Error(`Timed out after ${timeoutMs}ms waiting for ${description}.`);
}

const silentLogger = {
  info() {},
  warn() {},
  error() {},
  debug() {},
};

module.exports = {
  collectEvents,
  connectSocket,
  emitWithAck,
  listen,
  silentLogger,
  sleep,
  waitFor,
  waitForEvent,
};
