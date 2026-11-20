jest.mock("../../../src/config/database", () => ({ $transaction: jest.fn() }));
jest.mock("../../../src/services/orderEventService", () => ({ recordOrderEvent: jest.fn() }));

const prisma = require("../../../src/config/database");
const { recordOrderEvent } = require("../../../src/services/orderEventService");
const { setAdminUserSuspension } = require("../../../src/services/adminUserService");

function transactionFor({ isSuspended = false, role = "TRADER", admins = 2, orders = [] } = {}) {
  const target = { id: "target", role, isSuspended };
  const tx = {
    user: {
      findUnique: jest.fn(async () => target),
      count: jest.fn(async () => admins),
      update: jest.fn(async ({ data }) => Object.assign(target, data)),
    },
    refreshToken: { updateMany: jest.fn(async () => ({ count: 2 })) },
    order: {
      findMany: jest.fn(async () => orders),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    portfolio: { update: jest.fn(async () => ({})) },
    adminAccountAction: { create: jest.fn(async () => ({})) },
  };
  prisma.$transaction.mockImplementation((callback) => callback(tx));
  return { tx, target };
}

describe("admin account suspension", () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it("revokes refresh tokens, cancels pending orders, releases reservations, and audits the decision", async () => {
    const reservedCash = { gt: (value) => value === 0, toString: () => "12.5" };
    const { tx } = transactionFor({ orders: [{ id: "order-1", portfolioId: "portfolio-1", reservedCash }] });
    const result = await setAdminUserSuspension({ actorId: "admin", targetId: "target", isSuspended: true, reason: "Policy violation" });
    expect(result.isSuspended).toBe(true);
    expect(tx.refreshToken.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: "target", revokedAt: null } }));
    expect(tx.order.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "order-1", status: "PENDING" }, data: { status: "CANCELLED", reservedCash: 0 } }));
    expect(tx.portfolio.update).toHaveBeenCalledWith({ where: { id: "portfolio-1" }, data: { reservedCash: { decrement: reservedCash } } });
    expect(recordOrderEvent).toHaveBeenCalledWith(tx, expect.objectContaining({ orderId: "order-1", newStatus: "CANCELLED" }));
    expect(tx.adminAccountAction.create).toHaveBeenCalledWith({ data: { actorId: "admin", targetId: "target", action: "SUSPENDED", reason: "Policy violation" } });
  });

  it("does not create a second audit record for an idempotent request", async () => {
    const { tx } = transactionFor({ isSuspended: true });
    await setAdminUserSuspension({ actorId: "admin", targetId: "target", isSuspended: true, reason: "Duplicate" });
    expect(tx.adminAccountAction.create).not.toHaveBeenCalled();
  });

  it("rejects self-suspension and suspension of the last active administrator", async () => {
    transactionFor({ role: "ADMIN" });
    await expect(setAdminUserSuspension({ actorId: "target", targetId: "target", isSuspended: true, reason: "Self" })).rejects.toMatchObject({ code: "ADMIN_SELF_SUSPENSION" });
    transactionFor({ role: "ADMIN", admins: 1 });
    await expect(setAdminUserSuspension({ actorId: "admin", targetId: "target", isSuspended: true, reason: "Last" })).rejects.toMatchObject({ code: "LAST_ACTIVE_ADMIN" });
  });
});
