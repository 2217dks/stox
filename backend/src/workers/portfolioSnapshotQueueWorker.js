const { Worker, UnrecoverableError } = require("bullmq");

const prisma = require("../config/database");
const {
  DEFAULT_SETTLEMENT_WINDOW_HOURS,
  toUtcDateString,
  getPreviousUtcDateString,
  getUtcEndOfDay,
  isWithinSettlementWindow,
  captureDailyPortfolioSnapshots,
} = require("./portfolioSnapshotWorker");
const { pruneExpiredSnapshots } = require("../services/snapshotRetentionService");
const { createQueueConnection } = require("../queues/connection");
const {
  QUEUE_NAMES,
  SNAPSHOT_JOB_NAMES,
} = require("../queues/definitions");
const { childLogger } = require("../utils/logger");
const { registry } = require("../observability/metrics");

const log = childLogger({
  queue: QUEUE_NAMES.SNAPSHOTS,
  worker: "snapshots",
});

const DEFAULT_CONCURRENCY = 1;

function readPositiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

/**
 * Handle generation of daily portfolio snapshots for active portfolios.
 *
 * Idempotency & Operational Visibility:
 * - Deduplication: If all active portfolios have recorded snapshots for the target date,
 *   skips execution cleanly without duplicate work.
 * - Settlement Window: Rejects capturing outside the settlement window (00:00 - 02:00 UTC)
 *   unless explicitly forced.
 * - Failure Recording: Records detailed failure reasons and throws an error if any portfolio
 *   fails so BullMQ can retry or retain the failure for operator visibility.
 */
async function handleGeneratePortfolioSnapshots(job, options = {}) {
  const { targetDate, force = false, portfolioIds = null } = job.data || {};
  const now = options.now ? options.now() : new Date();
  const client = options.client || prisma;
  const priceProvider = options.priceProvider || null;
  const settlementWindowHours = options.settlementWindowHours || DEFAULT_SETTLEMENT_WINDOW_HOURS;

  const targetDateStr = targetDate
    ? toUtcDateString(targetDate)
    : getPreviousUtcDateString(now);
  const endOfDayAsOf = getUtcEndOfDay(targetDateStr);
  const targetDateObj = new Date(`${targetDateStr}T00:00:00.000Z`);

  // 1. Inspect existing snapshot coverage for target date
  let activePortfolios = [];
  let existingSnapshots = [];

  try {
    const portfolioWhere = { isActive: true };
    if (Array.isArray(portfolioIds) && portfolioIds.length > 0) {
      portfolioWhere.id = { in: portfolioIds };
    }

    activePortfolios = await client.portfolio.findMany({
      where: portfolioWhere,
      select: { id: true },
    });

    if (activePortfolios.length > 0) {
      existingSnapshots = await client.performanceSnapshot.findMany({
        where: {
          snapshotDate: targetDateObj,
          portfolioId: { in: activePortfolios.map((p) => p.id) },
        },
        select: { portfolioId: true },
      });
    }
  } catch (err) {
    log.error(
      `Failed inspecting active portfolio snapshots for ${targetDateStr}: ${err.message}`,
    );
    throw err;
  }

  const existingSet = new Set(existingSnapshots.map((s) => s.portfolioId));
  const missingPortfolios = activePortfolios.filter((p) => !existingSet.has(p.id));

  // 2. Idempotency guard: skip if already fully captured
  if (!force && activePortfolios.length > 0 && missingPortfolios.length === 0) {
    log.info("Portfolio snapshot generation skipped: all portfolios already captured", {
      snapshotDate: targetDateStr,
      totalPortfolios: activePortfolios.length,
    });

    return {
      outcome: "skipped",
      reason: "ALL_PORTFOLIOS_ALREADY_CAPTURED",
      snapshotDate: targetDateStr,
      totalPortfolios: activePortfolios.length,
    };
  }

  // 3. Settlement window guardrail
  if (!force && !isWithinSettlementWindow(now, settlementWindowHours)) {
    log.warn(
      `Snapshot generation skipped outside settlement window for ${targetDateStr}. Missing: ${missingPortfolios.length}/${activePortfolios.length}`,
      {
        targetDate: targetDateStr,
        missingCount: missingPortfolios.length,
        totalCount: activePortfolios.length,
      },
    );

    return {
      outcome: "skipped",
      reason: "OUTSIDE_SETTLEMENT_WINDOW",
      targetDate: targetDateStr,
      missingPortfoliosCount: missingPortfolios.length,
      totalPortfolios: activePortfolios.length,
    };
  }

  // 4. Execute capture for missing active portfolios
  const missingIds = force
    ? activePortfolios.map((p) => p.id)
    : missingPortfolios.map((p) => p.id);

  const result = await captureDailyPortfolioSnapshots({
    targetDate: targetDateStr,
    asOf: endOfDayAsOf,
    portfolioIds: missingIds,
    force,
    priceProvider,
    client,
  });

  // 5. Operational visibility on partial or complete failure
  if (result.failed > 0) {
    log.error("Portfolio snapshot generation experienced failures", {
      snapshotDate: targetDateStr,
      failed: result.failed,
      errors: result.errors,
    });

    throw new Error(
      `Snapshot generation for ${targetDateStr} failed for ${result.failed}/${result.attempted} portfolios.`,
    );
  }

  return {
    outcome: "completed",
    ...result,
  };
}

