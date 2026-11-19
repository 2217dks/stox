const http = require("http");
const https = require("https");
const prisma = require("../src/config/database");
const { disconnectRedis } = require("../src/config/redis");
const { closeQueues } = require("../src/queues");

module.exports = async function globalTeardown() {
  try {
    await closeQueues();
  } catch (err) {
    console.error("Global teardown closeQueues error:", err.message);
  }

  try {
    await disconnectRedis();
  } catch (err) {
    console.error("Global teardown disconnectRedis error:", err.message);
  }

  try {
    if (prisma && typeof prisma.$disconnect === "function") {
      await prisma.$disconnect();
    }
  } catch (err) {
    console.error("Global teardown prisma.$disconnect error:", err.message);
  }

  try {
    if (prisma?._pool && typeof prisma._pool.end === "function") {
      await prisma._pool.end();
    }
  } catch (err) {
    console.error("Global teardown pool.end error:", err.message);
  }

  if (http?.globalAgent?.destroy) {
    http.globalAgent.destroy();
  }
  if (https?.globalAgent?.destroy) {
    https.globalAgent.destroy();
  }
};
