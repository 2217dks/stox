require("dotenv").config();

const Redis = require("ioredis");
const logger = require("../utils/logger");

const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379", {
  lazyConnect: true,
  maxRetriesPerRequest: 1,
  enableOfflineQueue: false,
});

redis.on("error", (error) => {
  logger.warn("Redis unavailable", {
    message: error.message,
  });
});

async function getRedis() {
  if (redis.status === "wait") {
    await redis.connect();
  }

  return redis;
}

let disconnectPromise = null;

/**
 * Disconnect the shared Redis client exactly once.
 *
 * Jest suites can call this from their own `afterAll` while a global
 * `setupFilesAfterEnv` hook calls it as well. Two concurrent `quit()` calls
 * race: the second is rejected by ioredis with "Connection is closed." and
 * marks the suite as failed. Sharing one in-flight promise makes cleanup
 * idempotent and safe from either order.
 */
async function disconnectRedis() {
  if (redis.status === "end") {
    return;
  }

  if (disconnectPromise) {
    return disconnectPromise;
  }

  disconnectPromise = (async () => {
    try {
      if (redis.status === "ready") {
        await redis.quit();
      } else {
        // `quit()` on a lazy/connecting client would open a connection just to
        // close it. For every non-ready state the immediate close is correct.
        redis.disconnect();
      }
    } catch (error) {
      // A concurrent shutdown may have closed the socket before this command
      // completed. Treat an already-ended connection as success.
      if (redis.status !== "end") {
        redis.disconnect();
      }
    }
  })();

  try {
    await disconnectPromise;
  } finally {
    disconnectPromise = null;
  }

  await redis.quit();
}

module.exports = {
  redis,
  getRedis,
  disconnectRedis,
};