/**
 * Handle historical snapshot retention pruning.
 */
async function handlePruneSnapshotRetention(job, options = {}) {
  const { retentionDays } = job.data || {};
  const client = options.client || prisma;
  const now = options.now ? options.now() : new Date();

  const result = await pruneExpiredSnapshots({
    retentionDays,
    asOf: now,
    client,
  });

  return {
    outcome: "completed",
    ...result,
  };
}

/**
 * Route snapshot BullMQ jobs to their corresponding processor.
 */
async function handleSnapshotJob(job, options = {}) {
  switch (job.name) {
    case SNAPSHOT_JOB_NAMES.GENERATE_PORTFOLIO_SNAPSHOTS:
      return handleGeneratePortfolioSnapshots(job, options);

    case SNAPSHOT_JOB_NAMES.PRUNE_SNAPSHOT_RETENTION:
      return handlePruneSnapshotRetention(job, options);

    default:
      throw new UnrecoverableError(`Unknown snapshot job "${job.name}".`);
  }
}

/**
 * Create BullMQ worker for the snapshot queue.
 */
function createPortfolioSnapshotQueueWorker({
  connection,
  concurrency = readPositiveInteger(
    process.env.QUEUE_SNAPSHOT_CONCURRENCY,
    DEFAULT_CONCURRENCY,
  ),
  client = prisma,
  priceProvider = null,
  now = () => new Date(),
  settlementWindowHours = DEFAULT_SETTLEMENT_WINDOW_HOURS,
  prefix = process.env.QUEUE_PREFIX || "stox",
} = {}) {
  const queueConnection = connection || createQueueConnection();

  const worker = new Worker(
    QUEUE_NAMES.SNAPSHOTS,
    (job) =>
      handleSnapshotJob(job, {
        client,
        priceProvider,
        now,
        settlementWindowHours,
      }),
    {
      connection: queueConnection,
      concurrency,
      prefix,
    },
  );

  worker.queueConnection = queueConnection;

  worker.on("completed", (job) => {
    registry.increment("queue_jobs_completed_total", {
      queue: QUEUE_NAMES.SNAPSHOTS,
      job: job.name,
    });

    log.info("Snapshot job completed", {
      jobId: job.id,
      jobName: job.name,
    });
  });

  worker.on("failed", (job, error) => {
    registry.increment("queue_jobs_failed_total", {
      queue: QUEUE_NAMES.SNAPSHOTS,
      job: job ? job.name : "unknown",
    });

    log.error("Snapshot job failed", {
      jobId: job ? job.id : null,
      jobName: job ? job.name : null,
      message: error.message,
    });
  });

  return worker;
}

module.exports = {
  createPortfolioSnapshotQueueWorker,
  handleSnapshotJob,
  handleGeneratePortfolioSnapshots,
  handlePruneSnapshotRetention,
};
