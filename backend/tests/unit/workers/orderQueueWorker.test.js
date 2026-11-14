jest.mock("../../../src/config/database", () => ({
  order: { findUnique: jest.fn() },
}));

jest.mock("../../../src/workers/orderWorker", () => ({
  processOrder: jest.fn(),
  processPendingOrders: jest.fn(),
  DEFAULT_MAX_ATTEMPTS: 5,
  DEFAULT_BATCH_SIZE: 100,
}));

const prisma = require("../../../src/config/database");
const {
  processOrder,
  processPendingOrders,
} = require("../../../src/workers/orderWorker");
const {
  handleOrderJob,
} = require("../../../src/workers/orderQueueWorker");
const { ORDER_JOB_NAMES } = require("../../../src/queues/definitions");

const ORDER_ID = "6f1f7c2e-0d7f-4c2a-9b8f-2f9a1d0c3b4e";

function makeJob(overrides = {}) {
  return {
    id: "job-1",
    name: ORDER_JOB_NAMES.EXECUTE_ORDER,
    data: { orderId: ORDER_ID },
    ...overrides,
  };
}

function makeOptions(overrides = {}) {
  return {
    quoteProvider: { getQuote: jest.fn() },
    now: () => new Date("2026-01-01T00:00:00.000Z"),
    retryLimit: 5,
    batchSize: 100,
    ...overrides,
  };
}

describe("order queue job handler", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("rejects an unknown job name as unrecoverable", async () => {
    await expect(
      handleOrderJob(makeJob({ name: "mystery" }), makeOptions()),
    ).rejects.toMatchObject({ name: "UnrecoverableError" });
  });

  describe("execute-order", () => {
    test("treats a deleted order as unrecoverable", async () => {
      prisma.order.findUnique.mockResolvedValue(null);

      await expect(
        handleOrderJob(makeJob(), makeOptions()),
      ).rejects.toMatchObject({ name: "UnrecoverableError" });

      expect(processOrder).not.toHaveBeenCalled();
    });

    test("skips an order that is no longer pending", async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: ORDER_ID,
        status: "EXECUTED",
        portfolio: { id: "p1", isActive: true },
      });

      const result = await handleOrderJob(makeJob(), makeOptions());

      expect(result).toEqual({ outcome: "skipped", status: "EXECUTED" });
      expect(processOrder).not.toHaveBeenCalled();
    });

    test("executes a pending order through the shared processor", async () => {
      const order = {
        id: ORDER_ID,
        status: "PENDING",
        portfolio: { id: "p1", isActive: true },
      };
      prisma.order.findUnique.mockResolvedValue(order);
      processOrder.mockResolvedValue("executed");

      const options = makeOptions();
      const result = await handleOrderJob(makeJob(), options);

      expect(result).toEqual({ outcome: "executed" });
      expect(processOrder).toHaveBeenCalledWith(order, {
        quoteProvider: options.quoteProvider,
        now: options.now(),
        retryLimit: 5,
      });
    });

    test("throws on a transient failure so BullMQ applies backoff", async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: ORDER_ID,
        status: "PENDING",
        portfolio: { id: "p1", isActive: true },
      });
      processOrder.mockResolvedValue("retry");

      await expect(handleOrderJob(makeJob(), makeOptions())).rejects.toThrow(
        /transient/i,
      );
    });

    test("completes without retrying when the order was rejected", async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: ORDER_ID,
        status: "PENDING",
        portfolio: { id: "p1", isActive: true },
      });
      processOrder.mockResolvedValue("rejected");

      const result = await handleOrderJob(makeJob(), makeOptions());

      expect(result).toEqual({ outcome: "rejected" });
    });

    test("skips an order whose portfolio was deactivated", async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: ORDER_ID,
        status: "PENDING",
        portfolio: { id: "p1", isActive: false },
      });

      const result = await handleOrderJob(makeJob(), makeOptions());

      expect(result).toEqual({ outcome: "skipped", status: "PENDING" });
      expect(processOrder).not.toHaveBeenCalled();
    });
  });

  describe("scan-pending", () => {
    test("runs one scan pass with the job payload filters", async () => {
      processPendingOrders.mockResolvedValue({ scanned: 2, executed: 1 });

      const result = await handleOrderJob(
        makeJob({
          name: ORDER_JOB_NAMES.SCAN_PENDING,
          data: { portfolioId: "0b6d5a1c-2f3e-4a5b-8c9d-1e2f3a4b5c6d", limit: 10 },
        }),
        makeOptions(),
      );

      expect(result).toEqual({ scanned: 2, executed: 1 });
      expect(processPendingOrders).toHaveBeenCalledWith({
        quoteProvider: expect.any(Object),
        now: expect.any(Date),
        portfolioId: "0b6d5a1c-2f3e-4a5b-8c9d-1e2f3a4b5c6d",
        limit: 10,
        maxAttempts: 5,
      });
    });

    test("falls back to the default batch size", async () => {
      processPendingOrders.mockResolvedValue({ scanned: 0 });

      await handleOrderJob(
        makeJob({ name: ORDER_JOB_NAMES.SCAN_PENDING, data: {} }),
        makeOptions(),
      );

      expect(processPendingOrders).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 100 }),
      );
    });
  });
});
