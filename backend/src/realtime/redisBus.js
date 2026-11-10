const Redis = require("ioredis");

const logger = require("../utils/logger");
const { EVENTS_CHANNEL } = require("./eventBus");

const DEFAULT_REDIS_URL = "redis://localhost:6379";

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
 */
function createRedisEventBus({
  url = process.env.REDIS_URL || DEFAULT_REDIS_URL,
  channel = EVENTS_CHANNEL,
  withSubscriber = true,
} = {}) {
  const publisher = new Redis(url, clientOptions());

  publisher.on("error", (error) => {
    logger.warn("Realtime publisher unavailable", {
      message: error.message,
    });
  });

  let subscriber = null;
  const handlers = new Set();

  async function ensurePublisher() {
    if (publisher.status === "wait") {
      await publisher.connect();
    }
  }

  async function publish(message) {
    await ensurePublisher();
    await publisher.publish(channel, JSON.stringify(message));
  }

  async function subscribe(handler) {
    if (!withSubscriber) {
      throw new Error("This realtime bus is publisher-only.");
    }

    handlers.add(handler);

    if (!subscriber) {
      subscriber = publisher.duplicate();
      subscriber.on("error", (error) => {
        logger.warn("Realtime subscriber unavailable", {
          message: error.message,
        });
      });

      // The client is created with `lazyConnect` and no offline queue, so a
      // command issued while it is still "waiting" is rejected instead of
      // buffered. Connect explicitly before entering subscriber mode.
      if (subscriber.status === "wait") {
        await subscriber.connect();
      }

      // Attach the message listener before SUBSCRIBE resolves; otherwise a
      // message published in that window would be dropped.
      subscriber.on("message", (incomingChannel, raw) => {
        if (incomingChannel !== channel) {
          return;
        }

        let message;

        try {
          message = JSON.parse(raw);
        } catch (error) {
          logger.warn("Realtime message ignored", {
            message: error.message,
          });
          return;
        }

        for (const current of handlers) {
          Promise.resolve(current(message)).catch((error) => {
            logger.warn("Realtime handler failed", {
              message: error.message,
            });
          });
        }
      });

      await subscriber.subscribe(channel);
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
      logger.warn(`${label} shutdown failed`, {
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
    handlers.clear();

    await shutdownClient(subscriber, "Realtime subscriber");
    subscriber = null;

    await shutdownClient(publisher, "Realtime publisher");
  }

  return { publish, subscribe, close };
}

module.exports = {
  createRedisEventBus,
};
