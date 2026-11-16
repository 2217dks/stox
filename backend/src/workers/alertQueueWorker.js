const { Worker, UnrecoverableError } = require("bullmq");

const marketDataService = require("../services/marketData");
const {
  evaluateAlertById,
  scanActiveAlerts,
} = require("../services/alertEvaluationService");
const { createQueueConnection } = require("../queues/connection");
const {
  QUEUE_NAMES,
  ALERT_JOB_NAMES,
} = require("../queues/definitions");
const { childLogger } = require("../utils/logger");
const { registry } = require("../observability/metrics");

const log = childLogger({
  queue: QUEUE_NAMES.ALERTS,
  worker: "alerts",
});

const DEFAULT_CONCURRENCY = 5;
const DEFAULT_BATCH_SIZE = 100;
const DEFAULT_MAX_SYMBOLS = 50;

function readPositiveInteger(value, fallback) {
  const number = Number(value);

  return Number.isInteger(number) && number > 0 ? number : fallback;
}

async function handleEvaluateAlert(job, options = {}) {
  const { alertId } = job.data;

  const result = await evaluateAlertById(alertId, {
    quoteProvider: options.quoteProvider,
    now: options.now,
  });

  // A deleted alert cannot be resurrected by a retry. A non-ACTIVE alert is a
  // normal no-op: another worker or the user already changed its state.
  if (result.outcome === "not_found") {
    throw new UnrecoverableError(`Alert ${alertId} no longer exists.`);
  }

  return result;
}

async function handleScanAlerts(job, options = {}) {
  const { symbol, limit } = job.data;

  return scanActiveAlerts(
    {
      symbol,
      limit: limit ?? options.batchSize,
      maxSymbols: options.maxSymbols,
    },
    {
      quoteProvider: options.quoteProvider,
      now: options.now,
    },
  );
}

/**
 * Route one BullMQ job to the matching processor.
 *
 * Exported separately from the Worker factory so routing and failure
 * classification can be unit tested without opening a Redis connection.
 */
async function handleAlertJob(job, options = {}) {
  switch (job.name) {
    case ALERT_JOB_NAMES.EVALUATE_ALERT:
      return handleEvaluateAlert(job, options);

    case ALERT_JOB_NAMES.SCAN_ALERTS:
      return handleScanAlerts(job, options);

    default:
      throw new UnrecoverableError(`Unknown alert job "${job.name}".`);
  }
}

function createAlertQueueWorker({
  connection,
  concurrency = readPositiveInteger(
    process.env.QUEUE_ALERT_CONCURRENCY,
    DEFAULT_CONCURRENCY,
  ),
  quoteProvider = marketDataService,
  now = () => new Date(),
  batchSize = readPositiveInteger(
    process.env.QUEUE_ALERT_BATCH_SIZE,
    DEFAULT_BATCH_SIZE,
  ),
  maxSymbols = readPositiveInteger(
    process.env.ALERT_SCAN_MAX_SYMBOLS,
    DEFAULT_MAX_SYMBOLS,
  ),
  prefix = process.env.QUEUE_PREFIX || "stox",
} = {}) {
  const queueConnection = connection || createQueueConnection();

  const worker = new Worker(
    QUEUE_NAMES.ALERTS,
    (job) => handleAlertJob(job, { quoteProvider, now, batchSize, maxSymbols }),
    {
      connection: queueConnection,
      concurrency,
      prefix,
    },
  );

  worker.queueConnection = queueConnection;

  worker.on("completed", (job) => {
    registry.increment("queue_jobs_completed_total", {
      queue: QUEUE_NAMES.ALERTS,
      job: job.name,
    });

    log.info("Queue job completed", {
      jobId: job.id,
      jobName: job.name,
      attemptsMade: job.attemptsMade,
      durationMs:
        job.finishedOn && job.processedOn
          ? job.finishedOn - job.processedOn
          : null,
    });
  });

  worker.on("failed", (job, error) => {
    const maxAttempts = job?.opts?.attempts ?? 1;
    const exhausted = Boolean(job) && job.attemptsMade >= maxAttempts;

    registry.increment("queue_jobs_failed_total", {
      queue: QUEUE_NAMES.ALERTS,
      job: job?.name ?? "unknown",
    });

    if (exhausted) {
      registry.increment("queue_jobs_exhausted_total", {
        queue: QUEUE_NAMES.ALERTS,
        job: job.name,
      });
    }

    log.error(
      exhausted ? "Queue job exhausted its retries" : "Queue job failed",
      {
        jobId: job?.id ?? null,
        jobName: job?.name ?? null,
        alertId: job?.data?.alertId ?? null,
        attemptsMade: job?.attemptsMade ?? null,
        maxAttempts,
        exhausted,
        message: error?.message,
      },
    );
  });

  worker.on("error", (error) => {
    log.error("Queue worker error", {
      message: error.message,
    });
  });

  return worker;
}

module.exports = {
  DEFAULT_BATCH_SIZE,
  DEFAULT_CONCURRENCY,
  createAlertQueueWorker,
  handleAlertJob,
  handleEvaluateAlert,
  handleScanAlerts,
};
