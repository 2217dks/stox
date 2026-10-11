const prisma = require("../config/database");
const { AppError } = require("../utils/errors");

async function ensureActiveUser(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      isSuspended: true,
    },
  });

  if (!user) {
    throw AppError.notFound("User not found.", "USER_NOT_FOUND");
  }

  if (user.isSuspended) {
    throw AppError.forbidden("Account is suspended.", "ACCOUNT_SUSPENDED");
  }

  return user;
}

function serializeNotification(notification) {
  return {
    id: notification.id,
    userId: notification.userId,
    type: notification.type,
    title: notification.title,
    message: notification.message,
    data: notification.data,
    isRead: notification.isRead,
    readAt: notification.readAt,
    createdAt: notification.createdAt,
  };
}

async function listNotifications(userId, { page = 1, limit = 20, isRead } = {}) {
  await ensureActiveUser(userId);

  const where = { userId };

  if (isRead !== undefined) {
    where.isRead = isRead;
  }

  const skip = (page - 1) * limit;

  const [notifications, total] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: {
        createdAt: "desc",
      },
      skip,
      take: limit,
    }),

    prisma.notification.count({
      where,
    }),
  ]);

  return {
    notifications: notifications.map(serializeNotification),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}

async function markNotificationRead(userId, notificationId) {
  await ensureActiveUser(userId);

  const notification = await prisma.notification.findFirst({
    where: {
      id: notificationId,
      userId,
    },
  });

  if (!notification) {
    throw AppError.notFound(
      "Notification not found.",
      "NOTIFICATION_NOT_FOUND",
    );
  }

  // Idempotent: an already-read notification keeps its original readAt.
  if (notification.isRead) {
    return serializeNotification(notification);
  }

  const updated = await prisma.notification.update({
    where: { id: notificationId },
    data: {
      isRead: true,
      readAt: new Date(),
    },
  });

  return serializeNotification(updated);
}

async function markAllNotificationsRead(userId) {
  await ensureActiveUser(userId);

  const result = await prisma.notification.updateMany({
    where: {
      userId,
      isRead: false,
    },
    data: {
      isRead: true,
      readAt: new Date(),
    },
  });

  return { updated: result.count };
}

module.exports = {
  listNotifications,
  markNotificationRead,
  markAllNotificationsRead,
};
