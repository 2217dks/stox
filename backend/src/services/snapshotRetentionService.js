const prisma = require("../config/database");
const logger = require("../utils/logger");

const DEFAULT_RETENTION_DAYS = Number(process.env.PORTFOLIO_SNAPSHOT_RETENTION_DAYS) || 365;

/**
 * Prune historical PerformanceSnapshot records older than the retention threshold.
 *
 * Retention policy:
 * - Cadence & Retention: Snapshots older than `retentionDays` relative to `asOf` (in UTC)
 *   are safely pruned to keep the database bounded while preserving necessary historical return data.
 * - Idempotency: Multiple pruning runs with the same cutoff produce consistent, harmless results.
 *
 * @param {Object} [options]
 * @param {number} [options.retentionDays] - Number of days to retain (default: 365)
 * @param {Date} [options.asOf] - Reference evaluation date
 * @param {Object} [options.client] - Prisma client override
 * @returns {Promise<{
 *   pruned: boolean,
 *   cutoffDate: string,
 *   deletedCount: number,
 *   retentionDays: number,
 *   asOf: string
 * }>}
 */
async function pruneExpiredSnapshots({
  retentionDays = DEFAULT_RETENTION_DAYS,
  asOf = new Date(),
  client = prisma,
} = {}) {
  const effectiveDays = Math.max(1, Number(retentionDays) || DEFAULT_RETENTION_DAYS);
  const refDate = asOf instanceof Date ? asOf : new Date(asOf);

  const cutoffDate = new Date(Date.UTC(
    refDate.getUTCFullYear(),
    refDate.getUTCMonth(),
    refDate.getUTCDate() - effectiveDays,
    0,
    0,
    0,
    0,
  ));

  const result = await client.performanceSnapshot.deleteMany({
    where: {
      snapshotDate: {
        lt: cutoffDate,
      },
    },
  });

  logger.info("Historical snapshot retention pruning completed", {
    cutoffDate: cutoffDate.toISOString().slice(0, 10),
    deletedCount: result.count,
    retentionDays: effectiveDays,
  });

  return {
    pruned: true,
    cutoffDate: cutoffDate.toISOString().slice(0, 10),
    deletedCount: result.count,
    retentionDays: effectiveDays,
    asOf: refDate.toISOString(),
  };
}

module.exports = {
  DEFAULT_RETENTION_DAYS,
  pruneExpiredSnapshots,
};
