jest.mock("../../../src/config/database", () => ({
  notification: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    updateMany: jest.fn(),
    update: jest.fn(),
  },
  userPreference: {
    findUnique: jest.fn(),
  },
}));

jest.mock("../../../src/services/notificationDeliveryService", () => ({
  deliverNotification: jest.fn(),
}));

jest.mock("../../../src/queues/notificationQueue", () => ({
  requeueNotificationDelivery: jest.fn(),
}));

const prisma = require("../../../src/config/database");
const {
  deliverNotification,
} = require("../../../src/services/notificationDeliveryService");
const {
  requeueNotificationDelivery,
} = require("../../../src/queues/notificationQueue");
const {
  handleNotificationJob,
} = require("../../../src/workers/notificationQueueWorker");
const {
  NOTIFICATION_JOB_NAMES,
} = require("../../../src/queues/definitions");

const NOTIFICATION_ID = "6f1f7c2e-0d7f-4c2a-9b8f-2f9a1d0c3b4e";
const USER_ID = "3f1b2c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";

function makeJob(overrides = {}) {
  return {
    id: "job-1",
    name: NOTIFICATION_JOB_NAMES.SEND_NOTIFICATION,
    data: { notificationId: NOTIFICATION_ID },
    ...overrides,
  };
}

function makeNotification(overrides = {}) {
  return {
    id: NOTIFICATION_ID,
    userId: USER_ID,
    type: "ORDER_EXECUTED",
    title: "Order executed",
    message: "BUY 1 AAPL executed at 200.",
    data: { symbol: "AAPL" },
    deliveryStatus: "PENDING",
    deliveryAttempts: 0,
    deliveryStartedAt: null,
    deliveryChannels: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    user: {
      id: USER_ID,
      email: "user@example.com",
      emailAlerts: true,
      pushEnabled: true,
      pushToken: "device-token",
    },
    ...overrides,
  };
}

