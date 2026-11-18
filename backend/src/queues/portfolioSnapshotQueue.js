const { z } = require("zod");

const { getQueue } = require("./index");
const {
  QUEUE_NAMES,
  SNAPSHOT_JOB_NAMES,
  jobOptionsFor,
} = require("./definitions");
const { enqueue, parsePayload } = require("./enqueue");
const { listFailedJobs, retryFailedJob } = require("./failedJobs");
const logger = require("../utils/logger");

const DEFAULT_SNAPSHOT_CRON = process.env.PORTFOLIO_SNAPSHOT_CRON || "0 1 * * *";
const DEFAULT_SNAPSHOT_TZ = process.env.PORTFOLIO_SNAPSHOT_TZ || "UTC";
const DEFAULT_RETENTION_CRON = process.env.SNAPSHOT_RETENTION_CRON || "0 3 * * *";

const generatePortfolioSnapshotsPayloadSchema = z.object({
  targetDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "targetDate must be in YYYY-MM-DD format.")
    .optional(),
  force: z.boolean().optional().default(false),
  portfolioIds: z
    .array(z.string().uuid("portfolioId must be a valid UUID."))
    .optional(),
});

const pruneSnapshotRetentionPayloadSchema = z.object({
  retentionDays: z.number().int().min(1).max(3650).optional(),
});

/**
 * Enqueue a daily portfolio snapshot generation job.
 *
 * Deduplication & Idempotency:
 * - If targetDate is specified and force is false, jobId = "snapshots:${targetDate}".
 * - If already waiting or active, BullMQ deduplicates by jobId.
 *
 * @param {Object} [payload]
 * @returns {Promise<Object>}
 */
async function enqueuePortfolioSnapshotGeneration(payload = {}) {
  const data = parsePayload(generatePortfolioSnapshotsPayloadSchema, payload);

  const jobId = !data.force && data.targetDate
    ? `snapshots:${data.targetDate}`
    : undefined;

  return enqueue(
    QUEUE_NAMES.SNAPSHOTS,
    SNAPSHOT_JOB_NAMES.GENERATE_PORTFOLIO_SNAPSHOTS,
    data,
    jobId ? { jobId } : {},
  );
}

/**
 * Enqueue snapshot retention pruning job.
 *
 * @param {Object} [payload]
 * @returns {Promise<Object>}
 */
async function enqueueSnapshotRetentionPrune(payload = {}) {
  const data = parsePayload(pruneSnapshotRetentionPayloadSchema, payload);

  return enqueue(
    QUEUE_NAMES.SNAPSHOTS,
    SNAPSHOT_JOB_NAMES.PRUNE_SNAPSHOT_RETENTION,
    data,
  );
}

/**
 * Register repeatable daily portfolio snapshot generation scheduler in BullMQ.
 *
 * Default cadence: 01:00 UTC every day ("0 1 * * *"), strictly within the allowable
 * 00:00 - 02:00 UTC settlement window for prior completed day close.
 *
 * @param {Object} [options]
 * @param {string} [options.cron] - Cron pattern (default: "0 1 * * *")
 * @param {number} [options.every] - Interval in milliseconds (alternative to cron)
 * @param {string} [options.tz="UTC"] - Timezone (default: "UTC")
 * @returns {Promise<{ scheduled: boolean, jobId?: string, reason?: string }>}
 */
async function ensurePortfolioSnapshotScheduler({
  cron = DEFAULT_SNAPSHOT_CRON,
  every,
  tz = DEFAULT_SNAPSHOT_TZ,
  ...payload
} = {}) {
  const queue = getQueue(QUEUE_NAMES.SNAPSHOTS);

  if (!queue) {
    return { scheduled: false, reason: "QUEUES_DISABLED" };
  }

  try {
    const data = parsePayload(generatePortfolioSnapshotsPayloadSchema, payload);

    const scheduleOpts = every ? { every } : { pattern: cron, tz };

    const job = await queue.upsertJobScheduler(
      "snapshots:daily-generate",
      scheduleOpts,
      {
        name: SNAPSHOT_JOB_NAMES.GENERATE_PORTFOLIO_SNAPSHOTS,
        data,
        opts: jobOptionsFor(
          QUEUE_NAMES.SNAPSHOTS,
          SNAPSHOT_JOB_NAMES.GENERATE_PORTFOLIO_SNAPSHOTS,
        ),
      },
    );

    return { scheduled: true, jobId: job?.id ?? null };
  } catch (error) {
    logger.error("Portfolio snapshot scheduler registration failed", {
      queue: QUEUE_NAMES.SNAPSHOTS,
      message: error.message,
    });

    return { scheduled: false, reason: "SCHEDULE_FAILED" };
  }
}

/**
 * Register repeatable snapshot retention pruning scheduler in BullMQ.
 *
 * Default cadence: 03:00 UTC every day ("0 3 * * *").
 *
 * @param {Object} [options]
 * @param {string} [options.cron]
 * @param {number} [options.every]
 * @param {string} [options.tz="UTC"]
 * @returns {Promise<{ scheduled: boolean, jobId?: string, reason?: string }>}
 */
async function ensureSnapshotRetentionScheduler({
  cron = DEFAULT_RETENTION_CRON,
  every,
  tz = DEFAULT_SNAPSHOT_TZ,
  ...payload
} = {}) {
  const queue = getQueue(QUEUE_NAMES.SNAPSHOTS);

  if (!queue) {
    return { scheduled: false, reason: "QUEUES_DISABLED" };
  }

  try {
    const data = parsePayload(pruneSnapshotRetentionPayloadSchema, payload);

    const scheduleOpts = every ? { every } : { pattern: cron, tz };

    const job = await queue.upsertJobScheduler(
      "snapshots:retention-prune",
      scheduleOpts,
      {
        name: SNAPSHOT_JOB_NAMES.PRUNE_SNAPSHOT_RETENTION,
        data,
        opts: jobOptionsFor(
          QUEUE_NAMES.SNAPSHOTS,
          SNAPSHOT_JOB_NAMES.PRUNE_SNAPSHOT_RETENTION,
        ),
      },
    );

    return { scheduled: true, jobId: job?.id ?? null };
  } catch (error) {
    logger.error("Snapshot retention scheduler registration failed", {
      queue: QUEUE_NAMES.SNAPSHOTS,
      message: error.message,
    });

    return { scheduled: false, reason: "SCHEDULE_FAILED" };
  }
}

async function listFailedSnapshotJobs({ start = 0, end = 49 } = {}) {
  return listFailedJobs(QUEUE_NAMES.SNAPSHOTS, { start, end });
}

async function retryFailedSnapshotJob(jobId) {
  return retryFailedJob(QUEUE_NAMES.SNAPSHOTS, jobId);
}

module.exports = {
  DEFAULT_SNAPSHOT_CRON,
  DEFAULT_SNAPSHOT_TZ,
  DEFAULT_RETENTION_CRON,
  generatePortfolioSnapshotsPayloadSchema,
  pruneSnapshotRetentionPayloadSchema,
  enqueuePortfolioSnapshotGeneration,
  enqueueSnapshotRetentionPrune,
  ensurePortfolioSnapshotScheduler,
  ensureSnapshotRetentionScheduler,
  listFailedSnapshotJobs,
  retryFailedSnapshotJob,
};
