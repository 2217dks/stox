const prisma = require("../config/database");
const logger = require("../utils/logger");

const MIN_RETENTION_DAYS = 1;
const MAX_RETENTION_DAYS = 3650; // 10 years, matches BullMQ payload schema
const DEFAULT_RETENTION_DAYS = 365;

function getEnvironmentRetentionDays() {
  const envVal = process.env.PORTFOLIO_SNAPSHOT_RETENTION_DAYS;
  if (envVal === undefined || envVal === null || String(envVal).trim() === "") {
    return DEFAULT_RETENTION_DAYS;
  }
  const parsed = Number(envVal);
  if (!Number.isInteger(parsed) || parsed < MIN_RETENTION_DAYS || parsed > MAX_RETENTION_DAYS) {
    throw new Error(
      `PORTFOLIO_SNAPSHOT_RETENTION_DAYS must be a positive integer between ${MIN_RETENTION_DAYS} and ${MAX_RETENTION_DAYS}.`,
    );
  }
  return parsed;
}

function validateRetentionDays(value) {
  if (value === undefined || value === null) {
    return getEnvironmentRetentionDays();
  }
  if (typeof value !== "number" && typeof value !== "string") {
    throw new Error("retentionDays must be a positive integer.");
  }
  if (typeof value === "string" && value.trim() === "") {
    throw new Error("retentionDays must be a positive integer.");
  }
  const num = Number(value);
  if (Number.isNaN(num) || !Number.isInteger(num)) {
    throw new Error(
      `retentionDays must be a positive integer between ${MIN_RETENTION_DAYS} and ${MAX_RETENTION_DAYS}.`,
    );
  }
  if (num < MIN_RETENTION_DAYS || num > MAX_RETENTION_DAYS) {
    throw new Error(
      `retentionDays must be a positive integer between ${MIN_RETENTION_DAYS} and ${MAX_RETENTION_DAYS}.`,
    );
  }
  return num;
}

function validateAsOfDate(asOf) {
  if (asOf === undefined || asOf === null) {
    return new Date();
  }
  if (asOf instanceof Date) {
    if (Number.isNaN(asOf.getTime())) {
      throw new Error("asOf must be a valid date.");
    }
    return asOf;
  }
  if (typeof asOf === "string" || typeof asOf === "number") {
    const parsed = new Date(asOf);
    if (Number.isNaN(parsed.getTime())) {
      throw new Error("asOf must be a valid date.");
    }
    return parsed;
  }
  throw new Error("asOf must be a valid date.");
}

/**
 * Prune historical PerformanceSnapshot records older than the retention threshold.
 *
 * Retention policy & invariants:
 * - Cadence & Retention: Snapshots older than `retentionDays` relative to `asOf` (in UTC)
 *   are safely pruned for inactive portfolios to keep the database bounded.
 * - ALL-Time Analytics Preservation: Historical snapshots of active portfolios are preserved
 *   to ensure ALL-time performance, time-weighted returns (TWR), and historical return series
 *   remain intact and consistent with contract guarantees.
 * - Idempotency: Multiple pruning runs with the same cutoff produce consistent, harmless results.
 *
 * @param {Object} [options]
 * @param {number|string} [options.retentionDays] - Number of days to retain (positive integer, max 3650)
 * @param {Date|string|number} [options.asOf] - Reference evaluation date
 * @param {boolean} [options.preserveActive=true] - Preserve historical snapshots for active portfolios
 * @param {string} [options.portfolioId] - Target specific portfolio UUID
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
  retentionDays,
  asOf,
  preserveActive = true,
  portfolioId,
  client = prisma,
} = {}) {
  const effectiveDays = validateRetentionDays(retentionDays);
  const refDate = validateAsOfDate(asOf);

  const cutoffDate = new Date(Date.UTC(
    refDate.getUTCFullYear(),
    refDate.getUTCMonth(),
    refDate.getUTCDate() - effectiveDays,
    0,
    0,
    0,
    0,
  ));

  const where = {
    snapshotDate: {
      lt: cutoffDate,
    },
  };

  if (preserveActive) {
    where.portfolio = {
      isActive: false,
    };
  }

  if (portfolioId) {
    where.portfolioId = portfolioId;
  }

  const result = await client.performanceSnapshot.deleteMany({
    where,
  });

  logger.info("Historical snapshot retention pruning completed", {
    cutoffDate: cutoffDate.toISOString().slice(0, 10),
    deletedCount: result.count,
    retentionDays: effectiveDays,
    preserveActive,
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
  MIN_RETENTION_DAYS,
  MAX_RETENTION_DAYS,
  DEFAULT_RETENTION_DAYS,
  getEnvironmentRetentionDays,
  validateRetentionDays,
  validateAsOfDate,
  pruneExpiredSnapshots,
};
