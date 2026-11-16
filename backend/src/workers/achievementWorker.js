const { reconcileAchievements } = require("../services/achievementService");
const logger = require("../utils/logger");

const DEFAULT_RECONCILE_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

function startAchievementWorker({
  intervalMs = Number.parseInt(
    process.env.ACHIEVEMENT_RECONCILE_INTERVAL_MS,
    10,
  ) || DEFAULT_RECONCILE_INTERVAL_MS,
  runOnStartup = true,
} = {}) {
  let timer = null;
  let running = false;

  async function tick() {
    if (running) {
      return;
    }
    running = true;
    try {
      const summary = await reconcileAchievements();
      logger.info("Achievement reconciliation completed", summary);
    } catch (error) {
      logger.error("Achievement reconciliation failed", {
        error: error.message,
      });
    } finally {
      running = false;
    }
  }

  if (runOnStartup) {
    void tick();
  }

  timer = setInterval(tick, intervalMs);
  timer.unref?.();

  return {
    stop: () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
    tick,
  };
}

module.exports = {
  startAchievementWorker,
};