describe("notification queue job handler", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    prisma.userPreference.findUnique.mockResolvedValue({
      emailNotifications: true,
      pushNotifications: true,
    });
    prisma.notification.updateMany.mockResolvedValue({ count: 1 });
    prisma.notification.update.mockResolvedValue({});
  });

  test("rejects an unknown job name as unrecoverable", async () => {
    await expect(
      handleNotificationJob(makeJob({ name: "mystery" })),
    ).rejects.toMatchObject({ name: "UnrecoverableError" });
  });

  test("treats a deleted notification as unrecoverable", async () => {
    prisma.notification.findUnique.mockResolvedValue(null);

    await expect(handleNotificationJob(makeJob())).rejects.toMatchObject({
      name: "UnrecoverableError",
    });
    expect(deliverNotification).not.toHaveBeenCalled();
  });

  test("short-circuits a terminal delivery status", async () => {
    prisma.notification.findUnique.mockResolvedValue(
      makeNotification({ deliveryStatus: "DELIVERED" }),
    );

    await expect(handleNotificationJob(makeJob())).resolves.toEqual({
      outcome: "skipped",
      reason: "ALREADY_PROCESSED",
      status: "DELIVERED",
    });
    expect(prisma.notification.updateMany).not.toHaveBeenCalled();
  });

  test("skips when another worker already claimed the row", async () => {
    prisma.notification.findUnique.mockResolvedValue(makeNotification());
    prisma.notification.updateMany.mockResolvedValue({ count: 0 });

    await expect(handleNotificationJob(makeJob())).resolves.toEqual({
      outcome: "skipped",
      reason: "CLAIMED_BY_ANOTHER_WORKER",
    });
    expect(deliverNotification).not.toHaveBeenCalled();
  });

  test("marks a notification failed once the delivery-attempt budget is spent", async () => {
    prisma.notification.findUnique.mockResolvedValue(
      makeNotification({ deliveryAttempts: 5 }),
    );

    await expect(
      handleNotificationJob(makeJob(), { maxDeliveryAttempts: 5 }),
    ).resolves.toEqual({
      outcome: "skipped",
      reason: "DELIVERY_ATTEMPTS_EXHAUSTED",
    });

    expect(prisma.notification.updateMany).toHaveBeenCalledWith({
      where: { id: NOTIFICATION_ID, deliveryStatus: "PENDING" },
      data: {
        deliveryStatus: "FAILED",
        deliveredAt: expect.any(Date),
        deliveryStartedAt: null,
      },
    });
    expect(deliverNotification).not.toHaveBeenCalled();
  });

  test("persists the delivery result after a successful send", async () => {
    prisma.notification.findUnique.mockResolvedValue(makeNotification());
    deliverNotification.mockResolvedValue({
      outcome: "delivered",
      channels: { inApp: "delivered", email: "delivered" },
    });

    const result = await handleNotificationJob(makeJob());

    expect(result.outcome).toBe("delivered");
    expect(prisma.notification.updateMany).toHaveBeenCalledWith({
      where: { id: NOTIFICATION_ID, deliveryStatus: "PENDING" },
      data: {
        deliveryStatus: "SENDING",
        deliveryAttempts: { increment: 1 },
        deliveryStartedAt: expect.any(Date),
      },
    });
    expect(prisma.notification.update).toHaveBeenCalledWith({
      where: { id: NOTIFICATION_ID },
      data: expect.objectContaining({
        deliveryStatus: "DELIVERED",
        deliveredAt: expect.any(Date),
        deliveryChannels: { inApp: "delivered", email: "delivered" },
      }),
    });
  });

  test("returns the row to PENDING after a transient failure", async () => {
    prisma.notification.findUnique.mockResolvedValue(makeNotification());
    const transient = Object.assign(new Error("email down"), {
      permanent: false,
      channels: { inApp: "delivered", email: "failed" },
    });
    deliverNotification.mockRejectedValue(transient);

    await expect(handleNotificationJob(makeJob())).rejects.toThrow("email down");

    expect(prisma.notification.updateMany).toHaveBeenLastCalledWith({
      where: { id: NOTIFICATION_ID, deliveryStatus: "SENDING" },
      data: {
        deliveryStatus: "PENDING",
        deliveryChannels: { inApp: "delivered", email: "failed" },
        deliveredAt: null,
        deliveryStartedAt: null,
      },
    });
  });

  test("marks a permanent failure and does not retry", async () => {
    prisma.notification.findUnique.mockResolvedValue(makeNotification());
    const permanent = Object.assign(new Error("invalid recipient"), {
      permanent: true,
      channels: { inApp: "delivered", email: "failed" },
    });
    deliverNotification.mockRejectedValue(permanent);

    await expect(handleNotificationJob(makeJob())).rejects.toMatchObject({
      name: "UnrecoverableError",
    });

    expect(prisma.notification.updateMany).toHaveBeenLastCalledWith({
      where: { id: NOTIFICATION_ID, deliveryStatus: "SENDING" },
      data: {
        deliveryStatus: "FAILED",
        deliveryChannels: { inApp: "delivered", email: "failed" },
        deliveredAt: expect.any(Date),
        deliveryStartedAt: null,
      },
    });
  });

  test("scan-pending reclaims stale SENDING rows and enqueues pending ones", async () => {
    prisma.notification.updateMany.mockResolvedValue({ count: 1 });
    prisma.notification.findMany.mockResolvedValue([
      { id: "a" },
      { id: "b" },
    ]);
    requeueNotificationDelivery
      .mockResolvedValueOnce({ enqueued: true })
      .mockResolvedValueOnce({ enqueued: false, reason: "ENQUEUE_TIMEOUT" });

    const result = await handleNotificationJob(
      makeJob({ name: NOTIFICATION_JOB_NAMES.SCAN_PENDING, data: { limit: 10 } }),
      { batchSize: 100, deliveryLeaseMs: 60000 },
    );

    expect(prisma.notification.updateMany).toHaveBeenCalledWith({
      where: {
        deliveryStatus: "SENDING",
        deliveryStartedAt: { lt: expect.any(Date) },
      },
      data: {
        deliveryStatus: "PENDING",
        deliveryStartedAt: null,
      },
    });
    expect(prisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { deliveryStatus: "PENDING" },
        take: 10,
      }),
    );
    expect(requeueNotificationDelivery).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      scanned: 2,
      enqueued: 1,
      notEnqueued: 1,
      reclaimed: 1,
    });
  });
});
