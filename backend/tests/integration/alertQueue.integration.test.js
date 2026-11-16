process.env.QUEUES_ENABLED = "true";
process.env.QUEUE_PREFIX = `stox-test-alert-${process.pid}-${Date.now()}`;

const prisma = require("../../src/config/database");
const { getQueue, closeQueues } = require("../../src/queues");
const { createQueueConnection } = require("../../src/queues/connection");
const {
  QUEUE_NAMES,
  ALERT_JOB_NAMES,
} = require("../../src/queues/definitions");
const {
  enqueueAlertEvaluation,
  enqueueAlertScan,
} = require("../../src/queues/alertQueue");
const {
  createAlertQueueWorker,
  handleAlertJob,
} = require("../../src/workers/alertQueueWorker");

const PREFIX = process.env.QUEUE_PREFIX;
const workers = [];

function waitFor(predicate, { timeoutMs = 8000, intervalMs = 25 } = {}) {
  const deadline = Date.now() + timeoutMs;

  return (async () => {
    while (Date.now() < deadline) {
      if (await predicate()) {
        return true;
      }

      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }

    throw new Error("Timed out waiting for condition.");
  })();
}

function startWorker(quoteProvider) {
  const connection = createQueueConnection();

  const worker = createAlertQueueWorker({
    connection,
    prefix: PREFIX,
    concurrency: 1,
    quoteProvider,
  });

  workers.push({ worker, connection });

  return worker;
}

async function createSymbol(label) {
  return prisma.symbol.create({
    data: {
      symbol: `AQ${Date.now()}${label}`.toUpperCase(),
      name: `Alert Queue ${label}`,
      assetType: "STOCK",
      exchange: "TEST",
    },
  });
}

async function createAlert(userId, symbolId, overrides = {}) {
  return prisma.alert.create({
    data: {
      userId,
      symbolId,
      condition: "PRICE_ABOVE",
      targetPrice: "200",
      sendEmail: true,
      sendPush: false,
      ...overrides,
    },
  });
}

describe("Alert queue integration", () => {
  let userId;
  let symbols;

  beforeAll(() => {
    jest.setTimeout(20000);
  });

  beforeEach(async () => {
    const timestamp = Date.now();

    const user = await prisma.user.create({
      data: {
        name: "Alert Queue User",
        email: `alert-queue-${timestamp}@stox.local`,
      },
    });

    userId = user.id;

    symbols = {
      a: await createSymbol("A"),
      b: await createSymbol("B"),
      c: await createSymbol("C"),
    };
  });

  afterEach(async () => {
    while (workers.length > 0) {
      const { worker, connection } = workers.pop();

      try {
        await worker.close();
      } catch (error) {
        // Already closed.
      }

      if (connection.status !== "end") {
        try {
          await connection.quit();
        } catch (error) {
          connection.disconnect();
        }
      }
    }

    if (userId) {
      await prisma.user.deleteMany({ where: { id: userId } });
    }

    if (symbols) {
      await prisma.symbol.deleteMany({
        where: {
          id: { in: Object.values(symbols).map((symbol) => symbol.id) },
        },
      });
    }
  });

  afterAll(async () => {
    for (const name of [QUEUE_NAMES.ALERTS, QUEUE_NAMES.NOTIFICATIONS]) {
      const queue = getQueue(name);

      if (queue) {
        await queue.obliterate({ force: true }).catch(() => {});
      }
    }

    await closeQueues();
    await prisma.$disconnect();
  });

  test("evaluates one alert, triggers it, and creates one notification", async () => {
    const alert = await createAlert(userId, symbols.a.id);

    const quoteProvider = {
      getQuote: jest.fn(async () => ({ price: "210" })),
    };

    startWorker(quoteProvider);

    await expect(
      enqueueAlertEvaluation({ alertId: alert.id }),
    ).resolves.toEqual({ enqueued: true, jobId: alert.id });

    await waitFor(async () => {
      const current = await prisma.alert.findUnique({ where: { id: alert.id } });
      return current.status === "TRIGGERED";
    });

    const notifications = await prisma.notification.findMany({
      where: { userId, type: "PRICE_ALERT" },
    });

    expect(notifications).toHaveLength(1);
    expect(notifications[0].data).toMatchObject({
      alertId: alert.id,
      condition: "PRICE_ABOVE",
      currentPrice: "210",
      channels: { email: true, push: false },
    });

    const replay = await handleAlertJob(
      {
        name: ALERT_JOB_NAMES.EVALUATE_ALERT,
        data: { alertId: alert.id },
      },
      { quoteProvider },
    );

    expect(replay).toEqual({ outcome: "skipped", status: "TRIGGERED" });
    expect(
      await prisma.notification.count({
        where: { userId, type: "PRICE_ALERT" },
      }),
    ).toBe(1);
  });

  test("scans a mix of triggered, not-triggered, and unavailable symbols", async () => {
    const triggered = await createAlert(userId, symbols.a.id);
    const notTriggered = await createAlert(userId, symbols.b.id, {
      targetPrice: "300",
    });
    const unavailable = await createAlert(userId, symbols.c.id);

    const quoteProvider = {
      getQuote: jest.fn(async (symbol) => {
        if (symbol === symbols.c.symbol) {
          throw Object.assign(new Error("provider unavailable"), {
            code: "MARKET_DATA_PROVIDER_UNAVAILABLE",
          });
        }

        return { price: symbol === symbols.a.symbol ? "210" : "250" };
      }),
    };

    startWorker(quoteProvider);

    await expect(enqueueAlertScan({ limit: 10 })).resolves.toMatchObject({
      enqueued: true,
    });

    await waitFor(async () => {
      const current = await prisma.alert.findUnique({
        where: { id: triggered.id },
      });
      return current.status === "TRIGGERED";
    });

    const [triggeredRow, notTriggeredRow, unavailableRow] = await Promise.all([
      prisma.alert.findUnique({ where: { id: triggered.id } }),
      prisma.alert.findUnique({ where: { id: notTriggered.id } }),
      prisma.alert.findUnique({ where: { id: unavailable.id } }),
    ]);

    expect(triggeredRow.status).toBe("TRIGGERED");
    expect(notTriggeredRow.status).toBe("ACTIVE");
    expect(unavailableRow.status).toBe("ACTIVE");
    expect(
      await prisma.notification.count({
        where: { userId, type: "PRICE_ALERT" },
      }),
    ).toBe(1);
  });

  test("triggers a percentage alert against its request-time baseline", async () => {
    const alert = await createAlert(userId, symbols.a.id, {
      condition: "PERCENT_CHANGE_UP",
      targetPrice: "5",
      baselinePrice: "100",
      baselineAt: new Date("2026-01-01T00:00:00.000Z"),
    });

    const quoteProvider = {
      getQuote: jest.fn(async () => ({ price: "106" })),
    };

    startWorker(quoteProvider);

    await enqueueAlertEvaluation({ alertId: alert.id });

    await waitFor(async () => {
      const current = await prisma.alert.findUnique({ where: { id: alert.id } });
      return current.status === "TRIGGERED";
    });

    const notification = await prisma.notification.findFirst({
      where: { userId, type: "PRICE_ALERT" },
    });

    expect(notification.data).toMatchObject({
      alertId: alert.id,
      condition: "PERCENT_CHANGE_UP",
      targetPrice: "5",
      currentPrice: "106",
      baselinePrice: "100",
    });
  });
});
