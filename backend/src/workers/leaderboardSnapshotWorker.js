const prisma = require("../config/database");
const logger = require("../utils/logger");
const redisConfig = require("../config/redis");
const leaderboardService = require("../services/leaderboardService");

const DEFAULT_INTERVAL_MS = Number(process.env.LEADERBOARD_SNAPSHOT_INTERVAL_MS) || 60000;
const DEFAULT_SCHEDULE_HOUR_UTC = Number(process.env.LEADERBOARD_SNAPSHOT_HOUR_UTC) || 2;
const LOCK_TTL_MS = 300000; // 5 minutes

const RELEASE_LOCK_LUA = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`;

const RENEW_LOCK_LUA = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("pexpire", KEYS[1], ARGV[2])
else
  return 0
end
`;

function getPreviousUtcDateString(dateInput) {
  const ref = dateInput instanceof Date ? dateInput : new Date(dateInput || Date.now());
  const prev = new Date(
    Date.UTC(
      ref.getUTCFullYear(),
      ref.getUTCMonth(),
      ref.getUTCDate() - 1,
      0,
      0,
      0,
      0,
    ),
  );
  return prev.toISOString().slice(0, 10);
}

/**
 * Acquire a distributed lock for running leaderboard snapshot refresh.
 * Fails closed if Redis is unavailable or acquisition fails.
 */
async function acquireLeaderboardLock(lockKey, workerId, ttlMs = LOCK_TTL_MS) {
  try {
    const redis = await redisConfig.getRedis();
    if (redis && (redis.status === "ready" || typeof redis.set === "function")) {
      const result = await redis.set(lockKey, workerId, "PX", ttlMs, "NX");
      return result === "OK";
    }
    logger.warn(`Redis unavailable for lock ${lockKey}, failing closed.`);
    return false;
  } catch (error) {
    logger.warn(
      `Redis lock acquisition failed for ${lockKey}, failing closed: ${error.message}`,
    );
    return false;
  }
}

/**
 * Renew distributed lease if still held by this worker using atomic Lua script.
 */
async function renewLeaderboardLock(lockKey, workerId, ttlMs = LOCK_TTL_MS) {
  try {
    const redis = await redisConfig.getRedis();
    if (!redis) return false;

    if (typeof redis.eval === "function") {
      const res = await redis.eval(RENEW_LOCK_LUA, 1, lockKey, workerId, ttlMs);
      return res === 1;
    }

    // Mock/fallback path
    if (typeof redis.get === "function" && typeof redis.pexpire === "function") {
      const current = await redis.get(lockKey);
      if (current === workerId) {
        await redis.pexpire(lockKey, ttlMs);
        return true;
      }
      return false;
    }
  } catch (error) {
    logger.warn(`Failed renewing Redis lock for ${lockKey}: ${error.message}`);
    return false;
  }
  return false;
}

/**
 * Release distributed lock if held by this worker using atomic Lua script.
 */
async function releaseLeaderboardLock(lockKey, workerId) {
  try {
    const redis = await redisConfig.getRedis();
    if (!redis) return false;

    if (typeof redis.eval === "function") {
      const res = await redis.eval(RELEASE_LOCK_LUA, 1, lockKey, workerId);
      return res === 1;
    }

    // Mock/fallback path
    if (typeof redis.get === "function" && typeof redis.del === "function") {
      const current = await redis.get(lockKey);
      if (current === workerId) {
        await redis.del(lockKey);
        return true;
      }
      return false;
    }
  } catch (error) {
    logger.warn(`Failed releasing Redis lock for ${lockKey}: ${error.message}`);
    return false;
  }
  return false;
}

/**
 * Execute daily leaderboard snapshot refresh for the specified target date.
 */
