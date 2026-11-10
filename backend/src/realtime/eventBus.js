const logger = require("../utils/logger");

const EVENTS_CHANNEL = "stox:realtime:events";

let currentBus = null;

/**
 * Swap the process-wide realtime bus.
 *
 * The API process installs a Redis-backed bus at startup and the worker process
 * installs a publisher-only bus. Unit tests install an in-memory bus, and
 * anything that never configures one gets a no-op (so the financial path never
 * depends on Redis being up).
 */
function configureEventBus(bus) {
  currentBus = bus;
  return currentBus;
}

function getEventBus() {
  return currentBus;
}

function resetEventBus() {
  currentBus = null;
}

/**
 * Publish a realtime message. Delivery is best-effort by design: a notification
 * or price tick must never roll back a trade or fail a request.
 */
async function emitRealtimeEvent(message) {
  if (!currentBus) {
    return false;
  }

  try {
    await currentBus.publish(message);
    return true;
  } catch (error) {
    logger.warn("Realtime event publish failed", {
      namespace: message?.namespace,
      event: message?.event,
      message: error.message,
    });

    return false;
  }
}

/**
 * Process-local bus used by tests and as a safe fallback.
 *
 * `subscribe` returns an unsubscribe function so callers can tear down the
 * bridge without closing the whole bus.
 */
function createInMemoryEventBus() {
  const subscribers = new Set();

  return {
    async publish(message) {
      for (const subscriber of subscribers) {
        await subscriber(message);
      }
    },
    subscribe(handler) {
      subscribers.add(handler);

      return () => {
        subscribers.delete(handler);
      };
    },
    async close() {
      subscribers.clear();
    },
    subscriberCount() {
      return subscribers.size;
    },
  };
}

module.exports = {
  EVENTS_CHANNEL,
  configureEventBus,
  getEventBus,
  resetEventBus,
  emitRealtimeEvent,
  createInMemoryEventBus,
};
