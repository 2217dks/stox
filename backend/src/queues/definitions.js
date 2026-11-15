/**
 * Queue names, job names, and retry policies.
 *
 * Keeping these in one module means a worker, an enqueuer, and the tests all
 * agree on the contract, and adding a queue is a one-file change.
 */

const QUEUE_NAMES = Object.freeze({
  ORDERS: "orders",
  NOTIFICATIONS: "notifications",
  ALERTS: "alerts",
});

const ORDER_JOB_NAMES = Object.freeze({
  EXECUTE_ORDER: "execute-order",
  SCAN_PENDING: "scan-pending",
});

const DEFAULT_JOB_OPTIONS = Object.freeze({
  attempts: 5,
  backoff: { type: "exponential", delay: 1000 },
  // Keep a bounded history so operators can inspect and replay failures
  // without letting Redis grow without limit.
  removeOnComplete: { count: 1000 },
  removeOnFail: { count: 5000 },
});

const QUEUE_POLICIES = Object.freeze({
  [QUEUE_NAMES.ORDERS]: {
    defaultJobOptions: DEFAULT_JOB_OPTIONS,
    jobs: {
      [ORDER_JOB_NAMES.EXECUTE_ORDER]: {
        attempts: 5,
        backoff: { type: "exponential", delay: 1000 },
        // BullMQ deduplicates by jobId while the job is retained, including
        // after completion. A resting LIMIT/STOP/TAKE_PROFIT order stays
        // PENDING after a completed check, so the next scan must be able to
        // enqueue it again under the same `jobId = orderId`. Failed jobs are
        // still retained by the queue-level `removeOnFail` policy.
        removeOnComplete: true,
      },
      [ORDER_JOB_NAMES.SCAN_PENDING]: {
        attempts: 3,
        backoff: { type: "exponential", delay: 2000 },
      },
    },
  },
  // Notification and alert workers land in the following tasks; their retry
  // budgets are declared here so the foundation is complete and every queue
  // has a policy the moment it is registered.
  [QUEUE_NAMES.NOTIFICATIONS]: {
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: "exponential", delay: 5000 },
      removeOnComplete: { count: 1000 },
      removeOnFail: { count: 5000 },
    },
    jobs: {},
  },
  [QUEUE_NAMES.ALERTS]: {
    defaultJobOptions: {
      attempts: 2,
      backoff: { type: "exponential", delay: 1000 },
      removeOnComplete: { count: 500 },
      removeOnFail: { count: 2000 },
    },
    jobs: {},
  },
});

function jobOptionsFor(queueName, jobName) {
  const policy = QUEUE_POLICIES[queueName];

  if (!policy) {
    throw new Error(`Unknown queue "${queueName}".`);
  }

  return {
    ...policy.defaultJobOptions,
    ...(policy.jobs[jobName] || {}),
  };
}

module.exports = {
  QUEUE_NAMES,
  ORDER_JOB_NAMES,
  DEFAULT_JOB_OPTIONS,
  QUEUE_POLICIES,
  jobOptionsFor,
};