async function runLeaderboardSnapshotJob({
  targetDate = null,
  force = false,
  now = new Date(),
  client = prisma,
  scheduleHourUtc = DEFAULT_SCHEDULE_HOUR_UTC,
  workerId = `worker-${process.pid}-${Date.now()}`,
  lockTTLMs = LOCK_TTL_MS,
  renewalIntervalMs = null,
} = {}) {
  const targetDateStr = targetDate
    ? (targetDate instanceof Date ? targetDate.toISOString().slice(0, 10) : String(targetDate).slice(0, 10))
    : getPreviousUtcDateString(now);

  const targetDateObj = new Date(`${targetDateStr}T00:00:00.000Z`);

  // Gate by schedule hour unless force=true
  if (!force && now.getUTCHours() < scheduleHourUtc) {
    return {
      skipped: true,
      reason: "BEFORE_SCHEDULED_HOUR",
      scheduleHourUtc,
      currentHourUtc: now.getUTCHours(),
      targetDate: targetDateStr,
    };
  }

  // Check if all 4 periods already have snapshots for this target date
  if (!force) {
    const existingSnapshots = await client.leaderboardSnapshot.findMany({
      where: {
        scope: "GLOBAL",
        snapshotDate: targetDateObj,
      },
      select: { period: true },
    });

    if (existingSnapshots.length >= 4) {
      return {
        skipped: true,
        reason: "ALREADY_GENERATED",
        targetDate: targetDateStr,
        snapshotCount: existingSnapshots.length,
      };
    }
  }

  const lockKey = `lock:leaderboard-snapshot:${targetDateStr}`;
  const acquired = await acquireLeaderboardLock(lockKey, workerId, lockTTLMs);

  if (!acquired) {
    logger.info(`Leaderboard snapshot generation for ${targetDateStr} locked by another replica.`);
    return {
      skipped: true,
      reason: "LOCKED_BY_ANOTHER_WORKER",
      targetDate: targetDateStr,
    };
  }

  const abortController = new AbortController();
  let lockLost = false;
  let rejectLockLost;
  const lockLostPromise = new Promise((_, reject) => {
    rejectLockLost = reject;
  });

  // Active heartbeat renewal while job executes
  const renewalInterval = renewalIntervalMs || Math.max(1000, Math.floor(lockTTLMs / 3));
  const renewalTimer = setInterval(async () => {
    try {
      const renewed = await renewLeaderboardLock(lockKey, workerId, lockTTLMs);
      if (!renewed) {
        lockLost = true;
        clearInterval(renewalTimer);
        abortController.abort();
        const err = new Error(
          `Leaderboard lock lease renewal failed for ${lockKey}; lease lost or expired.`,
        );
        err.code = "LOCK_RENEWAL_FAILED";
        logger.error(err.message);
        if (rejectLockLost) {
          rejectLockLost(err);
        }
      }
    } catch (err) {
      lockLost = true;
      clearInterval(renewalTimer);
      abortController.abort();
      const renewalErr = new Error(
        `Leaderboard lock lease renewal error for ${lockKey}: ${err.message}`,
      );
      renewalErr.code = "LOCK_RENEWAL_FAILED";
      logger.error(renewalErr.message);
      if (rejectLockLost) {
        rejectLockLost(renewalErr);
      }
    }
  }, renewalInterval);
  if (typeof renewalTimer.unref === "function") {
    renewalTimer.unref();
  }

  try {
    logger.info(`Starting daily leaderboard snapshot generation for ${targetDateStr}`);
    const workPromise = leaderboardService.generateLeaderboardSnapshots({
      date: targetDateObj,
      signal: abortController.signal,
    });

    workPromise.catch((err) => {
      if (lockLost || abortController.signal.aborted) {
        logger.warn(`Background snapshot work rolled back after lock loss: ${err.message}`);
      }
    });

    const result = await Promise.race([workPromise, lockLostPromise]);

    if (lockLost || abortController.signal.aborted) {
      const err = new Error(
        `Leaderboard lock lease renewal failed for ${lockKey}; lease lost or expired.`,
      );
      err.code = "LOCK_RENEWAL_FAILED";
      throw err;
    }

    if (!result || !result.leaderboards) {
      const err = new Error(
        `Leaderboard snapshot generation aborted or produced no result for ${targetDateStr}.`,
      );
      err.code = "LOCK_RENEWAL_FAILED";
      throw err;
    }

    logger.info(`Completed daily leaderboard snapshot generation for ${targetDateStr}`, {
      leaderboards: result.leaderboards,
    });
    return {
      success: true,
      targetDate: targetDateStr,
      leaderboards: result.leaderboards,
    };
  } catch (error) {
    logger.error(`Leaderboard snapshot generation failed for ${targetDateStr}: ${error.message}`, {
      stack: error.stack,
    });
    throw error;
  } finally {
    if (renewalTimer) {
      clearInterval(renewalTimer);
    }
    if (!lockLost && !abortController.signal.aborted) {
      await releaseLeaderboardLock(lockKey, workerId);
    }
  }
}

/**
 * In-process scheduled worker matching portfolioSnapshotWorker.
 */
function startLeaderboardSnapshotWorker({
  intervalMs = DEFAULT_INTERVAL_MS,
  scheduleHourUtc = DEFAULT_SCHEDULE_HOUR_UTC,
  autoStart = true,
  client = prisma,
  lockTTLMs = LOCK_TTL_MS,
  renewalIntervalMs = null,
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
      ? (targetDate instanceof Date ? targetDate.toISOString().slice(0, 10) : String(targetDate).slice(0, 10))
      : getPreviousUtcDateString(now);

    if (!force && lastCapturedDate === targetDateStr) {
      return {
        skipped: true,
        reason: "ALREADY_CAPTURED_IN_PROCESS",
        snapshotDate: targetDateStr,
      };
    }

    running = true;

    try {
      const outcome = await runLeaderboardSnapshotJob({
        targetDate: targetDateStr,
        force,
        now,
        client,
        scheduleHourUtc,
        lockTTLMs,
        renewalIntervalMs,
      });

      if (outcome && outcome.success) {
        lastCapturedDate = targetDateStr;
      }

      return outcome;
    } catch (err) {
      logger.error(`Leaderboard worker tick failed: ${err.message}`);
      return {
        success: false,
        error: err.message,
        code: err.code,
      };
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
  DEFAULT_INTERVAL_MS,
  DEFAULT_SCHEDULE_HOUR_UTC,
  LOCK_TTL_MS,
  RELEASE_LOCK_LUA,
  RENEW_LOCK_LUA,
  getPreviousUtcDateString,
  acquireLeaderboardLock,
  renewLeaderboardLock,
  releaseLeaderboardLock,
  runLeaderboardSnapshotJob,
  startLeaderboardSnapshotWorker,
};
