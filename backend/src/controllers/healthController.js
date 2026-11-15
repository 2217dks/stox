const prisma = require("../config/database");
const { registry } = require("../observability/metrics");

async function check(req, res, next) {
  try {
    const startedAt = Date.now();

    await prisma.$queryRaw`SELECT 1`;

    const dbLatencyMs = Date.now() - startedAt;

    // Health probes are the only regular database touchpoint every deployment
    // has, so they double as the cheapest DB latency/availability signal.
    registry.observe("db_query_duration_seconds", dbLatencyMs / 1000);
    registry.set("db_up", 1);

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
    registry.set("db_up", 0);

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
