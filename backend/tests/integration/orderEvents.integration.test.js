const request = require("supertest");
const app = require("../../src/app");
const prisma = require("../../src/config/database");
const orderService = require("../../src/services/orderService");
const tradeService = require("../../src/services/tradeService");
const { recordOrderEvent } = require("../../src/services/orderEventService");
const orderWorker = require("../../src/workers/orderWorker");
const marketDataService = require("../../src/services/marketData");

const timestamp = Date.now();

let userA;
let tokenA;
let portfolioAId;

let userB;
let tokenB;
let portfolioBId;

let quoteSpy;

beforeAll(async () => {
  jest.setTimeout(30000);

  quoteSpy = jest
    .spyOn(marketDataService, "getQuote")
    .mockResolvedValue({ price: "150" });

  // Register User A
  const resA = await request(app).post("/api/v1/auth/register").send({
    name: "Audit User A",
    email: `audit-a-${timestamp}@stox.local`,
    password: "Password123!",
  });
  userA = resA.body.data.user;
  tokenA = resA.body.data.accessToken;

  const portResA = await request(app)
    .get("/api/v1/portfolios")
    .set("Authorization", `Bearer ${tokenA}`);
  portfolioAId = portResA.body.data.portfolios[0].id;

  // Register User B
  const resB = await request(app).post("/api/v1/auth/register").send({
    name: "Audit User B",
    email: `audit-b-${timestamp}@stox.local`,
    password: "Password123!",
  });
  userB = resB.body.data.user;
  tokenB = resB.body.data.accessToken;

  const portResB = await request(app)
    .get("/api/v1/portfolios")
    .set("Authorization", `Bearer ${tokenB}`);
  portfolioBId = portResB.body.data.portfolios[0].id;
});

afterAll(async () => {
  if (quoteSpy) {
    quoteSpy.mockRestore();
  }

  if (userA?.id) {
    await prisma.user.delete({ where: { id: userA.id } }).catch(() => {});
  }

  if (userB?.id) {
    await prisma.user.delete({ where: { id: userB.id } }).catch(() => {});
  }

  await prisma.$disconnect();
});

