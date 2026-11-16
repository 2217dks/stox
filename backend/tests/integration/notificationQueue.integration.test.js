process.env.QUEUES_ENABLED = "true";
process.env.QUEUE_PREFIX = `stox-test-notif-${process.pid}-${Date.now()}`;

const prisma = require("../../src/config/database");
const { getQueue, closeQueues } = require("../../src/queues");
const { createQueueConnection } = require("../../src/queues/connection");
const {
  QUEUE_NAMES,
  NOTIFICATION_JOB_NAMES,
} = require("../../src/queues/definitions");
const {
  enqueueNotificationDelivery,
} = require("../../src/queues/notificationQueue");
const {
  createNotificationQueueWorker,
  handleSendNotification,
} = require("../../src/workers/notificationQueueWorker");

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

function startWorker(options = {}) {
  const connection = createQueueConnection();

  const worker = createNotificationQueueWorker({
    connection,
    prefix: PREFIX,
    concurrency: 1,
    ...options,
  });

  workers.push({ worker, connection });

  return worker;
}

async function makeUser(label) {
  return prisma.user.create({
    data: {
      name: `Notification Queue ${label}`,
      email: `notification-queue-${label}-${Date.now()}@stox.local`,
      pushEnabled: true,
      pushToken: "device-token",
    },
  });
}

async function makeNotification(userId, overrides = {}) {
  return prisma.notification.create({
    data: {
      userId,
      type: "ORDER_EXECUTED",
      title: "Order executed",
      message: "BUY 1 AAPL executed.",
      ...overrides,
    },
  });
}

describe("Notification queue integration", () => {
  beforeAll(async () => {
    jest.setTimeout(20000);
    await prisma.notification.deleteMany({
      where: {
        deliveryStatus: { in: ["PENDING", "SENDING"] },
      },
    });
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
  });

  afterAll(async () => {
    for (const name of [QUEUE_NAMES.NOTIFICATIONS, QUEUE_NAMES.ALERTS]) {
      const queue = getQueue(name);

      if (queue) {
        await queue.obliterate({ force: true }).catch(() => {});
      }
    }

    await closeQueues();
    await prisma.$disconnect();
  });

  test("delivers a notification end to end and persists the channels", async () => {
    const user = await makeUser("deliver");
    const notification = await makeNotification(user.id);
    const emailService = {
      sendEmail: jest.fn(async () => ({ delivered: true })),
    };
    const pushService = {
      sendPush: jest.fn(async () => ({ delivered: true })),
    };
    const emit = jest.fn(async () => true);

    startWorker({ emailService, pushService, emit });

    await expect(
      enqueueNotificationDelivery({ notificationId: notification.id }),
    ).resolves.toEqual({ enqueued: true, jobId: notification.id });

    await waitFor(async () => {
      const current = await prisma.notification.findUnique({
        where: { id: notification.id },
      });

      return current?.deliveryStatus === "DELIVERED";
    });

    const saved = await prisma.notification.findUnique({
      where: { id: notification.id },
    });

    expect(saved.deliveryChannels).toEqual({
      inApp: "delivered",
      email: "delivered",
      push: "delivered",
    });
    expect(emailService.sendEmail).toHaveBeenCalledTimes(1);
    expect(pushService.sendPush).toHaveBeenCalledTimes(1);

    // A replayed handler must not send again.
    const replay = await handleSendNotification({
      data: { notificationId: notification.id },
    });

    expect(replay).toMatchObject({
      outcome: "skipped",
      reason: "ALREADY_PROCESSED",
    });
    expect(emailService.sendEmail).toHaveBeenCalledTimes(1);
  });

  test("skips a user whose preferences are disabled", async () => {
    const user = await makeUser("prefs");
    await prisma.userPreference.create({
      data: {
        userId: user.id,
        emailNotifications: false,
        pushNotifications: false,
      },
    });

    const notification = await makeNotification(user.id);
    const emailService = {
      sendEmail: jest.fn(async () => ({ delivered: true })),
    };
    const pushService = {
      sendPush: jest.fn(async () => ({ delivered: true })),
    };
    const emit = jest.fn(async () => false);

    startWorker({ emailService, pushService, emit });

    await enqueueNotificationDelivery({ notificationId: notification.id });

    await waitFor(async () => {
      const current = await prisma.notification.findUnique({
        where: { id: notification.id },
      });

      return current?.deliveryStatus === "SKIPPED";
    });

    expect(emailService.sendEmail).not.toHaveBeenCalled();
    expect(pushService.sendPush).not.toHaveBeenCalled();
  });

  test("scan-pending reclaims a stale SENDING row after a worker crash", async () => {
    const user = await makeUser("stale");
    const notification = await makeNotification(user.id, {
      deliveryStatus: "SENDING",
      deliveryStartedAt: new Date(Date.now() - 10 * 60 * 1000),
      deliveryAttempts: 1,
    });

    const emailService = {
      sendEmail: jest.fn(async () => ({ delivered: true })),
    };

    startWorker({
      emailService,
      pushService: { sendPush: jest.fn(async () => ({ delivered: true })) },
      emit: jest.fn(async () => true),
      deliveryLeaseMs: 60 * 1000,
    });

    const queue = getQueue(QUEUE_NAMES.NOTIFICATIONS);
    await queue.add(NOTIFICATION_JOB_NAMES.SCAN_PENDING, { limit: 10 });

    await waitFor(async () => {
      const current = await prisma.notification.findUnique({
        where: { id: notification.id },
      });

      return current?.deliveryStatus === "DELIVERED";
    });

    expect(emailService.sendEmail).toHaveBeenCalledTimes(1);
  });

  test("scan-pending finds rows left at PENDING", async () => {
    const user = await makeUser("scan");
    const notification = await makeNotification(user.id, {
      deliveryStatus: "PENDING",
    });

    const emailService = {
      sendEmail: jest.fn(async () => ({ delivered: true })),
    };

    startWorker({
      emailService,
      pushService: { sendPush: jest.fn(async () => ({ delivered: true })) },
      emit: jest.fn(async () => true),
    });

    const queue = getQueue(QUEUE_NAMES.NOTIFICATIONS);
    await queue.add(NOTIFICATION_JOB_NAMES.SCAN_PENDING, { limit: 10 });

    await waitFor(async () => {
      const current = await prisma.notification.findUnique({
        where: { id: notification.id },
      });

      return current?.deliveryStatus === "DELIVERED";
    });

    expect(emailService.sendEmail).toHaveBeenCalledTimes(1);
  });
});
