const { Prisma } = require("@prisma/client");

const prisma = require("../config/database");
const marketDataService = require("./marketData");
const { enqueueNotificationDelivery } = require("../queues/notificationQueue");
const logger = require("../utils/logger");

const ALERT_SYMBOL_SELECT = {
  symbol: true,
  assetType: true,
};

const DEFAULT_SCAN_LIMIT = 100;
const DEFAULT_MAX_SYMBOLS_PER_SCAN = 50;

// Provider errors that describe the request/symbol rather than a temporary
// outage. Retrying cannot fix them, so the alert is expired instead of being
// re-evaluated on every scan.
const PERMANENT_MARKET_DATA_CODES = new Set([
  "MARKET_DATA_NOT_FOUND",
  "MARKET_DATA_UNSUPPORTED_ASSET_CLASS",
  "MARKET_DATA_INVALID_REQUEST",
]);

const PERMANENT_MARKET_DATA_STATUSES = new Set([400, 404, 422]);

function isPermanentMarketDataError(error) {
  if (!error) {
    return false;
  }

  if (PERMANENT_MARKET_DATA_CODES.has(error.code)) {
    return true;
  }

  const statusCode = error.statusCode ?? error.status;

  return (
    typeof statusCode === "number" &&
    PERMANENT_MARKET_DATA_STATUSES.has(statusCode)
  );
}

function toDecimal(value) {
  return value instanceof Prisma.Decimal ? value : new Prisma.Decimal(value);
}

function formatDecimal(value, places = 2) {
  return value.toFixed(places);
}

/**
 * Evaluate one alert against a quote.
 *
 * Returns a small, serializable result so the worker can distinguish a
 * business no-op from a transient provider failure:
 *
 * - `triggered`     — the condition was met and the alert was claimed;
 * - `not_triggered` — a valid quote that does not meet the condition;
 * - `skipped`       — the alert is no longer ACTIVE, or another worker won;
 * - `invalid`       — the alert has no usable baseline (percentage alerts);
 * - `baseline_captured` — a legacy percentage alert just received a baseline.
 *
 * Percentage semantics: `targetPrice` is a percentage threshold and the
 * comparison is against `baselinePrice`, captured when the alert was created.
 * `PERCENT_CHANGE_UP` triggers at `+targetPrice%`; `PERCENT_CHANGE_DOWN`
 * triggers at `-targetPrice%`.
 */
function evaluateCondition(alert, quote) {
  const price = toDecimal(quote.price);
  const target = toDecimal(alert.targetPrice);

  switch (alert.condition) {
    case "PRICE_ABOVE":
      return {
        triggered: price.gte(target),
        price,
        target,
        message: `${alert.symbol.symbol} is at ${formatDecimal(price)}, at or above your target of ${formatDecimal(target)}.`,
      };

    case "PRICE_BELOW":
      return {
        triggered: price.lte(target),
        price,
        target,
        message: `${alert.symbol.symbol} is at ${formatDecimal(price)}, at or below your target of ${formatDecimal(target)}.`,
      };

    case "PERCENT_CHANGE_UP":
    case "PERCENT_CHANGE_DOWN": {
      if (
        alert.baselinePrice === null ||
        alert.baselinePrice === undefined
      ) {
        return {
          triggered: false,
          invalid: true,
          reason: "NO_BASELINE",
          price,
          target,
        };
      }

      const baseline = toDecimal(alert.baselinePrice);

      if (baseline.isZero()) {
        return {
          triggered: false,
          invalid: true,
          reason: "ZERO_BASELINE",
          price,
          target,
        };
      }

      const change = price.minus(baseline).div(baseline).times(100);
      const triggered =
        alert.condition === "PERCENT_CHANGE_UP"
          ? change.gte(target)
          : change.lte(target.negated());

      const direction = change.gte(0) ? "up" : "down";
      const magnitude = change.abs();

      return {
        triggered,
        price,
        target,
        baseline,
        change,
        message: `${alert.symbol.symbol} is ${direction} ${formatDecimal(magnitude)}% since your baseline of ${formatDecimal(baseline)}, at or beyond your ${formatDecimal(target)}% threshold.`,
      };
    }

    default:
      return {
        triggered: false,
        invalid: true,
        reason: "UNKNOWN_CONDITION",
        price,
        target,
      };
  }
}

