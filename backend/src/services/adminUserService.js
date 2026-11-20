const prisma = require("../config/database");
const { AppError } = require("../utils/errors");
const { recordOrderEvent } = require("./orderEventService");

const ADMIN_USER_SELECT = {
  id: true,
  email: true,
  name: true,
  avatarUrl: true,
  role: true,
  isVerified: true,
  isSuspended: true,
  createdAt: true,
  updatedAt: true,
  lastLoginAt: true,
};

async function listAdminUsers({
  page = 1,
  limit = 20,
  search,
  role,
  isSuspended,
  isVerified,
}) {
  const skip = (page - 1) * limit;

  const where = {};

  if (search) {
    where.OR = [
      {
        name: {
          contains: search,
          mode: "insensitive",
        },
      },
      {
        email: {
          contains: search,
          mode: "insensitive",
        },
      },
    ];
  }

  if (role !== undefined) {
    where.role = role;
  }

  if (isSuspended !== undefined) {
    where.isSuspended = isSuspended;
  }

  if (isVerified !== undefined) {
    where.isVerified = isVerified;
  }

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      select: ADMIN_USER_SELECT,
      orderBy: {
        createdAt: "desc",
      },
      skip,
      take: limit,
    }),

    prisma.user.count({
      where,
    }),
  ]);

  return {
    users,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}

async function getAdminUserById(userId) {
  const user = await prisma.user.findUnique({
    where: {
      id: userId,
    },
    select: ADMIN_USER_SELECT,
  });

  if (!user) {
    throw AppError.notFound("User not found.", "USER_NOT_FOUND");
  }

  return user;
}

async function setAdminUserSuspension({ actorId, targetId, isSuspended, reason }) {
  return prisma.$transaction(async (tx) => {
    const target = await tx.user.findUnique({
      where: { id: targetId },
      select: { id: true, role: true, isSuspended: true },
    });
    if (!target) throw AppError.notFound("User not found.", "USER_NOT_FOUND");
    if (isSuspended && actorId === targetId) {
      throw AppError.conflict("Administrators cannot suspend their own account.", "ADMIN_SELF_SUSPENSION");
    }
    if (isSuspended && target.role === "ADMIN" && !target.isSuspended) {
      const activeAdmins = await tx.user.count({ where: { role: "ADMIN", isSuspended: false } });
      if (activeAdmins <= 1) throw AppError.conflict("The last active administrator cannot be suspended.", "LAST_ACTIVE_ADMIN");
    }

    if (target.isSuspended !== isSuspended) {
      await tx.user.update({ where: { id: targetId }, data: { isSuspended } });
      if (isSuspended) {
        await tx.refreshToken.updateMany({ where: { userId: targetId, revokedAt: null }, data: { revokedAt: new Date() } });
        const pendingOrders = await tx.order.findMany({
          where: { status: "PENDING", portfolio: { userId: targetId } },
          select: { id: true, portfolioId: true, reservedCash: true },
        });
        for (const order of pendingOrders) {
          const changed = await tx.order.updateMany({
            where: { id: order.id, status: "PENDING" },
            data: { status: "CANCELLED", reservedCash: 0 },
          });
          if (!changed.count) continue;
          if (order.reservedCash.gt(0)) {
            await tx.portfolio.update({ where: { id: order.portfolioId }, data: { reservedCash: { decrement: order.reservedCash } } });
          }
          await recordOrderEvent(tx, { orderId: order.id, eventType: "CANCELLED", previousStatus: "PENDING", newStatus: "CANCELLED", metadata: { reason: "ACCOUNT_SUSPENDED" } });
        }
      }
      await tx.adminAccountAction.create({ data: { actorId, targetId, action: isSuspended ? "SUSPENDED" : "UNSUSPENDED", reason } });
    }

    return tx.user.findUnique({ where: { id: targetId }, select: ADMIN_USER_SELECT });
  }, { isolationLevel: "Serializable" });
}

module.exports = {
  listAdminUsers,
  getAdminUserById,
  setAdminUserSuspension,
};
