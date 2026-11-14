const {
  ORDER_EVENT_TYPES,
  serializeOrderEvent,
  recordOrderEvent,
  getOrderEvents,
} = require("../../../src/services/orderEventService");
const prisma = require("../../../src/config/database");

jest.mock("../../../src/config/database", () => ({
  order: {
    findFirst: jest.fn(),
  },
  orderEvent: {
    findMany: jest.fn(),
    create: jest.fn(),
  },
}));

describe("orderEventService unit tests", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("serializeOrderEvent", () => {
    test("formats an order event with all fields correctly", () => {
      const now = new Date();
      const raw = {
        id: "event-uuid-1",
        orderId: "order-uuid-1",
        sequence: 1,
        eventType: "CREATED",
        previousStatus: null,
        newStatus: "PENDING",
        metadata: { symbol: "AAPL", side: "BUY" },
        createdAt: now,
      };

      const serialized = serializeOrderEvent(raw);

      expect(serialized).toEqual({
        id: "event-uuid-1",
        orderId: "order-uuid-1",
        sequence: 1,
        eventType: "CREATED",
        previousStatus: null,
        newStatus: "PENDING",
        metadata: { symbol: "AAPL", side: "BUY" },
        createdAt: now,
      });
    });

    test("converts undefined metadata to null", () => {
      const raw = {
        id: "event-uuid-2",
        orderId: "order-uuid-1",
        sequence: 2,
        eventType: "CANCELLED",
        previousStatus: "PENDING",
        newStatus: "CANCELLED",
        metadata: undefined,
        createdAt: new Date(),
      };

      const serialized = serializeOrderEvent(raw);
      expect(serialized.metadata).toBeNull();
    });
  });

  describe("recordOrderEvent", () => {
    test("throws an error if tx is missing or invalid", async () => {
      await expect(
        recordOrderEvent(null, {
          orderId: "order-1",
          eventType: "CREATED",
          newStatus: "PENDING",
        }),
      ).rejects.toThrow("A valid Prisma transaction client is required");
    });

    test("throws an error if orderId is missing", async () => {
      const tx = { orderEvent: { create: jest.fn() } };
      await expect(
        recordOrderEvent(tx, {
          orderId: "",
          eventType: "CREATED",
          newStatus: "PENDING",
        }),
      ).rejects.toThrow("orderId is required");
    });

    test("throws an error if newStatus is missing", async () => {
      const tx = { orderEvent: { create: jest.fn() } };
      await expect(
        recordOrderEvent(tx, {
          orderId: "order-1",
          eventType: "CREATED",
          newStatus: "",
        }),
      ).rejects.toThrow("newStatus is required");
    });

    test("throws ORDER_NOT_FOUND when parent order row is missing", async () => {
      const tx = {
        $queryRaw: jest.fn().mockResolvedValue([]),
        orderEvent: { create: jest.fn() },
      };

      await expect(
        recordOrderEvent(tx, {
          orderId: "order-missing",
          eventType: "CREATED",
          newStatus: "PENDING",
        }),
      ).rejects.toMatchObject({
        code: "ORDER_NOT_FOUND",
      });
    });

    test("locks parent order and uses explicit sequence when provided", async () => {
      const tx = {
        $queryRaw: jest.fn().mockResolvedValue([{ id: "order-1" }]),
        orderEvent: {
          create: jest.fn().mockResolvedValue({ id: "e-1" }),
        },
      };

      await recordOrderEvent(tx, {
        orderId: "order-1",
        sequence: 1,
        eventType: "CREATED",
        previousStatus: null,
        newStatus: "PENDING",
      });

      expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
      expect(tx.orderEvent.create).toHaveBeenCalledWith({
        data: {
          orderId: "order-1",
          sequence: 1,
          eventType: "CREATED",
          previousStatus: null,
          newStatus: "PENDING",
          metadata: undefined,
        },
      });
    });

    test("locks parent order and increments sequence via findFirst when sequence is omitted", async () => {
      const tx = {
        $queryRaw: jest.fn().mockResolvedValue([{ id: "order-1" }]),
        orderEvent: {
          findFirst: jest.fn().mockResolvedValue({ sequence: 1 }),
          create: jest.fn().mockResolvedValue({ id: "e-2" }),
        },
      };

      await recordOrderEvent(tx, {
        orderId: "order-1",
        eventType: "EXECUTED",
        previousStatus: "PENDING",
        newStatus: "EXECUTED",
        metadata: { price: "150" },
      });

      expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
      expect(tx.orderEvent.findFirst).toHaveBeenCalledWith({
        where: { orderId: "order-1" },
        orderBy: { sequence: "desc" },
        select: { sequence: true },
      });
      expect(tx.orderEvent.create).toHaveBeenCalledWith({
        data: {
          orderId: "order-1",
          sequence: 2,
          eventType: "EXECUTED",
          previousStatus: "PENDING",
          newStatus: "EXECUTED",
          metadata: { price: "150" },
        },
      });
    });

    test("allocates sequence 1 when no previous events exist and sequence is omitted", async () => {
      const tx = {
        $queryRaw: jest.fn().mockResolvedValue([{ id: "order-1" }]),
        orderEvent: {
          findFirst: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockResolvedValue({ id: "e-1" }),
        },
      };

      await recordOrderEvent(tx, {
        orderId: "order-1",
        eventType: "CREATED",
        previousStatus: null,
        newStatus: "PENDING",
      });

      expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
      expect(tx.orderEvent.create).toHaveBeenCalledWith({
        data: {
          orderId: "order-1",
          sequence: 1,
          eventType: "CREATED",
          previousStatus: null,
          newStatus: "PENDING",
          metadata: undefined,
        },
      });
    });

    test("falls back to raw query when findFirst is not available on tx.orderEvent", async () => {
      const tx = {
        $queryRaw: jest
          .fn()
          .mockResolvedValueOnce([{ id: "order-1" }]) // order lock
          .mockResolvedValueOnce([{ sequence: 3 }]), // latest sequence query
        orderEvent: {
          create: jest.fn().mockResolvedValue({ id: "e-4" }),
        },
      };

      await recordOrderEvent(tx, {
        orderId: "order-1",
        eventType: "CANCELLED",
        previousStatus: "PENDING",
        newStatus: "CANCELLED",
      });

      expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
      expect(tx.orderEvent.create).toHaveBeenCalledWith({
        data: {
          orderId: "order-1",
          sequence: 4,
          eventType: "CANCELLED",
          previousStatus: "PENDING",
          newStatus: "CANCELLED",
          metadata: undefined,
        },
      });
    });
  });

  describe("getOrderEvents", () => {
    test("throws 404 ORDER_NOT_FOUND when order is missing or owned by another user", async () => {
      prisma.order.findFirst.mockResolvedValue(null);

      await expect(
        getOrderEvents({ userId: "u-1", orderId: "o-1" }),
      ).rejects.toMatchObject({
        statusCode: 404,
        code: "ORDER_NOT_FOUND",
      });
    });

    test("returns chronological events for owned order", async () => {
      prisma.order.findFirst.mockResolvedValue({ id: "o-1" });
      const now = new Date();
      prisma.orderEvent.findMany.mockResolvedValue([
        {
          id: "e-1",
          orderId: "o-1",
          sequence: 1,
          eventType: "CREATED",
          previousStatus: null,
          newStatus: "PENDING",
          metadata: null,
          createdAt: now,
        },
        {
          id: "e-2",
          orderId: "o-1",
          sequence: 2,
          eventType: "EXECUTED",
          previousStatus: "PENDING",
          newStatus: "EXECUTED",
          metadata: { price: "100" },
          createdAt: new Date(now.getTime() + 1000),
        },
      ]);

      const events = await getOrderEvents({ userId: "u-1", orderId: "o-1" });

      expect(events).toHaveLength(2);
      expect(events[0].sequence).toBe(1);
      expect(events[0].eventType).toBe("CREATED");
      expect(events[1].sequence).toBe(2);
      expect(events[1].eventType).toBe("EXECUTED");
    });
  });
});