function buildNotificationData(alert, quote) {
  return {
    alertId: alert.id,
    symbol: alert.symbol.symbol,
    condition: alert.condition,
    targetPrice: alert.targetPrice.toString(),
    currentPrice: String(quote.price),
    baselinePrice:
      alert.baselinePrice === null || alert.baselinePrice === undefined
        ? null
        : alert.baselinePrice.toString(),
    // Alert-level switches can only narrow the user's own preferences.
    channels: {
      email: alert.sendEmail,
      push: alert.sendPush,
    },
  };
}

/**
 * Claim and notify for an alert that has already been matched against a quote.
 *
 * The `ACTIVE -> TRIGGERED` update is conditional, so two workers (or two
 * scans) cannot both trigger the same alert. The notification row is created
 * in the same transaction: if the claim wins, exactly one notification exists;
 * if it loses, none is created.
 */
async function triggerAlert(alert, quote, evaluation, { now = () => new Date() } = {}) {
  const triggeredAt = now();

  const notification = await prisma.$transaction(async (tx) => {
    const claimed = await tx.alert.updateMany({
      where: {
        id: alert.id,
        status: "ACTIVE",
      },
      data: {
        status: "TRIGGERED",
        triggeredAt,
        message: evaluation.message,
      },
    });

    if (claimed.count === 0) {
      return null;
    }

    return tx.notification.create({
      data: {
        userId: alert.userId,
        type: "PRICE_ALERT",
        title: `Price alert: ${alert.symbol.symbol}`,
        message: evaluation.message,
        data: buildNotificationData(alert, quote),
      },
    });
  });

  if (!notification) {
    return { outcome: "skipped", reason: "ALREADY_TRIGGERED" };
  }

  // The notification row is the source of truth. Delivery is best-effort; the
  // pending-notification scan retries it if Redis is unavailable.
  void enqueueNotificationDelivery({
    notificationId: notification.id,
  }).catch((error) => {
    logger.warn("Alert notification enqueue failed", {
      alertId: alert.id,
      notificationId: notification.id,
      message: error.message,
    });
  });

  return {
    outcome: "triggered",
    alertId: alert.id,
    notificationId: notification.id,
    price: String(quote.price),
  };
}

async function evaluateAlertWithQuote(
  alert,
  quote,
  { now = () => new Date() } = {},
) {
  if (alert.status !== "ACTIVE") {
    return { outcome: "skipped", status: alert.status };
  }

  const evaluation = evaluateCondition(alert, quote);

  // A percentage alert created before baselines existed has no reference
  // price. Capture one on the first evaluation instead of leaving it silently
  // dead; the next scan compares against this new baseline.
  if (evaluation.invalid && evaluation.reason === "NO_BASELINE") {
    const captured = await prisma.alert.updateMany({
      where: {
        id: alert.id,
        status: "ACTIVE",
        baselinePrice: null,
      },
      data: {
        baselinePrice: quote.price,
        baselineAt: now(),
      },
    });

    return {
      outcome: "baseline_captured",
      alertId: alert.id,
      captured: captured.count > 0,
      price: String(quote.price),
    };
  }

  if (evaluation.invalid) {
    return {
      outcome: "invalid",
      alertId: alert.id,
      reason: evaluation.reason,
    };
  }

  if (!evaluation.triggered) {
    return {
      outcome: "not_triggered",
      alertId: alert.id,
      price: String(quote.price),
    };
  }

  return triggerAlert(alert, quote, evaluation, { now });
}

async function loadAlert(alertId) {
  return prisma.alert.findUnique({
    where: { id: alertId },
    include: {
      symbol: {
        select: ALERT_SYMBOL_SELECT,
      },
    },
  });
}

async function evaluateAlertById(
  alertId,
  { quoteProvider = marketDataService, now = () => new Date() } = {},
) {
  const alert = await loadAlert(alertId);

  if (!alert) {
    return { outcome: "not_found", alertId };
  }

  if (alert.status !== "ACTIVE") {
    return { outcome: "skipped", status: alert.status };
  }

  const quote = await quoteProvider.getQuote(alert.symbol.symbol, {
    assetClass: alert.symbol.assetType,
  });

  return evaluateAlertWithQuote(alert, quote, { now });
}

/**
 * Evaluate every ACTIVE alert, optionally narrowed to one symbol.
 *
 * Quotes are fetched once per symbol and shared by all alerts on that symbol.
 * A provider failure or a database error on one symbol is isolated: the scan
 * still evaluates the rest and reports the failures.
 */
