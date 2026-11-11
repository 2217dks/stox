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

async function disconnectRedis() {
  if (redis.status === "wait" || redis.status === "end") {
    return;
  }

  await redis.quit();
}

module.exports = {
  redis,
  getRedis,
  disconnectRedis,
};
