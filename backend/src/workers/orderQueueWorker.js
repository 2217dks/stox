const { Worker, UnrecoverableError } = require("bullmq");

const prisma = require("../config/database");
const marketDataService = require("../services/marketData");
const {
  processOrder,
  processPendingOrders,
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_BATCH_SIZE,
} = require("./orderWorker");
const { createQueueConnection } = require("../queues/connection");
const { QUEUE_NAMES, ORDER_JOB_NAMES } = require("../queues/definitions");
const { childLogger } = require("../utils/logger");
const { registry } = require("../observability/metrics");

const DEFAULT_CONCURRENCY = 5;

function readPositiveInteger(value, fallback) {
  const number = Number(value);

  return Number.isInteger(number) && number > 0 ? number : fallback;
}

async function handleExecuteOrder(job, options) {
  const { orderId } = job.data;

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      portfolio: {
        select: { id: true, isActive: true },
      },
    },
  });

  if (!order) {
    // Retrying cannot resurrect a deleted row.
    throw new UnrecoverableError(`Order ${orderId} no longer exists.`);
  }

  // Terminal or already-processed orders are a no-op. This is the idempotency
  // guard for duplicate jobs.
  if (order.status !== "PENDING") {
    return { outcome: "skipped", status: order.status };
  }

  if (!order.portfolio || order.portfolio.isActive === false) {
    return { outcome: "skipped", status: "PENDING" };
  }

  const outcome = await processOrder(order, {
    quoteProvider: options.quoteProvider,
    now: options.now(),
    retryLimit: options.retryLimit,
  });

  // A transient provider/execution failure should back off through BullMQ.
  // The shared processor has already incremented `executionAttempts` and
  // rejects the order once that budget is spent, so this cannot loop forever.
  if (outcome === "retry") {
    throw new Error(`Transient execution failure for order ${orderId}.`);
  }

  // `rejected` is a terminal business outcome recorded on the order itself;
  // failing the job would only duplicate that record in the queue history.
  return { outcome };
}

async function handleScanPending(job, options) {
  const { portfolioId, limit } = job.data;

  return processPendingOrders({
    quoteProvider: options.quoteProvider,
    now: options.now(),
    portfolioId,
    limit: limit ?? options.batchSize,
    maxAttempts: options.retryLimit,
  });
}

/**
 * Route one BullMQ job to the matching processor.
 *
 * Exported separately from the Worker factory so the routing and failure
 * classification can be unit tested without opening a Redis connection.
 */
async function handleOrderJob(job, options) {
  switch (job.name) {
    case ORDER_JOB_NAMES.EXECUTE_ORDER:
      return handleExecuteOrder(job, options);

    case ORDER_JOB_NAMES.SCAN_PENDING:
      return handleScanPending(job, options);

    default:
      throw new UnrecoverableError(
        `Unknown order job "${job.name}".`,
      );
  }
}

/**
 * Create the BullMQ worker for the orders queue.
 *
 * The processor reuses the same `processOrder` / `processPendingOrders`
 * functions as the polling worker, so transaction boundaries and financial
 * invariants live in exactly one place regardless of transport.
 */
function createOrderQueueWorker({
  connection,
  concurrency = readPositiveInteger(
    process.env.QUEUE_ORDER_CONCURRENCY,
    DEFAULT_CONCURRENCY,
  ),
  quoteProvider = marketDataService,
  now = () => new Date(),
  retryLimit = DEFAULT_MAX_ATTEMPTS,
  batchSize = DEFAULT_BATCH_SIZE,
  prefix = process.env.QUEUE_PREFIX || "stox",
} = {}) {
  // BullMQ does not close a caller-supplied ioredis instance, so ownership is
  // explicit: the connection is exposed on the worker and the process entry
  // point closes it during shutdown.
  const queueConnection = connection || createQueueConnection();

  const worker = new Worker(
    QUEUE_NAMES.ORDERS,
    (job) =>
      handleOrderJob(job, { quoteProvider, now, retryLimit, batchSize }),
    {
      connection: queueConnection,
      concurrency,
      prefix,
    },
  );

  worker.queueConnection = queueConnection;

  const log = childLogger({ queue: QUEUE_NAMES.ORDERS, worker: "orders" });

  worker.on("completed", (job) => {
    registry.increment("queue_jobs_completed_total", {
      queue: QUEUE_NAMES.ORDERS,
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
      queue: QUEUE_NAMES.ORDERS,
      job: job?.name ?? "unknown",
    });

    if (exhausted) {
      registry.increment("queue_jobs_exhausted_total", {
        queue: QUEUE_NAMES.ORDERS,
        job: job.name,
      });
    }

    // The failed job stays in Redis (`removeOnFail`) with its payload and
    // reason, so this line is the alert and `listFailedOrderJobs()` is the
    // forensic record.
    log.error(
      exhausted ? "Queue job exhausted its retries" : "Queue job failed",
      {
        jobId: job?.id ?? null,
        jobName: job?.name ?? null,
        orderId: job?.data?.orderId ?? null,
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
  DEFAULT_CONCURRENCY,
  createOrderQueueWorker,
  handleOrderJob,
};
