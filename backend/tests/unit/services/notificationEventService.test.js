jest.mock("../../../src/config/database", () => ({
  notification: {
    upsert: jest.fn(),
  },
}));

jest.mock("../../../src/queues/notificationQueue", () => ({
  enqueueNotificationDelivery: jest.fn(async () => ({ enqueued: true })),
}));

const prisma = require("../../../src/config/database");
const {
  enqueueNotificationDelivery,
} = require("../../../src/queues/notificationQueue");
const {
  createNotificationEvent,
} = require("../../../src/services/notificationEventService");

describe("notificationEventService", () => {
  const input = {
    eventKey: "order:order-1:executed",
    userId: "user-1",
    type: "ORDER_EXECUTED",
    title: "Order executed",
    message: "BUY 1 AAPL executed.",
    data: { orderId: "order-1" },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.notification.upsert.mockResolvedValue({ id: "notification-1" });
  });

  test("upserts by stable event key and enqueues the persisted notification", async () => {
    const result = await createNotificationEvent(input);

    expect(prisma.notification.upsert).toHaveBeenCalledWith({
      where: { eventKey: input.eventKey },
      create: input,
      update: {},
    });
    expect(result).toEqual({ id: "notification-1" });
    expect(enqueueNotificationDelivery).toHaveBeenCalledWith({
      notificationId: "notification-1",
    });
  });

  test("can persist inside the source transaction and defer enqueue until commit", async () => {
    const transaction = {
      notification: { upsert: jest.fn().mockResolvedValue({ id: "in-tx" }) },
    };

    const result = await createNotificationEvent(input, {
      db: transaction,
      enqueue: false,
    });

    expect(transaction.notification.upsert).toHaveBeenCalledWith({
      where: { eventKey: input.eventKey },
      create: input,
      update: {},
    });
    expect(result).toEqual({ id: "in-tx" });
    expect(enqueueNotificationDelivery).not.toHaveBeenCalled();
  });

  test("requires an event key so producers cannot silently opt out of deduplication", async () => {
    await expect(
      createNotificationEvent({ ...input, eventKey: " " }),
    ).rejects.toThrow("A stable notification eventKey is required.");

    expect(prisma.notification.upsert).not.toHaveBeenCalled();
  });
});
