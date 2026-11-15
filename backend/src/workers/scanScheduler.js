const logger = require("../utils/logger");

const DEFAULT_MAX_RETRY_DELAY_MS = 30_000;

/**
 * Register the repeatable order scan, retrying with bounded exponential
 * backoff until it succeeds.
 *
 * A worker that starts while Redis is briefly unavailable would otherwise
 * never register the scan. Orders created after Redis recovers would still be
 * enqueued individually, but resting LIMIT/STOP/TAKE_PROFIT orders would never
 * be re-evaluated.
 *
 * Extracted from the process entrypoint so the retry/stop behaviour is unit
 * testable with fake timers.
 */
function startScanScheduler({
  ensureScheduler,
  intervalMs,
  log = logger,
  maxRetryDelayMs = DEFAULT_MAX_RETRY_DELAY_MS,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  if (typeof ensureScheduler !== "function") {
    throw new TypeError(
      "startScanScheduler requires an ensureScheduler function.",
    );
  }

  let attempt = 0;
  let timer = null;
  let stopped = false;
  let running = false;

  async function register() {
    if (stopped || running) {
      return;
    }

    running = true;
    attempt += 1;

    let result;

    try {
      result = await ensureScheduler({ every: intervalMs });
    } catch (error) {
      result = { scheduled: false, reason: error.message };
    } finally {
      running = false;
    }

    if (stopped) {
      return;
    }

    if (result?.scheduled) {
      log.info("Order scan scheduler registered", {
        everyMs: intervalMs,
      });
      return;
    }

    const delayMs = Math.min(
      maxRetryDelayMs,
      1000 * 2 ** Math.min(attempt, 5),
    );

    log.warn("Order scan scheduler not registered; retrying", {
      reason: result?.reason,
      retryInMs: delayMs,
    });

    timer = setTimer(register, delayMs);
    timer?.unref?.();
  }

  register();

  return {
    stop() {
      stopped = true;

      if (timer) {
        clearTimer(timer);
        timer = null;
      }
    },
  };
}

module.exports = {
  DEFAULT_MAX_RETRY_DELAY_MS,
  startScanScheduler,
};
