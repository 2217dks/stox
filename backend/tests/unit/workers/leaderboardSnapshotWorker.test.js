const {
  getPreviousUtcDateString,
  acquireLeaderboardLock,
  renewLeaderboardLock,
  releaseLeaderboardLock,
  runLeaderboardSnapshotJob,
  startLeaderboardSnapshotWorker,
  RELEASE_LOCK_LUA,
  RENEW_LOCK_LUA,
} = require("../../../src/workers/leaderboardSnapshotWorker");

const leaderboardService = require("../../../src/services/leaderboardService");
const redisConfig = require("../../../src/config/redis");

describe("leaderboardSnapshotWorker unit tests", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("getPreviousUtcDateString", () => {
    test("calculates previous UTC calendar date string", () => {
      const date = new Date("2026-11-15T02:00:00.000Z");
      expect(getPreviousUtcDateString(date)).toBe("2026-11-14");
    });

    test("handles month boundaries correctly", () => {
      const date = new Date("2026-11-01T00:30:00.000Z");
      expect(getPreviousUtcDateString(date)).toBe("2026-10-31");
    });
  });

  describe("acquireLeaderboardLock, renewLeaderboardLock, and releaseLeaderboardLock", () => {
    test("acquires lock when Redis returns OK", async () => {
      const mockRedis = {
        status: "ready",
        set: jest.fn().mockResolvedValue("OK"),
      };
      jest.spyOn(redisConfig, "getRedis").mockResolvedValue(mockRedis);

      const acquired = await acquireLeaderboardLock("test-lock", "worker-1", 5000);
      expect(acquired).toBe(true);
      expect(mockRedis.set).toHaveBeenCalledWith("test-lock", "worker-1", "PX", 5000, "NX");
    });

    test("returns false when lock already held", async () => {
      const mockRedis = {
        status: "ready",
        set: jest.fn().mockResolvedValue(null),
      };
      jest.spyOn(redisConfig, "getRedis").mockResolvedValue(mockRedis);

      const acquired = await acquireLeaderboardLock("test-lock", "worker-2", 5000);
      expect(acquired).toBe(false);
    });

    test("fails closed (returns false) when Redis is unavailable", async () => {
      jest.spyOn(redisConfig, "getRedis").mockResolvedValue(null);

      const acquired = await acquireLeaderboardLock("test-lock", "worker-1", 5000);
      expect(acquired).toBe(false);
    });

    test("fails closed (returns false) when Redis throws an error during acquisition", async () => {
      const mockRedis = {
        status: "ready",
        set: jest.fn().mockRejectedValue(new Error("Connection lost")),
      };
      jest.spyOn(redisConfig, "getRedis").mockResolvedValue(mockRedis);

      const acquired = await acquireLeaderboardLock("test-lock", "worker-1", 5000);
      expect(acquired).toBe(false);
    });

    test("renews lock lease using atomic Lua script when held by worker", async () => {
      const mockRedis = {
        eval: jest.fn().mockResolvedValue(1),
      };
      jest.spyOn(redisConfig, "getRedis").mockResolvedValue(mockRedis);

      const renewed = await renewLeaderboardLock("test-lock", "worker-1", 10000);
      expect(renewed).toBe(true);
      expect(mockRedis.eval).toHaveBeenCalledWith(
        RENEW_LOCK_LUA,
        1,
        "test-lock",
        "worker-1",
        10000,
      );
    });

    test("fails to renew lock when lease is lost or held by another worker", async () => {
      const mockRedis = {
        eval: jest.fn().mockResolvedValue(0),
      };
      jest.spyOn(redisConfig, "getRedis").mockResolvedValue(mockRedis);

      const renewed = await renewLeaderboardLock("test-lock", "worker-1", 10000);
      expect(renewed).toBe(false);
    });

    test("releases lock using atomic Lua script only if current worker matches", async () => {
      const mockRedis = {
        eval: jest.fn().mockResolvedValue(1),
      };
      jest.spyOn(redisConfig, "getRedis").mockResolvedValue(mockRedis);

      const released = await releaseLeaderboardLock("test-lock", "worker-1");
      expect(released).toBe(true);
      expect(mockRedis.eval).toHaveBeenCalledWith(
        RELEASE_LOCK_LUA,
        1,
        "test-lock",
        "worker-1",
      );

      // When another worker holds it, eval returns 0
      mockRedis.eval.mockResolvedValue(0);
      const otherReleased = await releaseLeaderboardLock("test-lock", "worker-1");
      expect(otherReleased).toBe(false);
    });
  });

  describe("runLeaderboardSnapshotJob", () => {
    test("skips if current UTC hour is before scheduled hour", async () => {
      const now = new Date("2026-11-15T01:30:00.000Z"); // 01:30 UTC, schedule is 02:00
      const result = await runLeaderboardSnapshotJob({
        now,
        scheduleHourUtc: 2,
      });

      expect(result.skipped).toBe(true);
      expect(result.reason).toBe("BEFORE_SCHEDULED_HOUR");
    });

    test("skips if all 4 period snapshots are already generated for target date", async () => {
      const now = new Date("2026-11-15T02:15:00.000Z");
      const mockClient = {
        leaderboardSnapshot: {
          findMany: jest.fn().mockResolvedValue([
            { period: "DAILY" },
            { period: "WEEKLY" },
            { period: "MONTHLY" },
            { period: "ALL_TIME" },
          ]),
        },
      };

      const result = await runLeaderboardSnapshotJob({
        now,
        client: mockClient,
        scheduleHourUtc: 2,
      });

      expect(result.skipped).toBe(true);
      expect(result.reason).toBe("ALREADY_GENERATED");
    });

    test("skips if lock is held by another worker replica", async () => {
      const now = new Date("2026-11-15T02:15:00.000Z");
      const mockClient = {
        leaderboardSnapshot: {
          findMany: jest.fn().mockResolvedValue([]),
        },
      };

      const mockRedis = {
        status: "ready",
        set: jest.fn().mockResolvedValue(null), // lock taken
      };
      jest.spyOn(redisConfig, "getRedis").mockResolvedValue(mockRedis);

      const result = await runLeaderboardSnapshotJob({
        now,
        client: mockClient,
        scheduleHourUtc: 2,
      });

      expect(result.skipped).toBe(true);
      expect(result.reason).toBe("LOCKED_BY_ANOTHER_WORKER");
    });

    test("skips and fails closed if Redis is down/unavailable when job runs", async () => {
      const now = new Date("2026-11-15T02:15:00.000Z");
      const mockClient = {
        leaderboardSnapshot: {
          findMany: jest.fn().mockResolvedValue([]),
        },
      };

      jest.spyOn(redisConfig, "getRedis").mockResolvedValue(null);

      const result = await runLeaderboardSnapshotJob({
        now,
        client: mockClient,
        scheduleHourUtc: 2,
      });

      expect(result.skipped).toBe(true);
      expect(result.reason).toBe("LOCKED_BY_ANOTHER_WORKER");
    });

    test("executes generateLeaderboardSnapshots when due and lock acquired", async () => {
      const now = new Date("2026-11-15T02:15:00.000Z");
      const mockClient = {
        leaderboardSnapshot: {
          findMany: jest.fn().mockResolvedValue([]),
        },
      };

      const mockRedis = {
        status: "ready",
        set: jest.fn().mockResolvedValue("OK"),
        get: jest.fn().mockResolvedValue("worker-test"),
        del: jest.fn().mockResolvedValue(1),
        eval: jest.fn().mockResolvedValue(1),
      };
      jest.spyOn(redisConfig, "getRedis").mockResolvedValue(mockRedis);

      const snapshotSpy = jest.spyOn(leaderboardService, "generateLeaderboardSnapshots").mockResolvedValue({
        snapshotDate: new Date("2026-11-14T00:00:00.000Z"),
        leaderboards: [
          { period: "DAILY", entries: 10 },
          { period: "WEEKLY", entries: 10 },
          { period: "MONTHLY", entries: 10 },
          { period: "ALL_TIME", entries: 10 },
        ],
      });

      const result = await runLeaderboardSnapshotJob({
        now,
        client: mockClient,
        scheduleHourUtc: 2,
        workerId: "worker-test",
      });

      expect(result.success).toBe(true);
      expect(result.targetDate).toBe("2026-11-14");
      expect(snapshotSpy).toHaveBeenCalledWith({
        date: new Date("2026-11-14T00:00:00.000Z"),
      });
      expect(mockRedis.eval).toHaveBeenCalledWith(
        RELEASE_LOCK_LUA,
        1,
        "lock:leaderboard-snapshot:2026-11-14",
        "worker-test",
      );
    });
  });

  describe("startLeaderboardSnapshotWorker", () => {
    test("starts and stops timer cleanly", () => {
      const worker = startLeaderboardSnapshotWorker({ autoStart: false });
      expect(typeof worker.stop).toBe("function");
      expect(typeof worker.run).toBe("function");
      worker.stop();
    });
  });
});

