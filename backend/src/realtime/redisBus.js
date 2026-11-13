const Redis = require("ioredis");

const logger = require("../utils/logger");
const { EVENTS_CHANNEL } = require("./eventBus");

const DEFAULT_REDIS_URL = "redis://localhost:6379";
const DEFAULT_READY_TIMEOUT_MS = 5000;

function clientOptions() {
  return {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
  };
}

/**
 * Redis-backed bus for the API process (publisher + subscriber) and the worker
 * process (publisher only).
 *
 * Pub/sub needs a dedicated subscriber connection: once a client enters
 * subscriber mode it cannot run normal commands, so the subscriber is a
 * duplicate of the publisher rather than the publisher itself.
 *
 * The subscriber is deliberately reconnect-aware. ioredis reconnects in the
 * background, but a failed initial `connect()` rejects the first `subscribe()`
 * call. Retaining the handler set and resubscribing on every `ready` event lets
 * the bridge retry without duplicating handlers or deliveries.
 */
function createRedisEventBus({
  url = process.env.REDIS_URL || DEFAULT_REDIS_URL,
  channel = EVENTS_CHANNEL,
  withSubscriber = true,
  redisFactory = (redisUrl, options) => new Redis(redisUrl, options),
  logger: log = logger,
  readyTimeoutMs = DEFAULT_READY_TIMEOUT_MS,
} = {}) {
  const publisher = redisFactory(url, clientOptions());

  let subscriber = null;
  let subscribed = false;
  let subscribing = null;
  let closed = false;
  let lastError = null;
  let lastReadyAt = null;

  const handlers = new Set();

  publisher.on("error", (error) => {
    lastError = error.message;
    log.warn("Realtime publisher unavailable", {
      message: error.message,
    });
  });

  function waitForReady(client) {
    if (client.status === "ready") {
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      let timer;

      function cleanup() {
        clearTimeout(timer);
        client.removeListener("ready", onReady);
        client.removeListener("end", onEnd);
      }

      function onReady() {
        cleanup();
        resolve();
      }

      function onEnd() {
        cleanup();
        reject(new Error("Redis subscriber connection ended."));
      }

      timer = setTimeout(() => {
        cleanup();
        reject(new Error("Redis subscriber did not become ready in time."));
      }, readyTimeoutMs);

      if (typeof timer.unref === "function") {
        timer.unref();
      }

      client.once("ready", onReady);
      client.once("end", onEnd);
    });
  }

  function handleMessage(incomingChannel, raw) {
    if (incomingChannel !== channel) {
      return;
    }

    let message;

    try {
      message = JSON.parse(raw);
    } catch (error) {
      lastError = error.message;
      log.warn("Realtime message ignored", {
        message: error.message,
      });
      return;
    }

    for (const current of handlers) {
      Promise.resolve(current(message)).catch((error) => {
        lastError = error.message;
        log.warn("Realtime handler failed", {
          message: error.message,
        });
      });
    }
  }

  function createSubscriber() {
    subscriber = publisher.duplicate();

    subscriber.on("error", (error) => {
      lastError = error.message;
      log.warn("Realtime subscriber unavailable", {
        message: error.message,
      });
    });

    // Attach the message listener exactly once. Every reconnect must reuse this
    // listener; adding another one would deliver each event twice.
    subscriber.on("message", handleMessage);

    subscriber.on("close", () => {
      subscribed = false;
    });

    subscriber.on("end", () => {
      subscribed = false;
    });

    subscriber.on("ready", () => {
      lastReadyAt = new Date();
      subscribed = false;

      if (closed || handlers.size === 0) {
        return;
      }

      // ioredis resubscribes automatically, but doing it explicitly makes the
      // restored channel observable and covers clients that lose subscription
      // state during reconnection. SUBSCRIBE is idempotent per channel.
      subscribeChannel().catch((error) => {
        lastError = error.message;
        log.warn("Realtime subscriber re-subscribe failed", {
          message: error.message,
        });
      });
    });

    return subscriber;
  }

  async function subscribeChannel() {
    if (closed) {
      throw new Error("This realtime bus is closed.");
    }

    if (subscribed && subscriber?.status === "ready") {
      return;
    }

    if (subscribing) {
      return subscribing;
    }

    // Start the actual work in a microtask so the single-flight marker is
    // assigned before `connect()`. ioredis emits `ready` synchronously from
    // connect, and the ready handler calls this function again; without this
    // ordering a second SUBSCRIBE could slip through.
    subscribing = Promise.resolve().then(async () => {
      if (!subscriber) {
        createSubscriber();
      }

      // The client is created with `lazyConnect` and no offline queue, so a
      // command issued while it is still "waiting" is rejected instead of
      // buffered. Connect explicitly before entering subscriber mode.
      if (subscriber.status === "wait" || subscriber.status === "end") {
        await subscriber.connect();
      }

      if (subscriber.status !== "ready") {
        await waitForReady(subscriber);
      }

      await subscriber.subscribe(channel);

      if (!closed) {
        subscribed = true;
        lastError = null;
      }
    });

    try {
      await subscribing;
    } finally {
      subscribing = null;
    }
  }

  async function ensurePublisher() {
    if (closed) {
      throw new Error("This realtime bus is closed.");
    }

    if (publisher.status === "wait" || publisher.status === "end") {
      await publisher.connect();
    }
  }

  async function publish(message) {
    if (closed) {
      throw new Error("This realtime bus is closed.");
    }

    await ensurePublisher();
    await publisher.publish(channel, JSON.stringify(message));
  }

  async function subscribe(handler) {
    if (!withSubscriber) {
      throw new Error("This realtime bus is publisher-only.");
    }

    if (closed) {
      throw new Error("This realtime bus is closed.");
    }

    if (typeof handler !== "function") {
      throw new TypeError("A realtime subscriber handler is required.");
    }

    if (handlers.has(handler)) {
      // A retry (for example after the initial connection failed) must reuse
      // the same handler. The Set keeps one registration and the channel
      // subscription is idempotent.
      await subscribeChannel();
      return () => {
        handlers.delete(handler);
      };
    }

    handlers.add(handler);

    try {
      await subscribeChannel();
    } catch (error) {
      // Keep the handler registered so the bridge can retry with the same
      // function reference instead of registering a duplicate.
      lastError = error.message;
      throw error;
    }

    return () => {
      handlers.delete(handler);
    };
  }

  /**
   * Close a client without turning shutdown into another command.
   *
   * `quit()` on a lazy/never-connected client tries to open a connection just
   * to say goodbye, which fails with offline queueing disabled and can leave a
   * reconnect timer behind. `disconnect()` is the correct immediate close for
   * every state except a fully connected client.
   */
  async function shutdownClient(client, label) {
    if (!client) {
      return;
    }

    try {
      if (client.status === "ready") {
        await client.quit();
      } else {
        client.disconnect();
      }
    } catch (error) {
      log.warn(`${label} shutdown failed`, {
        message: error.message,
      });

      try {
        client.disconnect();
      } catch (disconnectError) {
        // Already closed.
      }
    }
  }

  async function close() {
    closed = true;
    subscribed = false;
    handlers.clear();

    await shutdownClient(subscriber, "Realtime subscriber");
    subscriber = null;

    await shutdownClient(publisher, "Realtime publisher");
  }

  function connectionState() {
    return {
      publisher: publisher.status,
      subscriber: subscriber ? subscriber.status : "not_created",
      subscribed,
      handlerCount: handlers.size,
      lastError,
      lastReadyAt,
    };
  }

  return { publish, subscribe, close, connectionState };
}

module.exports = {
  createRedisEventBus,
};
