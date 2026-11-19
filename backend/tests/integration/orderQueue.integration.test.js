const { Worker } = require("bullmq");

process.env.QUEUES_ENABLED = "true";
process.env.QUEUE_PREFIX = `stox-test-orders-${process.pid}-${Date.now()}`;

const prisma = require("../../src/config/database");
const {
  getQueue,
  closeQueues,
} = require("../../src/queues");
const { createQueueConnection } = require("../../src/queues/connection");
const { QUEUE_NAMES } = require("../../src/queues/definitions");
const { enqueueOrderExecution } = require("../../src/queues/orderQueue");
const {
  createOrderQueueWorker,
} = require("../../src/workers/orderQueueWorker");

const PREFIX = process.env.QUEUE_PREFIX;
const timestamp = Date.now();

let userId;
let portfolioId;
let worker;
let workerConnection;

const quoteProvider = {
  getQuote: jest.fn(async (symbol) => ({
    symbol,
    assetClass: "STOCK",
    price: "100",
  })),
};

async function waitFor(predicate, { timeoutMs = 10000, intervalMs = 25 } = {}) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (await predicate()) {
      return true;
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error("Timed out waiting for condition.");
}

beforeAll(async () => {
  jest.setTimeout(30000);

  const user = await prisma.user.create({
    data: {
      email: `order-queue-${timestamp}@stox.local`,
      name: "Order Queue Test User",
      passwordHash: "not-used-by-these-tests",
    },
  });

  userId = user.id;

  const portfolio = await prisma.portfolio.create({
    data: {
      userId,
      name: `Order Queue Portfolio ${timestamp}`,
      cashBalance: "10000",
      reservedCash: "0",
    },
  });

  portfolioId = portfolio.id;
});

afterAll(async () => {
  if (worker) {
    await worker.close().catch(() => {});
  }

  if (workerConnection && workerConnection.status !== "end") {
    try {
      await workerConnection.quit();
    } catch (error) {
      workerConnection.disconnect();
    }
  }

  const queue = getQueue(QUEUE_NAMES.ORDERS);

  if (queue) {
    await queue.obliterate({ force: true }).catch(() => {});
  }

  if (portfolioId) {
    await prisma.trade.deleteMany({ where: { portfolioId } });
    await prisma.order.deleteMany({ where: { portfolioId } });
    await prisma.holding.deleteMany({ where: { portfolioId } });
    await prisma.portfolio.delete({ where: { id: portfolioId } });
  }

  if (userId) {
    await prisma.user.delete({ where: { id: userId } });
  }

  await closeQueues();
  await prisma.$disconnect();
  process.env.QUEUES_ENABLED = "false";
});

describe("order queue end to end", () => {
  test("a queued execute-order job fills a pending market order", async () => {
    const order = await prisma.order.create({
      data: {
        portfolioId,
        symbol: "AAPL",
        assetType: "STOCK",
        side: "BUY",
        type: "MARKET",
        status: "PENDING",
        quantity: "1",
        reservedCash: "0",
      },
    });

    workerConnection = createQueueConnection();

    worker = createOrderQueueWorker({
      connection: workerConnection,
      prefix: PREFIX,
      concurrency: 1,
      quoteProvider,
    });

    const enqueued = await enqueueOrderExecution({ orderId: order.id });

    expect(enqueued.enqueued).toBe(true);

    await waitFor(async () => {
      const current = await prisma.order.findUnique({
        where: { id: order.id },
        select: { status: true },
      });

      return current.status === "EXECUTED";
    });

    const executed = await prisma.order.findUnique({
      where: { id: order.id },
      include: { trade: true },
    });
    const portfolio = await prisma.portfolio.findUnique({
      where: { id: portfolioId },
    });

    expect(executed.status).toBe("EXECUTED");
    expect(executed.executedPrice.toString()).toBe("100");
    expect(executed.trade).not.toBeNull();
    expect(portfolio.cashBalance.toString()).toBe("9900");
  });
});
