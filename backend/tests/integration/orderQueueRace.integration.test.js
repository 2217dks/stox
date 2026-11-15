const prisma = require("../../src/config/database");

process.env.QUEUES_ENABLED = "true";
process.env.QUEUE_PREFIX = `stox-test-order-race-${process.pid}-${Date.now()}`;

const { getQueue, closeQueues } = require("../../src/queues");
const { createQueueConnection } = require("../../src/queues/connection");
const { QUEUE_NAMES } = require("../../src/queues/definitions");
const {
  enqueueOrderExecution,
  enqueuePendingOrderScan,
} = require("../../src/queues/orderQueue");
const {
  createOrderQueueWorker,
} = require("../../src/workers/orderQueueWorker");

const PREFIX = process.env.QUEUE_PREFIX;
const timestamp = Date.now();

let userId;
let portfolioId;
let worker;
let workerConnection;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(predicate, { timeoutMs = 10000, intervalMs = 25 } = {}) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (await predicate()) {
      return true;
    }

    await delay(intervalMs);
  }

  throw new Error("Timed out waiting for condition.");
}

/**
 * Build a provider that lets the first quote request wait briefly for a second
 * one. With two execution paths for the same order, the second request arrives
 * and both continue; with a single path the first request falls back to the
 * timeout. This makes the race deterministic instead of timing-dependent.
 */
function makeRacingQuoteProvider(handler) {
  let calls = 0;
  let releaseFirst;

  const secondCall = new Promise((resolve) => {
    releaseFirst = resolve;
  });

  return {
    getQuote: jest.fn(async (symbol, options) => {
      calls += 1;

      if (calls === 1) {
        await Promise.race([secondCall, delay(500)]);
      } else {
        releaseFirst();
      }

      return handler(symbol, options);
    }),
  };
}

async function startWorker(quoteProvider) {
  workerConnection = createQueueConnection();

  worker = createOrderQueueWorker({
    connection: workerConnection,
    prefix: PREFIX,
    concurrency: 2,
    quoteProvider,
  });

  return worker;
}

async function stopWorker() {
  if (worker) {
    await worker.close().catch(() => {});
    worker = null;
  }

  if (workerConnection && workerConnection.status !== "end") {
    try {
      await workerConnection.quit();
    } catch (error) {
      workerConnection.disconnect();
    }
  }

  workerConnection = null;
}

async function resetDatabase() {
  await prisma.trade.deleteMany({ where: { portfolioId } });
  await prisma.order.deleteMany({ where: { portfolioId } });
  await prisma.holding.deleteMany({ where: { portfolioId } });

  await prisma.portfolio.update({
    where: { id: portfolioId },
    data: {
      cashBalance: "10000",
      reservedCash: "0",
      isActive: true,
    },
  });
}

async function createPendingOrder(overrides = {}) {
  return prisma.order.create({
    data: {
      portfolioId,
      symbol: "AAPL",
      assetType: "STOCK",
      side: "BUY",
      type: "MARKET",
      status: "PENDING",
      quantity: "1",
      reservedCash: "0",
      ...overrides,
    },
  });
}

beforeAll(async () => {
  jest.setTimeout(30000);

  const user = await prisma.user.create({
    data: {
      email: `order-queue-race-${timestamp}@stox.local`,
      name: "Order Queue Race Test User",
      passwordHash: "not-used-by-these-tests",
    },
  });

  userId = user.id;

  const portfolio = await prisma.portfolio.create({
    data: {
      userId,
      name: `Order Queue Race Portfolio ${timestamp}`,
      startingBalance: "10000",
      cashBalance: "10000",
      reservedCash: "0",
    },
  });

  portfolioId = portfolio.id;
});

beforeEach(async () => {
  await resetDatabase();

  const queue = getQueue(QUEUE_NAMES.ORDERS);

  if (queue) {
    await queue.obliterate({ force: true }).catch(() => {});
  }
});

afterEach(async () => {
  await stopWorker();
});

