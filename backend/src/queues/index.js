const { Queue } = require("bullmq");

const { QUEUE_POLICIES } = require("./definitions");
const { createQueueConnection } = require("./connection");
const logger = require("../utils/logger");

// name -> { queue, connection }
//
// BullMQ does not close an ioredis instance that the caller supplied. The
// registry therefore owns the connection and closes it explicitly, otherwise a
// long-lived API process leaks one connection per queue and Jest never exits.
const queues = new Map();

function isQueuesEnabled() {
  return process.env.QUEUES_ENABLED !== "false";
}

function resolvePrefix() {
  return process.env.QUEUE_PREFIX || "stox";
}

/**
 * Return the shared Queue instance for a registered queue name.
 *
 * Returns `null` when queues are disabled, which lets callers stay
 * best-effort: a Redis outage or a test environment never makes an API
 * request fail just because it could not schedule background work.
 */
function getQueue(name) {
  if (!isQueuesEnabled()) {
    return null;
  }

  if (!QUEUE_POLICIES[name]) {
    throw new Error(`Unknown queue "${name}".`);
  }

  let record = queues.get(name);

  if (!record) {
    const connection = createQueueConnection();

    const queue = new Queue(name, {
      connection,
      prefix: resolvePrefix(),
      defaultJobOptions: QUEUE_POLICIES[name].defaultJobOptions,
    });

    queue.on("error", (error) => {
      logger.warn("Queue error", {
        queue: name,
        message: error.message,
      });
    });

    record = { queue, connection };
    queues.set(name, record);
  }

  return record.queue;
}

async function closeQueues() {
  const closing = [...queues.entries()].map(async ([name, record]) => {
    try {
      await record.queue.close();
    } catch (error) {
      logger.warn("Queue close failed", {
        queue: name,
        message: error.message,
      });
    }

    if (record.connection.status === "end") {
      return;
    }

    try {
      await record.connection.quit();
    } catch (error) {
      record.connection.disconnect();
    }
  });

  await Promise.all(closing);
  queues.clear();
}

module.exports = {
  closeQueues,
  getQueue,
  isQueuesEnabled,
  resolvePrefix,
};
