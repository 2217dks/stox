const prisma = require("../config/database");

async function check(req, res, next) {
  try {
    const startedAt = Date.now();

    await prisma.$queryRaw`SELECT 1`;

    const dbLatencyMs = Date.now() - startedAt;

    return res.status(200).json({
      success: true,
      data: {
        status: "ok",
        database: "connected",
        dbLatencyMs,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    return res.status(503).json({
      success: false,
      data: {
        status: "degraded",
        database: "unreachable",
        timestamp: new Date().toISOString(),
      },
    });
  }
}

module.exports = { check };
