const { z } = require("zod");

const { getQueue } = require("./index");
const {
  QUEUE_NAMES,
  COPY_TRADE_JOB_NAMES,
  jobOptionsFor,
} = require("./definitions");
const { enqueue, enqueueOrRetry, parsePayload } = require("./enqueue");
const logger = require("../utils/logger");

const fanOutPayloadSchema = z.object({
  tradeId: z.string().uuid("tradeId must be a valid UUID."),
});

const scanPendingPayloadSchema = z.object({
  limit: z.number().int().min(1).max(1000).optional(),
});

/**
 * Schedule copy-trade fan-out for one executed source trade.
 *
 * The source trade is already committed when this is called. `jobId` is the
 * trade id, so a duplicate enqueue while the job is retained is deduplicated;
 * the durable `CopyTradeExecution` rows and `Trade.copyFanOutAt` marker are
 * the authoritative idempotency guards after the job has been removed.
 */
async function enqueueCopyTradeFanOut(payload) {
  const data = parsePayload(fanOutPayloadSchema, payload);

  return enqueueOrRetry(
    QUEUE_NAMES.COPY_TRADES,
    COPY_TRADE_JOB_NAMES.FAN_OUT,
    data,
    { jobId: data.tradeId },
  );
}

async function enqueueCopyTradeScan(payload = {}) {
  const data = parsePayload(scanPendingPayloadSchema, payload);

  return enqueue(
    QUEUE_NAMES.COPY_TRADES,
    COPY_TRADE_JOB_NAMES.SCAN_PENDING,
    data,
  );
}

/**
 * Register the repeatable recovery scan.
 *
 * A Redis outage can drop the post-commit fan-out enqueue. This scan finds
 * executed trades whose `copyFanOutAt` marker is still null and re-enqueues
 * them. The marker makes the scan finite, and the execution rows make the
 * replay safe.
 */
async function ensureCopyTradeScanScheduler({
  every = 60000,
  ...payload
} = {}) {
  const queue = getQueue(QUEUE_NAMES.COPY_TRADES);

  if (!queue) {
    return { scheduled: false, reason: "QUEUES_DISABLED" };
  }

  try {
    const data = parsePayload(scanPendingPayloadSchema, payload);

    const job = await queue.upsertJobScheduler(
      "copy-trades:scan-pending",
      { every },
      {
        name: COPY_TRADE_JOB_NAMES.SCAN_PENDING,
        data,
        opts: jobOptionsFor(
          QUEUE_NAMES.COPY_TRADES,
          COPY_TRADE_JOB_NAMES.SCAN_PENDING,
        ),
      },
    );

    return { scheduled: true, jobId: job?.id ?? null };
  } catch (error) {
    logger.error("Copy-trade scan scheduler registration failed", {
      queue: QUEUE_NAMES.COPY_TRADES,
      message: error.message,
    });

    return { scheduled: false, reason: "SCHEDULE_FAILED" };
  }
}

module.exports = {
  fanOutPayloadSchema,
  scanPendingPayloadSchema,
  enqueueCopyTradeFanOut,
  enqueueCopyTradeScan,
  ensureCopyTradeScanScheduler,
};
