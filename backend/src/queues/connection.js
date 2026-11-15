const IORedis = require("ioredis");

const logger = require("../utils/logger");

const DEFAULT_REDIS_URL = "redis://localhost:6379";

function resolveRedisUrl() {
  return process.env.REDIS_URL || DEFAULT_REDIS_URL;
}

/**
 * BullMQ requires `maxRetriesPerRequest: null`.
 *
 * The shared cache client (`src/config/redis.js`) uses `1` because a cache
 * miss must fail fast. Blocking queue commands (BRPOPLPUSH) must instead wait
 * indefinitely, so queues own a separate connection. Reusing the cache client
 * would make BullMQ throw at construction time.
 */
function createQueueConnection(overrides = {}) {
  const client = new IORedis(resolveRedisUrl(), {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    ...overrides,
  });

  client.on("error", (error) => {
    logger.warn("Queue Redis connection error", {
      message: error.message,
    });
  });

  return client;
}

module.exports = {
  DEFAULT_REDIS_URL,
  createQueueConnection,
  resolveRedisUrl,
};
