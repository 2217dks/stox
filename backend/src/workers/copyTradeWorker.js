const { Worker, UnrecoverableError } = require("bullmq");

const {
  fanOutCopyTrades,
  scanUnprocessedCopyTrades,
  DEFAULT_MAX_ATTEMPTS,
} = require("../services/copyTradeService");
const { enqueueCopyTradeFanOut } = require("../queues/copyTradeQueue");
const { createQueueConnection } = require("../queues/connection");
const {
  QUEUE_NAMES,
  COPY_TRADE_JOB_NAMES,
} = require("../queues/definitions");
const { childLogger } = require("../utils/logger");
const { registry } = require("../observability/metrics");

const DEFAULT_CONCURRENCY = 5;

function readPositiveInteger(value, fallback) {
  const number = Number(value);

  return Number.isInteger(number) && number > 0 ? number : fallback;
}

/**
 * Handle one copy-trade fan-out job.
 *
 * The source trade is durable, so a missing row is unrecoverable. A retryable
 * follower failure is thrown as a normal Error so BullMQ applies the queue's
 * retry policy; the durable execution rows make the replay idempotent.
 */
async function handleFanOutCopyTrades(job, options = {}) {
  const { tradeId } = job.data;

  try {
    return await fanOutCopyTrades({
      tradeId,
      orderService: options.orderService,
      maxAttempts: options.maxAttempts,
    });
  } catch (error) {
    if (error.code === "SOURCE_TRADE_NOT_FOUND") {
      throw new UnrecoverableError(
        `Source trade ${tradeId} no longer exists.`,
      );
    }

    throw error;
  }
}

/**
 * Find trades whose post-commit fan-out was never confirmed and enqueue them.
 *
 * This is the recovery path for a Redis outage that dropped the original
 * enqueue. It only discovers work; the fan-out job remains the single
 * execution path.
 */
async function handleScanPending(job, options = {}) {
  const { limit } = job.data;
  const batchSize = limit ?? options.batchSize ?? 100;

  const trades = await scanUnprocessedCopyTrades({ limit: batchSize });

  const results = await Promise.all(
    trades.map((trade) => enqueueCopyTradeFanOut({ tradeId: trade.id })),
  );

  const enqueued = results.filter((result) => result.enqueued).length;

  return {
    scanned: trades.length,
    enqueued,
    failed: trades.length - enqueued,
  };
}

async function handleCopyTradeJob(job, options) {
  switch (job.name) {
    case COPY_TRADE_JOB_NAMES.FAN_OUT:
      return handleFanOutCopyTrades(job, options);

    case COPY_TRADE_JOB_NAMES.SCAN_PENDING:
      return handleScanPending(job, options);

    default:
      throw new UnrecoverableError(
        `Unknown copy-trade job "${job.name}".`,
      );
  }
}

function createCopyTradeWorker({
  connection,
  concurrency = readPositiveInteger(
    process.env.QUEUE_COPY_TRADE_CONCURRENCY,
    DEFAULT_CONCURRENCY,
  ),
  orderService,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  batchSize = 100,
  prefix = process.env.QUEUE_PREFIX || "stox",
} = {}) {
  const queueConnection = connection || createQueueConnection();

  const worker = new Worker(
    QUEUE_NAMES.COPY_TRADES,
    (job) =>
      handleCopyTradeJob(job, { orderService, maxAttempts, batchSize }),
    {
      connection: queueConnection,
      concurrency,
      prefix,
    },
  );

  worker.queueConnection = queueConnection;

  const log = childLogger({
    queue: QUEUE_NAMES.COPY_TRADES,
    worker: "copy-trades",
  });

  worker.on("completed", (job) => {
    registry.increment("queue_jobs_completed_total", {
      queue: QUEUE_NAMES.COPY_TRADES,
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
    const maxAttemptsForJob = job?.opts?.attempts ?? 1;
    const exhausted =
      Boolean(job) && job.attemptsMade >= maxAttemptsForJob;

    registry.increment("queue_jobs_failed_total", {
      queue: QUEUE_NAMES.COPY_TRADES,
      job: job?.name ?? "unknown",
    });

    if (exhausted) {
      registry.increment("queue_jobs_exhausted_total", {
        queue: QUEUE_NAMES.COPY_TRADES,
        job: job.name,
      });
    }

    log.error(
      exhausted ? "Queue job exhausted its retries" : "Queue job failed",
      {
        jobId: job?.id ?? null,
        jobName: job?.name ?? null,
        tradeId: job?.data?.tradeId ?? null,
        attemptsMade: job?.attemptsMade ?? null,
        maxAttempts: maxAttemptsForJob,
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
  DEFAULT_CONCURRENCY,
  createCopyTradeWorker,
  handleCopyTradeJob,
  handleFanOutCopyTrades,
  handleScanPending,
};
