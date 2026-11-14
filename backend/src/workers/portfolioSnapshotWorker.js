const prisma = require("../config/database");
const logger = require("../utils/logger");
const { captureAllPortfolioSnapshots } = require("../services/portfolioSnapshotService");

// Default poll interval: check once every minute whether scheduled capture is due
const DEFAULT_SNAPSHOT_INTERVAL_MS = Number(process.env.PORTFOLIO_SNAPSHOT_INTERVAL_MS) || 60000;

// Default daily settlement window: 2 hours after midnight UTC (00:00 - 02:00 UTC)
const DEFAULT_SETTLEMENT_WINDOW_HOURS = Number(process.env.PORTFOLIO_SNAPSHOT_WINDOW_HOURS) || 2;

/**
 * Convert a Date, ISO string, or YYYY-MM-DD string to a canonical UTC YYYY-MM-DD string.
 *
 * @param {Date|string} [dateInput]
 * @returns {string}
 */
function toUtcDateString(dateInput) {
  if (!dateInput) {
    return new Date().toISOString().slice(0, 10);
  }
  if (dateInput instanceof Date) {
    return dateInput.toISOString().slice(0, 10);
  }
  const str = String(dateInput);
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    return str;
  }
  return new Date(str).toISOString().slice(0, 10);
}

/**
 * Returns the UTC previous calendar date string (YYYY-MM-DD) for a given reference date.
 * E.g., for 2026-11-15T00:05:00.000Z -> "2026-11-14".
 *
 * @param {Date|string} [dateInput]
 * @returns {string}
 */
function getPreviousUtcDateString(dateInput) {
  const ref = dateInput instanceof Date ? dateInput : new Date(dateInput || Date.now());
  const prev = new Date(Date.UTC(
    ref.getUTCFullYear(),
    ref.getUTCMonth(),
    ref.getUTCDate() - 1,
    0,
    0,
    0,
    0,
  ));
  return prev.toISOString().slice(0, 10);
}

/**
 * Returns a Date representing the exact end-of-day for a given UTC date (23:59:59.999Z).
 *
 * @param {Date|string} [dateInput]
 * @returns {Date}
 */
function getUtcEndOfDay(dateInput) {
  const dateStr = toUtcDateString(dateInput);
  return new Date(`${dateStr}T23:59:59.999Z`);
}

/**
 * Check whether a timestamp is within the allowable daily settlement window (00:00 to windowHours UTC).
 *
 * @param {Date|string} [dateInput]
 * @param {number} [windowHours]
 * @returns {boolean}
 */
function isWithinSettlementWindow(dateInput, windowHours = DEFAULT_SETTLEMENT_WINDOW_HOURS) {
  const date = dateInput instanceof Date ? dateInput : new Date(dateInput || Date.now());
  const hours = date.getUTCHours();
  return hours >= 0 && hours < windowHours;
}

/**
 * Execute daily portfolio snapshot capture for all active portfolios.
 * Defaults to capturing yesterday's completed date as of 23:59:59.999Z.
 *
 * @param {Object} [options]
 * @param {string|Date} [options.targetDate]
 * @param {Date} [options.asOf]
 * @param {Object} [options.priceProvider]
 * @param {Object} [options.client]
 * @returns {Promise<{
 *   snapshotDate: string,
 *   asOf: string,
 *   totalPortfolios: number,
 *   successful: number,
 *   failed: number,
 *   errors: Array<{ portfolioId: string, error: string }>
 * }>}
 */
async function captureDailyPortfolioSnapshots({
  targetDate = null,
  asOf = null,
  priceProvider = null,
  client = prisma,
} = {}) {
  let resolvedTargetDate;
  let resolvedAsOf;

  if (targetDate) {
    resolvedTargetDate = toUtcDateString(targetDate);
    resolvedAsOf = asOf
      ? (asOf instanceof Date ? asOf : new Date(asOf))
      : getUtcEndOfDay(resolvedTargetDate);
  } else if (asOf) {
    resolvedAsOf = asOf instanceof Date ? asOf : new Date(asOf);
    resolvedTargetDate = toUtcDateString(resolvedAsOf);
  } else {
    resolvedTargetDate = getPreviousUtcDateString(new Date());
    resolvedAsOf = getUtcEndOfDay(resolvedTargetDate);
  }

  const result = await captureAllPortfolioSnapshots({
    targetDate: resolvedTargetDate,
    asOf: resolvedAsOf,
    priceProvider,
    client,
  });

  logger.info("Daily portfolio snapshots capture completed", {
    snapshotDate: result.snapshotDate,
    asOf: result.asOf,
    totalPortfolios: result.totalPortfolios,
    successful: result.successful,
    failed: result.failed,
  });

  return result;
}

