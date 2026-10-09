// Contract tests for the cancellation status transition.
//
// docs/API.md + review contract: PENDING -> CANCELLED must be applied
// atomically (conditional update matching id AND status). A request that
// observed PENDING in its eligibility check must never overwrite a row
// that has moved on (e.g. executed by the order worker between check and
// write): it must fail with ORDER_NOT_CANCELLABLE and leave the stored
// status untouched.
//
// The race window cannot be triggered sequentially through the HTTP
// layer, so these tests freeze the Prisma boundary and replay the stale
// snapshot the service would see mid-race.

jest.mock("../../../src/config/database", () => ({
  $disconnect: jest.fn(),
  user: { findUnique: jest.fn() },
  order: {
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
}));

const prisma = require("../../../src/config/database");
const orderService = require("../../../src/services/orderService");

const USER_ID = "11111111-1111-4111-8111-111111111111";
const ORDER_ID = "22222222-2222-4222-8222-222222222222";

function mockActiveUser() {
  prisma.user.findUnique.mockResolvedValue({
    id: USER_ID,
    isSuspended: false,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockActiveUser();
});

describe("cancelOrder conditional status transition", () => {
  test("does not overwrite an order that lost PENDING between check and update", async () => {
    // Ownership/eligibility check observes a stale PENDING snapshot...
    prisma.order.findFirst.mockResolvedValue({
      id: ORDER_ID,
      status: "PENDING",
    });

    // ...while the row has actually been EXECUTED already, so the
    // conditional update matches no rows.
    prisma.order.updateMany.mockResolvedValue({ count: 0 });

    // The failure-path lookup must surface the row's real status.
    prisma.order.findFirst.mockResolvedValueOnce({
      id: ORDER_ID,
      status: "PENDING",
    });
    prisma.order.findUnique.mockResolvedValue({ status: "EXECUTED" });

    await expect(
      orderService.cancelOrder({ userId: USER_ID, orderId: ORDER_ID }),
    ).rejects.toMatchObject({ code: "ORDER_NOT_CANCELLABLE" });

    // The transition must have been attempted conditionally, and the
    // stored status must be untouched (still EXECUTED, never CANCELLED).
    expect(prisma.order.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: ORDER_ID, status: "PENDING" }),
      }),
    );
    expect(prisma.order.update).not.toHaveBeenCalled();
  });

  test("reports ORDER_NOT_FOUND when the row disappears before the transition", async () => {
    prisma.order.findFirst
      .mockResolvedValueOnce({ id: ORDER_ID, status: "PENDING" })
      .mockResolvedValueOnce(null); // row deleted concurrently
    prisma.order.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      orderService.cancelOrder({ userId: USER_ID, orderId: ORDER_ID }),
    ).rejects.toMatchObject({ code: "ORDER_NOT_FOUND" });
  });

  test("conditional transition succeeds only from PENDING", async () => {
    prisma.order.findFirst.mockResolvedValue({
      id: ORDER_ID,
      status: "PENDING",
    });
    prisma.order.updateMany.mockResolvedValue({ count: 1 });
    prisma.order.findUnique.mockResolvedValue({
      id: ORDER_ID,
      portfolioId: "33333333-3333-4333-8333-333333333333",
      symbol: "AAPL",
      assetType: "STOCK",
      side: "BUY",
      type: "MARKET",
      status: "CANCELLED",
      quantity: "1",
      limitPrice: null,
      stopPrice: null,
      executedPrice: null,
      executedAt: null,
      expiresAt: null,
      notes: null,
      source: "MANUAL",
      createdAt: new Date(0),
      updatedAt: new Date(0),
    });

    const result = await orderService.cancelOrder({
      userId: USER_ID,
      orderId: ORDER_ID,
    });

    expect(result.status).toBe("CANCELLED");
  });
});
