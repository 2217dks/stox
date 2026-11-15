const { getQueue } = require("./index");

/**
 * Serializable summary of a failed BullMQ job.
 *
 * Failed jobs are retained by the queue's `removeOnFail` policy and carry the
 * payload, attempt count, and failure reason — enough to diagnose without a
 * separate failure table. Payloads contain only identifiers, never credentials.
 */
function serializeFailedJob(job) {
  return {
    id: job.id,
    name: job.name,
    data: job.data,
    attemptsMade: job.attemptsMade,
    maxAttempts: job.opts?.attempts ?? null,
    failedReason: job.failedReason,
    failedAt: job.finishedOn
      ? new Date(job.finishedOn).toISOString()
      : null,
  };
}

async function listFailedJobs(queueName, { start = 0, end = 49 } = {}) {
  const queue = getQueue(queueName);

  if (!queue) {
    return [];
  }

  const jobs = await queue.getFailed(start, end);

  return jobs.map(serializeFailedJob);
}

/**
 * Replay a failed job in place.
 *
 * `job.retry()` re-queues the same job with its original payload and attempt
 * budget, which is safer than adding a new job: it preserves the audit trail
 * and cannot double-enqueue while the failed job still exists under the same
 * `jobId`.
 */
async function retryFailedJob(queueName, jobId) {
  const queue = getQueue(queueName);

  if (!queue) {
    return { retried: false, reason: "QUEUES_DISABLED" };
  }

  const job = await queue.getJob(jobId);

  if (!job) {
    return { retried: false, reason: "NOT_FOUND" };
  }

  const state = await job.getState();

  if (state !== "failed") {
    return { retried: false, reason: "NOT_FAILED", state };
  }

  await job.retry();

  return { retried: true, jobId };
}

module.exports = {
  listFailedJobs,
  retryFailedJob,
  serializeFailedJob,
};
