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

function serializeAlert(alert) {
  return {
    id: alert.id,
    userId: alert.userId,
    symbol: alert.symbol,
    assetType: alert.assetType,
    condition: alert.condition,
    targetPrice: alert.targetPrice.toString(),
    status: alert.status,
    sendEmail: alert.sendEmail,
    sendPush: alert.sendPush,
    triggeredAt: alert.triggeredAt,
    message: alert.message,
    createdAt: alert.createdAt,
    updatedAt: alert.updatedAt,
  };
}

async function getOwnedAlert(userId, alertId) {
  const alert = await prisma.alert.findFirst({
    where: {
      id: alertId,
      userId,
    },
  });

  if (!alert) {
    throw AppError.notFound("Alert not found.", "ALERT_NOT_FOUND");
  }

  return alert;
}

async function listAlerts(userId, { page = 1, limit = 20, status, symbol } = {}) {
  await ensureActiveUser(userId);

  const where = { userId };

  if (status !== undefined) {
    where.status = status;
  }

  if (symbol !== undefined) {
    where.symbol = symbol;
  }

  const skip = (page - 1) * limit;

  const [alerts, total] = await Promise.all([
    prisma.alert.findMany({
      where,
      orderBy: {
        createdAt: "desc",
      },
      skip,
      take: limit,
    }),

    prisma.alert.count({
      where,
    }),
  ]);

  return {
    alerts: alerts.map(serializeAlert),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}

async function createAlert(userId, payload) {
  await ensureActiveUser(userId);

  const alert = await prisma.alert.create({
    data: {
      userId,
      symbol: payload.symbol,
      assetType: payload.assetType ?? null,
      condition: payload.condition,
      targetPrice: payload.targetPrice,
      sendEmail: payload.sendEmail,
      sendPush: payload.sendPush,
    },
  });

  return serializeAlert(alert);
}

async function updateAlert(userId, alertId, payload) {
  await ensureActiveUser(userId);

  await getOwnedAlert(userId, alertId);

  const data = {};

  if (payload.condition !== undefined) {
    data.condition = payload.condition;
  }

  if (payload.targetPrice !== undefined) {
    data.targetPrice = payload.targetPrice;
  }

  if (payload.status !== undefined) {
    data.status = payload.status;

    // Triggering an alert is what records when it fired.
    if (payload.status === "TRIGGERED") {
      data.triggeredAt = new Date();
    }
  }

  if (payload.sendEmail !== undefined) {
    data.sendEmail = payload.sendEmail;
  }

  if (payload.sendPush !== undefined) {
    data.sendPush = payload.sendPush;
  }

  const alert = await prisma.alert.update({
    where: { id: alertId },
    data,
  });

  return serializeAlert(alert);
}

async function deleteAlert(userId, alertId) {
  await ensureActiveUser(userId);

  await getOwnedAlert(userId, alertId);

  await prisma.alert.delete({
    where: { id: alertId },
  });

  return { id: alertId };
}

module.exports = {
  listAlerts,
  createAlert,
  updateAlert,
  deleteAlert,
};
