const { processCompletedLeagues } = require("../services/competitionService");
const logger = require("../utils/logger");

const DEFAULT_LEAGUE_COMPLETION_INTERVAL_MS = 60 * 1000; // 1 minute

function startLeagueCompletionWorker({
  intervalMs = Number.parseInt(
    process.env.LEAGUE_COMPLETION_INTERVAL_MS,
    10,
  ) || DEFAULT_LEAGUE_COMPLETION_INTERVAL_MS,
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
      const summary = await processCompletedLeagues();
      if (summary && summary.length > 0) {
        logger.info("League completion processing finished", {
          completedLeagues: summary.length,
        });
      }
    } catch (error) {
      logger.error("League completion processing failed", {
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
  startLeagueCompletionWorker,
  DEFAULT_LEAGUE_COMPLETION_INTERVAL_MS,
};