afterAll(async () => {
  const queue = getQueue(QUEUE_NAMES.ORDERS);

  if (queue) {
    await queue.obliterate({ force: true }).catch(() => {});
  }

  await closeQueues();

  if (portfolioId) {
    await prisma.trade.deleteMany({ where: { portfolioId } });
    await prisma.order.deleteMany({ where: { portfolioId } });
    await prisma.holding.deleteMany({ where: { portfolioId } });
    await prisma.portfolio.delete({ where: { id: portfolioId } });
  }

  if (userId) {
    await prisma.user.delete({ where: { id: userId } });
  }

  await prisma.$disconnect();
});

describe("order queue scan/direct-enqueue race", () => {
  test("a transient failure is counted once when the direct job and scan race", async () => {
    const order = await createPendingOrder();

    const quoteProvider = makeRacingQuoteProvider(async () => {
      throw new Error("provider unavailable");
    });

    await startWorker(quoteProvider);

    await enqueueOrderExecution({ orderId: order.id, portfolioId });
    await enqueuePendingOrderScan({ portfolioId });

    await waitFor(async () => {
      const current = await prisma.order.findUnique({
        where: { id: order.id },
        select: { executionAttempts: true },
      });

      return current.executionAttempts >= 1;
    });

    // Wait long enough for a second processing path to record its own attempt,
    // but well before BullMQ's 1s backoff retries the failed job.
    await delay(400);

    const current = await prisma.order.findUnique({ where: { id: order.id } });

    expect(current.executionAttempts).toBe(1);
    expect(quoteProvider.getQuote).toHaveBeenCalledTimes(1);
  });

  test("a successful order cannot be filled twice when the direct job and scan race", async () => {
    const order = await createPendingOrder();

    const quoteProvider = makeRacingQuoteProvider(async (symbol) => ({
      symbol,
      assetClass: "STOCK",
      price: "100",
    }));

    await startWorker(quoteProvider);

    await Promise.all([
      enqueueOrderExecution({ orderId: order.id, portfolioId }),
      enqueuePendingOrderScan({ portfolioId }),
    ]);

    await waitFor(async () => {
      const current = await prisma.order.findUnique({
        where: { id: order.id },
        select: { status: true },
      });

      return current.status === "EXECUTED";
    });

    // Give a competing path time to finish after the first fill.
    await delay(400);

    const [current, tradeCount] = await Promise.all([
      prisma.order.findUnique({ where: { id: order.id } }),
      prisma.trade.count({ where: { orderId: order.id } }),
    ]);

    expect(current.status).toBe("EXECUTED");
    expect(tradeCount).toBe(1);
    expect(quoteProvider.getQuote).toHaveBeenCalledTimes(1);
  });

  test("a resting limit order is re-enqueued after a completed scan", async () => {
    const order = await createPendingOrder({
      type: "LIMIT",
      limitPrice: "90",
    });

    const quoteProvider = {
      getQuote: jest.fn(async (symbol) => ({
        symbol,
        assetClass: "STOCK",
        price: "100",
      })),
    };

    await startWorker(quoteProvider);

    await enqueuePendingOrderScan({ portfolioId });

    await waitFor(() => quoteProvider.getQuote.mock.calls.length === 1);

    // The completed execute-order job must be removed, otherwise BullMQ's
    // jobId dedupe would suppress every later scan for this still-pending
    // order.
    await waitFor(async () => {
      const jobs = await getQueue(QUEUE_NAMES.ORDERS).getJobs([
        "waiting",
        "active",
        "delayed",
        "completed",
        "failed",
      ]);

      return !jobs.some((job) => job.id === order.id);
    });

    quoteProvider.getQuote.mockImplementation(async (symbol) => ({
      symbol,
      assetClass: "STOCK",
      price: "80",
    }));

    await enqueuePendingOrderScan({ portfolioId });

    await waitFor(async () => {
      const current = await prisma.order.findUnique({
        where: { id: order.id },
        select: { status: true },
      });

      return current.status === "EXECUTED";
    });

    const [current, tradeCount] = await Promise.all([
      prisma.order.findUnique({ where: { id: order.id } }),
      prisma.trade.count({ where: { orderId: order.id } }),
    ]);

    expect(current.status).toBe("EXECUTED");
    expect(current.executedPrice.toString()).toBe("80");
    expect(tradeCount).toBe(1);
    expect(quoteProvider.getQuote).toHaveBeenCalledTimes(2);
  });
});