describe("Order-Event Audit Trail Integration", () => {
  describe("Order Placement Lifecycle Event", () => {
    test("atomically persists the initial CREATED event with sequence 1 and PENDING status", async () => {
      const order = await orderService.createOrder({
        userId: userA.id,
        portfolioId: portfolioAId,
        symbol: "AAPL",
        assetType: "STOCK",
        side: "BUY",
        type: "MARKET",
        quantity: "2",
      });

      expect(order.status).toBe("PENDING");

      const events = await prisma.orderEvent.findMany({
        where: { orderId: order.id },
        orderBy: [{ sequence: "asc" }],
      });

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        orderId: order.id,
        sequence: 1,
        eventType: "CREATED",
        previousStatus: null,
        newStatus: "PENDING",
      });
      expect(events[0].metadata).toMatchObject({
        symbol: "AAPL",
        side: "BUY",
        type: "MARKET",
        quantity: "2",
      });
      expect(events[0].createdAt).toBeInstanceOf(Date);
    });
  });

  describe("Order Execution Lifecycle Event", () => {
    test("atomically records an EXECUTED event in the execution transaction", async () => {
      const order = await orderService.createOrder({
        userId: userA.id,
        portfolioId: portfolioAId,
        symbol: "MSFT",
        assetType: "STOCK",
        side: "BUY",
        type: "MARKET",
        quantity: "1",
      });

      const trade = await tradeService.executeOrder(order.id, "200");
      expect(trade).toBeDefined();

      const events = await prisma.orderEvent.findMany({
        where: { orderId: order.id },
        orderBy: [{ sequence: "asc" }],
      });

      expect(events).toHaveLength(2);
      expect(events[0].eventType).toBe("CREATED");
      expect(events[0].sequence).toBe(1);

      expect(events[1]).toMatchObject({
        orderId: order.id,
        sequence: 2,
        eventType: "EXECUTED",
        previousStatus: "PENDING",
        newStatus: "EXECUTED",
      });
      expect(events[1].metadata).toMatchObject({
        tradeId: trade.id,
        executionPrice: "200",
        quantity: "1",
      });
    });
  });

  describe("Order Cancellation Lifecycle Event", () => {
    test("atomically records a CANCELLED event when cancelled via orderService", async () => {
      const order = await orderService.createOrder({
        userId: userA.id,
        portfolioId: portfolioAId,
        symbol: "NVDA",
        assetType: "STOCK",
        side: "BUY",
        type: "LIMIT",
        quantity: "1",
        limitPrice: "100",
      });

      const cancelled = await orderService.cancelOrder({
        userId: userA.id,
        orderId: order.id,
      });

      expect(cancelled.status).toBe("CANCELLED");

      const events = await prisma.orderEvent.findMany({
        where: { orderId: order.id },
        orderBy: [{ sequence: "asc" }],
      });

      expect(events).toHaveLength(2);
      expect(events[0].eventType).toBe("CREATED");
      expect(events[0].sequence).toBe(1);

      expect(events[1]).toMatchObject({
        orderId: order.id,
        sequence: 2,
        eventType: "CANCELLED",
        previousStatus: "PENDING",
        newStatus: "CANCELLED",
      });
      expect(events[1].metadata).toMatchObject({
        reason: "USER_CANCELLED",
      });
    });
  });

  describe("Order Expiration Lifecycle Event", () => {
    test("records an EXPIRED event when worker processes an expired order", async () => {
      const order = await orderService.createOrder({
        userId: userA.id,
        portfolioId: portfolioAId,
        symbol: "TSLA",
        assetType: "STOCK",
        side: "BUY",
        type: "LIMIT",
        quantity: "1",
        limitPrice: "50",
      });

      // Set expiresAt in the past
      await prisma.order.update({
        where: { id: order.id },
        data: { expiresAt: new Date(Date.now() - 60000) },
      });

      const summary = await orderWorker.processPendingOrders({
        portfolioId: portfolioAId,
        now: new Date(),
      });

      expect(summary.expired).toBeGreaterThanOrEqual(1);

      const events = await prisma.orderEvent.findMany({
        where: { orderId: order.id },
        orderBy: [{ sequence: "asc" }],
      });

      expect(events).toHaveLength(2);
      expect(events[1]).toMatchObject({
        orderId: order.id,
        sequence: 2,
        eventType: "EXPIRED",
        previousStatus: "PENDING",
        newStatus: "EXPIRED",
      });
      expect(events[1].metadata).toMatchObject({
        reason: "ORDER_EXPIRED",
      });
    });
  });

  describe("Order Rejection Lifecycle Events", () => {
    test("records a REJECTED event on terminal failure (insufficient position on sell)", async () => {
      await prisma.holding.create({
        data: {
          portfolioId: portfolioAId,
          symbol: "UNOWNED",
          assetType: "STOCK",
          quantity: 10,
          averageBuyPrice: 100,
          totalInvested: 1000,
        },
      });

      const order = await orderService.createOrder({
        userId: userA.id,
        portfolioId: portfolioAId,
        symbol: "UNOWNED",
        assetType: "STOCK",
        side: "SELL",
        type: "MARKET",
        quantity: "10",
      });

      await prisma.holding.deleteMany({
        where: { portfolioId: portfolioAId, symbol: "UNOWNED" },
      });

      const fakeProvider = {
        getQuote: jest.fn().mockResolvedValue({ price: "100" }),
      };

      const summary = await orderWorker.processPendingOrders({
        portfolioId: portfolioAId,
        quoteProvider: fakeProvider,
      });

      expect(summary.rejected).toBeGreaterThanOrEqual(1);

      const updated = await prisma.order.findUnique({
        where: { id: order.id },
      });
      expect(updated.status).toBe("REJECTED");

      const events = await prisma.orderEvent.findMany({
        where: { orderId: order.id },
        orderBy: [{ sequence: "asc" }],
      });

      expect(events).toHaveLength(2);
      expect(events[1]).toMatchObject({
        orderId: order.id,
        sequence: 2,
        eventType: "REJECTED",
        previousStatus: "PENDING",
        newStatus: "REJECTED",
      });
      expect(events[1].metadata).toMatchObject({
        reason: "INSUFFICIENT_POSITION",
      });
    });

    test("records a REJECTED event when retry budget is exhausted", async () => {
      const order = await orderService.createOrder({
        userId: userA.id,
        portfolioId: portfolioAId,
        symbol: "FAILING",
        assetType: "STOCK",
        side: "BUY",
        type: "MARKET",
        quantity: "1",
      });

      await prisma.order.update({
        where: { id: order.id },
        data: { executionAttempts: 4 },
      });

      const failingProvider = {
        getQuote: jest.fn().mockRejectedValue(new Error("Transient 503 error")),
      };

      const summary = await orderWorker.processPendingOrders({
        portfolioId: portfolioAId,
        quoteProvider: failingProvider,
        maxAttempts: 5,
      });

      expect(summary.rejected).toBeGreaterThanOrEqual(1);

      const events = await prisma.orderEvent.findMany({
        where: { orderId: order.id },
        orderBy: [{ sequence: "asc" }],
      });

      expect(events).toHaveLength(2);
      expect(events[1]).toMatchObject({
        orderId: order.id,
        sequence: 2,
        eventType: "REJECTED",
        previousStatus: "PENDING",
        newStatus: "REJECTED",
      });
      expect(events[1].metadata).toMatchObject({
        reason: "MAX_ATTEMPTS_EXCEEDED",
        executionAttempts: 5,
      });
    });
  });

  describe("Unchanged Status & Invalid Transitions", () => {
    test("transient error below retry budget does not create a duplicate event", async () => {
      const order = await orderService.createOrder({
        userId: userA.id,
        portfolioId: portfolioAId,
        symbol: "TRANSIENT",
        assetType: "STOCK",
        side: "BUY",
        type: "MARKET",
        quantity: "1",
      });

      const failingProvider = {
        getQuote: jest.fn().mockRejectedValue(new Error("Network timeout")),
      };

      const summary = await orderWorker.processPendingOrders({
        portfolioId: portfolioAId,
        quoteProvider: failingProvider,
        maxAttempts: 5,
      });

      expect(summary.failed).toBeGreaterThanOrEqual(1);

      // Order is still PENDING
      const current = await prisma.order.findUnique({
        where: { id: order.id },
      });
      expect(current.status).toBe("PENDING");
      expect(current.executionAttempts).toBe(1);

      // Event count remains 1
      const events = await prisma.orderEvent.findMany({
        where: { orderId: order.id },
      });
      expect(events).toHaveLength(1);
      expect(events[0].sequence).toBe(1);
    });

    test("invalid transition attempt does not generate an event", async () => {
      const order = await orderService.createOrder({
        userId: userA.id,
        portfolioId: portfolioAId,
        symbol: "AMZN",
        assetType: "STOCK",
        side: "BUY",
        type: "MARKET",
        quantity: "1",
      });

      // Cancel it
      await orderService.cancelOrder({
        userId: userA.id,
        orderId: order.id,
      });

      // Attempt to cancel again (invalid transition)
      await expect(
        orderService.cancelOrder({
          userId: userA.id,
          orderId: order.id,
        }),
      ).rejects.toMatchObject({
        code: "ORDER_NOT_CANCELLABLE",
      });

      // Exactly 2 events exist (CREATED, CANCELLED)
      const events = await prisma.orderEvent.findMany({
        where: { orderId: order.id },
        orderBy: [{ sequence: "asc" }],
      });
      expect(events).toHaveLength(2);
      expect(events[0].eventType).toBe("CREATED");
      expect(events[1].eventType).toBe("CANCELLED");
    });
  });

  describe("Transaction Integrity & Rollback", () => {
    test("rolls back order status transition if event insertion fails", async () => {
      const order = await orderService.createOrder({
        userId: userA.id,
        portfolioId: portfolioAId,
        symbol: "GOOG",
        assetType: "STOCK",
        side: "BUY",
        type: "MARKET",
        quantity: "1",
      });

      // Pre-seed an event with sequence 2 to force a unique constraint violation on (orderId, sequence)
      await prisma.orderEvent.create({
        data: {
          orderId: order.id,
          sequence: 2,
          eventType: "CANCELLED",
          previousStatus: "PENDING",
          newStatus: "CANCELLED",
        },
      });

      // Now attempting to execute the order should attempt to insert sequence 2+1=3 (if locking highest)
      // Or if forced to conflict on sequence 2:
      let failed = false;
      try {
        await prisma.$transaction(async (tx) => {
          await tx.order.update({
            where: { id: order.id },
            data: { status: "EXECUTED" },
          });

          // Insert duplicate sequence 2 deliberately
          await tx.orderEvent.create({
            data: {
              orderId: order.id,
              sequence: 2, // duplicate!
              eventType: "EXECUTED",
              previousStatus: "PENDING",
              newStatus: "EXECUTED",
            },
          });
        });
      } catch (err) {
        failed = true;
      }

      expect(failed).toBe(true);

      // Verify the order did NOT remain EXECUTED
      const current = await prisma.order.findUnique({
        where: { id: order.id },
      });
      expect(current.status).toBe("PENDING");
    });
  });

  describe("Concurrent Transition Safety", () => {
    test("concurrent execution and cancellation produce exactly one terminal transition and clean sequence", async () => {
      const order = await orderService.createOrder({
        userId: userA.id,
        portfolioId: portfolioAId,
        symbol: "META",
        assetType: "STOCK",
        side: "BUY",
        type: "MARKET",
        quantity: "1",
      });

      // Race cancelOrder and executeOrder simultaneously
      const results = await Promise.allSettled([
        orderService.cancelOrder({ userId: userA.id, orderId: order.id }),
        tradeService.executeOrder(order.id, "100"),
      ]);

      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");

      // Exactly one must succeed, the other must fail with conflict code
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);

      // Verify events: exactly 2 events (CREATED with seq 1, and the winner with seq 2)
      const events = await prisma.orderEvent.findMany({
        where: { orderId: order.id },
        orderBy: [{ sequence: "asc" }],
      });

      expect(events).toHaveLength(2);
      expect(events[0].sequence).toBe(1);
      expect(events[0].eventType).toBe("CREATED");

      expect(events[1].sequence).toBe(2);
      expect(["EXECUTED", "CANCELLED"]).toContain(events[1].eventType);
    });

    test("two simultaneous event writes cannot produce duplicate or out-of-order sequence numbers", async () => {
      const order = await orderService.createOrder({
        userId: userA.id,
        portfolioId: portfolioAId,
        symbol: "NVDA",
        assetType: "STOCK",
        side: "BUY",
        type: "MARKET",
        quantity: "1",
      });

      // Verify initial CREATED event is sequence 1
      const initialEvents = await prisma.orderEvent.findMany({
        where: { orderId: order.id },
      });
      expect(initialEvents).toHaveLength(1);
      expect(initialEvents[0].sequence).toBe(1);

      // Execute two simultaneous transactions both recording an event on this order
      const [res1, res2] = await Promise.all([
        prisma.$transaction(async (tx) => {
          return recordOrderEvent(tx, {
            orderId: order.id,
            eventType: "EXECUTED",
            previousStatus: "PENDING",
            newStatus: "EXECUTED",
            metadata: { workerId: "worker-A" },
          });
        }),
        prisma.$transaction(async (tx) => {
          return recordOrderEvent(tx, {
            orderId: order.id,
            eventType: "REJECTED",
            previousStatus: "PENDING",
            newStatus: "REJECTED",
            metadata: { workerId: "worker-B" },
          });
        }),
      ]);

      expect(res1).toBeDefined();
      expect(res2).toBeDefined();

      // Sequence numbers must be strictly unique and allocate 2 and 3
      const returnedSequences = [res1.sequence, res2.sequence].sort((a, b) => a - b);
      expect(returnedSequences).toEqual([2, 3]);

      // Read back from database to verify all events in chronological sequence order
      const allEvents = await prisma.orderEvent.findMany({
        where: { orderId: order.id },
        orderBy: [{ sequence: "asc" }],
      });

      expect(allEvents).toHaveLength(3);
      expect(allEvents.map((e) => e.sequence)).toEqual([1, 2, 3]);
      expect(allEvents[0].eventType).toBe("CREATED");
      expect([allEvents[1].eventType, allEvents[2].eventType]).toEqual(
        expect.arrayContaining(["EXECUTED", "REJECTED"]),
      );
    });

    test("multiple (4) simultaneous event writes serialize correctly without deadlocks or collisions", async () => {
      const order = await orderService.createOrder({
        userId: userA.id,
        portfolioId: portfolioAId,
        symbol: "AMD",
        assetType: "STOCK",
        side: "BUY",
        type: "MARKET",
        quantity: "1",
      });

      const writePromises = [1, 2, 3, 4].map((i) =>
        prisma.$transaction((tx) =>
          recordOrderEvent(tx, {
            orderId: order.id,
            eventType: i % 2 === 0 ? "EXECUTED" : "CANCELLED",
            previousStatus: "PENDING",
            newStatus: i % 2 === 0 ? "EXECUTED" : "CANCELLED",
            metadata: { batchIndex: i },
          }),
        ),
      );

      const results = await Promise.all(writePromises);
      expect(results).toHaveLength(4);

      const returnedSequences = results.map((r) => r.sequence).sort((a, b) => a - b);
      expect(returnedSequences).toEqual([2, 3, 4, 5]);

      const eventsInDb = await prisma.orderEvent.findMany({
        where: { orderId: order.id },
        orderBy: [{ sequence: "asc" }],
      });

      expect(eventsInDb).toHaveLength(5);
      expect(eventsInDb.map((e) => e.sequence)).toEqual([1, 2, 3, 4, 5]);
    });
  });

  describe("API Endpoint: GET /api/v1/orders/:id/events", () => {
    let testOrder;

    beforeAll(async () => {
      testOrder = await orderService.createOrder({
        userId: userA.id,
        portfolioId: portfolioAId,
        symbol: "DIS",
        assetType: "STOCK",
        side: "BUY",
        type: "MARKET",
        quantity: "2",
      });

      await tradeService.executeOrder(testOrder.id, "110");
    });

    test("returns 401 UNAUTHORIZED when no token is provided", async () => {
      const res = await request(app).get(
        `/api/v1/orders/${testOrder.id}/events`,
      );

      expect(res.status).toBe(401);
      expect(res.body).toMatchObject({
        success: false,
        error: { code: "UNAUTHORIZED" },
      });
    });

    test("returns 400 VALIDATION_ERROR when order id is not a valid UUID", async () => {
      const res = await request(app)
        .get("/api/v1/orders/not-a-uuid/events")
        .set("Authorization", `Bearer ${tokenA}`);

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({
        success: false,
        error: { code: "VALIDATION_ERROR" },
      });
    });

    test("returns 404 ORDER_NOT_FOUND when order does not exist", async () => {
      const res = await request(app)
        .get("/api/v1/orders/00000000-0000-4000-8000-000000000000/events")
        .set("Authorization", `Bearer ${tokenA}`);

      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({
        success: false,
        error: { code: "ORDER_NOT_FOUND" },
      });
    });

    test("returns 404 ORDER_NOT_FOUND when accessing another user's order events (ownership isolation)", async () => {
      // User B tries to get User A's order events
      const res = await request(app)
        .get(`/api/v1/orders/${testOrder.id}/events`)
        .set("Authorization", `Bearer ${tokenB}`);

      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({
        success: false,
        error: { code: "ORDER_NOT_FOUND" },
      });
    });

    test("returns 200 OK with chronological order events for owner", async () => {
      const res = await request(app)
        .get(`/api/v1/orders/${testOrder.id}/events`)
        .set("Authorization", `Bearer ${tokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data.events)).toBe(true);

      const events = res.body.data.events;
      expect(events).toHaveLength(2);

      // Chronological order
      expect(events[0]).toMatchObject({
        orderId: testOrder.id,
        sequence: 1,
        eventType: "CREATED",
        previousStatus: null,
        newStatus: "PENDING",
      });
      expect(events[0].metadata).toMatchObject({
        symbol: "DIS",
        side: "BUY",
        quantity: "2",
      });

      expect(events[1]).toMatchObject({
        orderId: testOrder.id,
        sequence: 2,
        eventType: "EXECUTED",
        previousStatus: "PENDING",
        newStatus: "EXECUTED",
      });
      expect(events[1].metadata).toMatchObject({
        executionPrice: "110",
        quantity: "2",
      });
    });
  });
});
