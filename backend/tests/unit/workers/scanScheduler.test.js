const {
  startScanScheduler,
} = require("../../../src/workers/scanScheduler");

function makeLog() {
  return { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
}

function makeTimers() {
  const scheduled = [];
  const cleared = [];

  return {
    scheduled,
    cleared,
    setTimer(fn, ms) {
      const handle = { fn, ms, unref: jest.fn() };
      scheduled.push(handle);
      return handle;
    },
    clearTimer(handle) {
      cleared.push(handle);
    },
  };
}

async function flush() {
  await new Promise((resolve) => setImmediate(resolve));
}

describe("order scan scheduler", () => {
  test("stops retrying once registration succeeds", async () => {
    const log = makeLog();
    const timers = makeTimers();
    const ensureScheduler = jest.fn(async () => ({ scheduled: true }));

    const scheduler = startScanScheduler({
      ensureScheduler,
      intervalMs: 5000,
      log,
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
    });

    await flush();

    expect(ensureScheduler).toHaveBeenCalledWith({ every: 5000 });
    expect(log.info).toHaveBeenCalledTimes(1);
    expect(log.warn).not.toHaveBeenCalled();
    expect(timers.scheduled).toHaveLength(0);

    scheduler.stop();
  });

  test("retries with backoff and succeeds on a later attempt", async () => {
    const log = makeLog();
    const timers = makeTimers();
    const ensureScheduler = jest
      .fn()
      .mockResolvedValueOnce({ scheduled: false, reason: "redis down" })
      .mockResolvedValueOnce({ scheduled: true });

    const scheduler = startScanScheduler({
      ensureScheduler,
      intervalMs: 5000,
      log,
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
    });

    await flush();

    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(timers.scheduled).toHaveLength(1);
    expect(timers.scheduled[0].ms).toBeGreaterThan(0);

    // Fire the retry.
    timers.scheduled[0].fn();
    await flush();

    expect(ensureScheduler).toHaveBeenCalledTimes(2);
    expect(log.info).toHaveBeenCalledTimes(1);

    scheduler.stop();
  });

  test("treats a thrown registration error as a retryable failure", async () => {
    const log = makeLog();
    const timers = makeTimers();
    const ensureScheduler = jest.fn(async () => {
      throw new Error("connection refused");
    });

    const scheduler = startScanScheduler({
      ensureScheduler,
      intervalMs: 5000,
      log,
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
    });

    await flush();

    expect(log.warn).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ reason: "connection refused" }),
    );
    expect(timers.scheduled).toHaveLength(1);

    scheduler.stop();
  });

  test("stop clears the pending retry and prevents further attempts", async () => {
    const log = makeLog();
    const timers = makeTimers();
    const ensureScheduler = jest.fn(async () => ({ scheduled: false }));

    const scheduler = startScanScheduler({
      ensureScheduler,
      intervalMs: 5000,
      log,
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
    });

    await flush();

    const handle = timers.scheduled[0];
    scheduler.stop();

    expect(timers.cleared).toContain(handle);

    // Even if the timer somehow fires, a stopped scheduler does nothing.
    handle.fn();
    await flush();

    expect(ensureScheduler).toHaveBeenCalledTimes(1);
  });

  test("requires an ensureScheduler function", () => {
    expect(() => startScanScheduler({ intervalMs: 5000 })).toThrow(
      /ensureScheduler/i,
    );
  });
});

describe("explicit cron schedules", () => {
  test("passes a cron schedule through instead of a fixed interval", async () => {
    const log = makeLog();
    const ensureScheduler = jest.fn(async () => ({ scheduled: true }));

    startScanScheduler({
      ensureScheduler,
      intervalMs: 60000,
      schedule: { cron: "0 1 * * *", tz: "UTC" },
      log,
    });

    await flush();

    expect(ensureScheduler).toHaveBeenCalledWith({
      cron: "0 1 * * *",
      tz: "UTC",
    });
  });
});
