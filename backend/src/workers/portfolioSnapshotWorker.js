const prisma = require("../config/database");
const logger = require("../utils/logger");
const { captureAllPortfolioSnapshots } = require("../services/portfolioSnapshotService");

// Default poll interval: check once every minute whether a new UTC day has started
const DEFAULT_SNAPSHOT_INTERVAL_MS = Number(process.env.PORTFOLIO_SNAPSHOT_INTERVAL_MS) || 60000;

/**
 * Execute daily portfolio snapshot capture for all active portfolios.
 *
 * @param {Object} [options]
 * @param {Date} [options.asOf]
 * @param {Object} [options.priceProvider]
 * @param {Object} [options.client]
 * @returns {Promise<{
 *   snapshotDate: string,
 *   totalPortfolios: number,
 *   successful: number,
 *   failed: number,
 *   errors: Array<{ portfolioId: string, error: string }>
 * }>}
 */
async function captureDailyPortfolioSnapshots({
  asOf = new Date(),
  priceProvider = null,
  client = prisma,
} = {}) {
  const result = await captureAllPortfolioSnapshots({
    asOf,
    priceProvider,
    client,
  });

  logger.info("Daily portfolio snapshots capture completed", {
    snapshotDate: result.snapshotDate,
    totalPortfolios: result.totalPortfolios,
    successful: result.successful,
    failed: result.failed,
  });

  return result;
}

/**
 * In-process scheduled worker for portfolio snapshots matching the project worker pattern.
 * Checks on a configurable interval whether the current UTC day has been captured, and
 * triggers daily snapshot generation.
 *
 * @param {Object} [options]
 * @param {number} [options.intervalMs]
 * @param {Object} [options.priceProvider]
 * @param {Object} [options.client]
 * @returns {{ run: Function, stop: Function, getLastCapturedDate: Function }}
 */
function startPortfolioSnapshotWorker({
  intervalMs = DEFAULT_SNAPSHOT_INTERVAL_MS,
  autoStart = true,
  priceProvider = null,
  client = prisma,
} = {}) {
  let stopped = false;
  let running = false;
  let lastCapturedDate = null;

  let initialPromise = null;

  const run = async (asOf = null, { force = false } = {}) => {
    if (stopped || running) {
      return;
    }

    const now = asOf || new Date();
    const todayStr = now instanceof Date
      ? now.toISOString().slice(0, 10)
      : String(now).slice(0, 10);

    // Only run if not already captured for this UTC day, unless forced
    if (!force && lastCapturedDate === todayStr) {
      return;
    }

    running = true;

    try {
      const result = await captureDailyPortfolioSnapshots({
        asOf: now,
        priceProvider,
        client,
      });
      lastCapturedDate = result.snapshotDate;
      return result;
    } catch (error) {
      logger.error("Portfolio snapshot worker poll failed", {
        error: error.message,
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
  captureDailyPortfolioSnapshots,
  startPortfolioSnapshotWorker,
};
