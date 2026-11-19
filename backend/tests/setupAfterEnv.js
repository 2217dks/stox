const http = require("http");
const https = require("https");
const { disconnectRedis } = require("../src/config/redis");
const { closeQueues } = require("../src/queues");
const prisma = require("../src/config/database");

jest.setTimeout(15000);

afterAll(async () => {
  try {
    await closeQueues();
  } catch (_) {}
  try {
    await disconnectRedis();
  } catch (_) {}
  try {
    if (prisma && typeof prisma.$disconnect === "function") {
      await prisma.$disconnect();
    }
  } catch (_) {}
  if (http && http.globalAgent && typeof http.globalAgent.destroy === "function") {
    http.globalAgent.destroy();
  }
  if (https && https.globalAgent && typeof https.globalAgent.destroy === "function") {
    https.globalAgent.destroy();
  }
});

