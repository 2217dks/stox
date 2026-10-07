const prisma = require("../config/database");
const { AppError } = require("../utils/errors");

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

module.exports = {
  listAdminUsers,
  getAdminUserById,
};