/**
 * In-process scheduled worker for portfolio snapshots matching the project worker pattern.
 *
 * Schedule & Snapshot Semantics:
 * 1. End-of-Day Valuation: Snapshots represent the completed close of date D (asOf: D 23:59:59.999Z).
 * 2. Settlement Window: Runs in the early morning UTC window (00:00 - 02:00 UTC) targeting yesterday (D = T - 1).
 * 3. Missed Run / Restart Guardrails:
 *    - On restart, if yesterday's snapshot is already in DB, syncs state and skips redundant runs.
 *    - If outside the settlement window and yesterday's snapshot is missing in DB (missed run),
 *      logs a warning and skips. It refuses to silently substitute live mid-day prices as yesterday's
 *      EOD close, and refuses to prematurely snapshot today before today has closed.
 *    - Manual backfills or emergency runs can override via { force: true }.
 *
 * @param {Object} [options]
 * @param {number} [options.intervalMs]
 * @param {number} [options.settlementWindowHours]
 * @param {boolean} [options.autoStart]
 * @param {Object} [options.priceProvider]
 * @param {Object} [options.client]
 * @returns {{
 *   run: Function,
 *   initialPromise: Promise<any>|null,
 *   stop: Function,
 *   getLastCapturedDate: Function
 * }}
 */
function startPortfolioSnapshotWorker({
  intervalMs = DEFAULT_SNAPSHOT_INTERVAL_MS,
  settlementWindowHours = DEFAULT_SETTLEMENT_WINDOW_HOURS,
  autoStart = true,
  priceProvider = null,
  client = prisma,
} = {}) {
  let stopped = false;
  let running = false;
  let lastCapturedDate = null;
  let initialPromise = null;

  const run = async (executionTime = null, { force = false, targetDate = null } = {}) => {
    if (stopped || running) {
      return;
    }

    const now = executionTime instanceof Date
      ? executionTime
      : (executionTime ? new Date(executionTime) : new Date());

    const targetDateStr = targetDate
      ? toUtcDateString(targetDate)
      : getPreviousUtcDateString(now);
    const endOfDayAsOf = getUtcEndOfDay(targetDateStr);

    // Skip if already captured in memory for this target date
    if (!force && lastCapturedDate === targetDateStr) {
      return {
        skipped: true,
        reason: "ALREADY_CAPTURED",
        snapshotDate: targetDateStr,
      };
    }

    // Guardrail against capturing outside settlement window
    if (!force && !isWithinSettlementWindow(now, settlementWindowHours)) {
      const targetDateObj = new Date(`${targetDateStr}T00:00:00.000Z`);
      let existingInDb = null;
      try {
        existingInDb = await client.performanceSnapshot.findFirst({
          where: { snapshotDate: targetDateObj },
          select: { id: true },
        });
      } catch (err) {
        logger.warn(`Failed checking existing snapshot in DB for ${targetDateStr}: ${err.message}`);
      }

      if (existingInDb) {
        // Safe: was already captured earlier
        lastCapturedDate = targetDateStr;
        return {
          skipped: true,
          reason: "ALREADY_CAPTURED_IN_DB",
          snapshotDate: targetDateStr,
        };
      }

      // Missed run outside settlement window: do NOT silently record live intraday prices
      logger.warn(
        `Missed daily portfolio snapshot window for ${targetDateStr}. Execution at ${now.toISOString()} is outside settlement window (00:00-${String(settlementWindowHours).padStart(2, "0")}:00 UTC). Live prices will not be silently recorded as EOD close.`,
      );
      return {
        skipped: true,
        reason: "OUTSIDE_SETTLEMENT_WINDOW",
        targetDate: targetDateStr,
      };
    }

    running = true;

    try {
      const result = await captureDailyPortfolioSnapshots({
        targetDate: targetDateStr,
        asOf: endOfDayAsOf,
        priceProvider,
        client,
      });
      lastCapturedDate = result.snapshotDate;
      return result;
    } catch (error) {
      logger.error("Portfolio snapshot worker execution failed", {
        error: error.message,
        targetDate: targetDateStr,
      });
    } finally {
      running = false;
    }
  };

  const timer = setInterval(run, intervalMs);
  if (typeof timer.unref === "function") {
    timer.unref();
  }

  if (autoStart) {
    initialPromise = run();
  }

  return {
    run,
    initialPromise,
    stop() {
      stopped = true;
      clearInterval(timer);
    },
    getLastCapturedDate() {
      return lastCapturedDate;
    },
  };
}

module.exports = {
  DEFAULT_SNAPSHOT_INTERVAL_MS,
  DEFAULT_SETTLEMENT_WINDOW_HOURS,
  toUtcDateString,
  getPreviousUtcDateString,
  getUtcEndOfDay,
  isWithinSettlementWindow,
  captureDailyPortfolioSnapshots,
  startPortfolioSnapshotWorker,
};
