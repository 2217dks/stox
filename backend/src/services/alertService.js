const prisma = require("../config/database");
const { AppError } = require("../utils/errors");
const marketDataService = require("./marketData");

const ALERT_SYMBOL_SELECT = {
  symbol: true,
  assetType: true,
};

// `targetPrice` is a percentage threshold for these conditions and an absolute
// price for the others. Percentage alerts need a request-time baseline so "up
// 5%" means "up 5% since I created the alert".
const PERCENTAGE_CONDITIONS = new Set([
  "PERCENT_CHANGE_UP",
  "PERCENT_CHANGE_DOWN",
]);

function isPercentageCondition(condition) {
  return PERCENTAGE_CONDITIONS.has(condition);
}

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
    symbol: alert.symbol?.symbol ?? null,
    assetType: alert.symbol?.assetType ?? null,
    condition: alert.condition,
    targetPrice: alert.targetPrice.toString(),
    baselinePrice:
      alert.baselinePrice === null || alert.baselinePrice === undefined
        ? null
        : alert.baselinePrice.toString(),
    baselineAt: alert.baselineAt ?? null,
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
    include: {
      symbol: {
        select: ALERT_SYMBOL_SELECT,
      },
    },
  });

  if (!alert) {
    throw AppError.notFound("Alert not found.", "ALERT_NOT_FOUND");
  }

  return alert;
}

/**
 * Read the current price and freeze it as the alert's reference point.
 *
 * The quote is fetched before the row is written, so a provider outage fails
 * the request instead of creating an alert whose percentage has no defined
 * starting point. The market-data error is already an `AppError` with the
 * right status code and domain code, so it propagates unchanged.
 */
async function captureBaseline(symbolRecord) {
  const quote = await marketDataService.getQuote(symbolRecord.symbol, {
    assetClass: symbolRecord.assetType,
  });

  return {
    baselinePrice: quote.price,
    baselineAt: new Date(),
  };
}

async function listAlerts(
  userId,
  { page = 1, limit = 20, status, symbol } = {},
) {
  await ensureActiveUser(userId);

  const where = { userId };

  if (status !== undefined) {
    where.status = status;
  }

  if (symbol !== undefined) {
    where.symbol = {
      is: { symbol },
    };
  }

  const skip = (page - 1) * limit;

  const [alerts, total] = await Promise.all([
    prisma.alert.findMany({
      where,
      include: {
        symbol: {
          select: ALERT_SYMBOL_SELECT,
        },
      },
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

  const symbolRecord = await prisma.symbol.findUnique({
    where: {
      symbol: payload.symbol,
    },
    select: {
      id: true,
      symbol: true,
      assetType: true,
      isActive: true,
    },
  });

  if (!symbolRecord || !symbolRecord.isActive) {
    throw AppError.notFound("Active symbol not found.", "SYMBOL_NOT_FOUND");
  }

  if (
    payload.assetType !== undefined &&
    payload.assetType !== symbolRecord.assetType
  ) {
    throw AppError.badRequest(
      "Asset type does not match the selected symbol.",
      "ASSET_TYPE_MISMATCH",
    );
  }

  const baseline = isPercentageCondition(payload.condition)
    ? await captureBaseline(symbolRecord)
    : { baselinePrice: null, baselineAt: null };

  const alert = await prisma.alert.create({
    data: {
      userId,
      symbolId: symbolRecord.id,
      condition: payload.condition,
      targetPrice: payload.targetPrice,
      sendEmail: payload.sendEmail,
      sendPush: payload.sendPush,
      ...baseline,
    },
    include: {
      symbol: {
        select: ALERT_SYMBOL_SELECT,
      },
    },
  });

  return serializeAlert(alert);
}

async function updateAlert(userId, alertId, payload) {
  await ensureActiveUser(userId);

  const existing = await getOwnedAlert(userId, alertId);

  const data = {};

  if (payload.condition !== undefined) {
    data.condition = payload.condition;
  }

  if (payload.targetPrice !== undefined) {
    data.targetPrice = payload.targetPrice;
  }

  if (payload.status !== undefined) {
    data.status = payload.status;

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

  // A percentage alert needs a reference price. Capture one when the alert
  // first becomes a percentage alert, when an existing alert is re-armed, or
  // when an older row somehow has no baseline. Switching back to an absolute
  // price clears the now-meaningless baseline.
  const effectiveCondition = data.condition ?? existing.condition;
  const rearming = data.status === "ACTIVE" && existing.status !== "ACTIVE";

  if (isPercentageCondition(effectiveCondition)) {
    const needsBaseline =
      !isPercentageCondition(existing.condition) ||
      rearming ||
      existing.baselinePrice === null ||
      existing.baselinePrice === undefined;

    if (needsBaseline) {
      Object.assign(data, await captureBaseline(existing.symbol));
    }
  } else if (
    existing.baselinePrice !== null &&
    existing.baselinePrice !== undefined
  ) {
    data.baselinePrice = null;
    data.baselineAt = null;
  }

  const alert = await prisma.alert.update({
    where: { id: alertId },
    data,
    include: {
      symbol: {
        select: ALERT_SYMBOL_SELECT,
      },
    },
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
  serializeAlert,
  isPercentageCondition,
};
