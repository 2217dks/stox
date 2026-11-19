const { disconnectRedis } = require("../src/config/redis");
const { closeQueues } = require("../src/queues");
const prisma = require("../src/config/database");

jest.setTimeout(15000);

afterAll(async () => {
  const errors = [];

  try {
    await closeQueues();
  } catch (err) {
    errors.push(err);
    console.error("CRITICAL: Failed to close queues during Jest teardown:", err);
  }

  try {
    await disconnectRedis();
  } catch (err) {
    errors.push(err);
    console.error("CRITICAL: Failed to disconnect Redis during Jest teardown:", err);
  }

  try {
    if (prisma && typeof prisma.$disconnect === "function") {
      await prisma.$disconnect();
    }
  } catch (err) {
    errors.push(err);
    console.error("CRITICAL: Failed to disconnect Prisma during Jest teardown:", err);
  }

  process.env.QUEUES_ENABLED = "false";

  if (errors.length > 0) {
    throw new Error(
      `Jest teardown encountered ${errors.length} error(s):\n${errors.map((e) => e.message || String(e)).join("\n")}`,
    );
  }
});