async function scanActiveAlerts(
  {
    symbol,
    limit = DEFAULT_SCAN_LIMIT,
    maxSymbols = DEFAULT_MAX_SYMBOLS_PER_SCAN,
  } = {},
  { quoteProvider = marketDataService, now = () => new Date() } = {},
) {
  const where = { status: "ACTIVE" };

  if (symbol) {
    where.symbol = { is: { symbol } };
  }

  const alerts = await prisma.alert.findMany({
    where,
    include: {
      symbol: {
        select: ALERT_SYMBOL_SELECT,
      },
    },
    // Nulls first so a brand-new alert is evaluated before rows that have
    // already had a turn. This is the rotation cursor that keeps a large alert
    // book fair when one scan cannot cover every symbol.
    orderBy: [
      { lastEvaluatedAt: { sort: "asc", nulls: "first" } },
      { createdAt: "asc" },
    ],
    take: limit,
  });

  const bySymbol = new Map();

  for (const alert of alerts) {
    const key = alert.symbol.symbol;

    if (!bySymbol.has(key)) {
      bySymbol.set(key, []);
    }

    bySymbol.get(key).push(alert);
  }

  const groups = [...bySymbol.entries()].slice(0, maxSymbols);
  const attemptedAt = now();
  const attemptedIds = [];
  const results = [];

  for (const [symbolKey, group] of groups) {
    let quote;

    try {
      quote = await quoteProvider.getQuote(symbolKey, {
        assetClass: group[0].symbol.assetType,
      });
    } catch (error) {
      logger.warn("Alert quote fetch failed", {
        symbol: symbolKey,
        reason: error.code || "MARKET_DATA_ERROR",
        message: error.message,
      });

      // A delisted/invalid symbol will never recover. Expire the alert rather
      // than re-evaluating it on every scan.
      if (isPermanentMarketDataError(error)) {
        const ids = group.map((alert) => alert.id);

        await prisma.alert.updateMany({
          where: { id: { in: ids }, status: "ACTIVE" },
          data: {
            status: "EXPIRED",
            message: `Market data unavailable: ${error.code || "MARKET_DATA_ERROR"}`,
          },
        });

        for (const alert of group) {
          results.push({
            outcome: "expired",
            alertId: alert.id,
            reason: error.code || "MARKET_DATA_ERROR",
          });
        }

        continue;
      }

      // A transient provider failure must still count as an attempt. If the
      // cursor were left untouched, the next scan would select the same
      // symbols again (they are the oldest) and the deferred symbols would
      // never get a turn. The alert stays ACTIVE so a later scan retries it.
      attemptedIds.push(...group.map((alert) => alert.id));

      for (const alert of group) {
        results.push({
          outcome: "error",
          alertId: alert.id,
          reason: error.code || "MARKET_DATA_ERROR",
        });
      }

      continue;
    }

    for (const alert of group) {
      try {
        results.push(await evaluateAlertWithQuote(alert, quote, { now }));
      } catch (error) {
        logger.warn("Alert evaluation failed", {
          alertId: alert.id,
          reason: error.code || "EVALUATION_ERROR",
          message: error.message,
        });

        results.push({
          outcome: "error",
          alertId: alert.id,
          reason: error.code || "EVALUATION_ERROR",
        });
      }
    }

    attemptedIds.push(...group.map((alert) => alert.id));
  }

  // Advance the rotation cursor for every symbol group this scan attempted,
  // including groups whose quote fetch failed transiently. The cursor records
  // the last attempt, not the last success, so a failing symbol cannot starve
  // the deferred symbols. Alerts in groups beyond `maxSymbols` keep their
  // older timestamp and are picked first on the next scan.
  if (attemptedIds.length > 0) {
    await prisma.alert.updateMany({
      where: { id: { in: attemptedIds } },
      data: { lastEvaluatedAt: attemptedAt },
    });
  }

  const scanned = groups.reduce((total, [, group]) => total + group.length, 0);

  return {
    scanned,
    symbolsScanned: groups.length,
    symbolsDeferred: bySymbol.size - groups.length,
    triggered: results.filter((result) => result.outcome === "triggered")
      .length,
    notTriggered: results.filter(
      (result) => result.outcome === "not_triggered",
    ).length,
    baselineCaptured: results.filter(
      (result) => result.outcome === "baseline_captured",
    ).length,
    skipped: results.filter((result) => result.outcome === "skipped").length,
    invalid: results.filter((result) => result.outcome === "invalid").length,
    expired: results.filter((result) => result.outcome === "expired").length,
    errors: results.filter((result) => result.outcome === "error").length,
    results,
  };
}

module.exports = {
  ALERT_SYMBOL_SELECT,
  buildNotificationData,
  evaluateAlertById,
  evaluateAlertWithQuote,
  evaluateCondition,
  scanActiveAlerts,
  triggerAlert,
};
