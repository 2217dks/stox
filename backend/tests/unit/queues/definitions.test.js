const {
  QUEUE_NAMES,
  ORDER_JOB_NAMES,
  COPY_TRADE_JOB_NAMES,
  SNAPSHOT_JOB_NAMES,
  QUEUE_POLICIES,
  jobOptionsFor,
} = require("../../../src/queues/definitions");

describe("queue definitions", () => {
  test("declares the registered queue names", () => {
    expect(QUEUE_NAMES).toEqual({
      ORDERS: "orders",
      NOTIFICATIONS: "notifications",
      ALERTS: "alerts",
      COPY_TRADES: "copy-trades",
      SNAPSHOTS: "snapshots",
    });
  });

  test("declares the order job names", () => {
    expect(ORDER_JOB_NAMES).toEqual({
      EXECUTE_ORDER: "execute-order",
      SCAN_PENDING: "scan-pending",
    });
  });

  test("declares the copy-trade job names", () => {
    expect(COPY_TRADE_JOB_NAMES).toEqual({
      FAN_OUT: "fan-out-copy-trades",
      SCAN_PENDING: "scan-pending",
    });
  });

  test("declares the snapshot job names", () => {
    expect(SNAPSHOT_JOB_NAMES).toEqual({
      GENERATE_PORTFOLIO_SNAPSHOTS: "generate-portfolio-snapshots",
      PRUNE_SNAPSHOT_RETENTION: "prune-snapshot-retention",
    });
  });

  test("copy-trade fan-out uses a bounded retry policy", () => {
    const fanOut = jobOptionsFor(
      QUEUE_NAMES.COPY_TRADES,
      COPY_TRADE_JOB_NAMES.FAN_OUT,
    );

    expect(fanOut.attempts).toBe(3);
    expect(fanOut.backoff).toEqual(
      expect.objectContaining({ type: "exponential" }),
    );
    expect(fanOut.removeOnComplete).toBe(true);
  });

  test("every queue has a default retry policy", () => {
    for (const name of Object.values(QUEUE_NAMES)) {
      expect(QUEUE_POLICIES[name]).toBeDefined();
      expect(QUEUE_POLICIES[name].defaultJobOptions.attempts).toBeGreaterThan(
        0,
      );
      expect(QUEUE_POLICIES[name].defaultJobOptions.backoff).toEqual(
        expect.objectContaining({ type: "exponential", delay: expect.any(Number) }),
      );
    }
  });

  test("retains completed and failed jobs for inspection", () => {
    const defaults = QUEUE_POLICIES[QUEUE_NAMES.ORDERS].defaultJobOptions;

    expect(defaults.removeOnComplete).toEqual({ count: expect.any(Number) });
    expect(defaults.removeOnFail).toEqual({ count: expect.any(Number) });
    expect(defaults.removeOnFail.count).toBeGreaterThan(
      defaults.removeOnComplete.count,
    );
  });

  test("per-job policies override the queue defaults", () => {
    const execute = jobOptionsFor(
      QUEUE_NAMES.ORDERS,
      ORDER_JOB_NAMES.EXECUTE_ORDER,
    );
    const scan = jobOptionsFor(QUEUE_NAMES.ORDERS, ORDER_JOB_NAMES.SCAN_PENDING);

    expect(execute.attempts).toBe(5);
    expect(scan.attempts).toBe(3);
    // Queue defaults still apply to fields the job policy does not override.
    expect(execute.removeOnFail).toEqual(
      QUEUE_POLICIES[QUEUE_NAMES.ORDERS].defaultJobOptions.removeOnFail,
    );
  });

  test("removes a completed execute-order job so the same order id can be re-enqueued", () => {
    const execute = jobOptionsFor(
      QUEUE_NAMES.ORDERS,
      ORDER_JOB_NAMES.EXECUTE_ORDER,
    );
    const scan = jobOptionsFor(QUEUE_NAMES.ORDERS, ORDER_JOB_NAMES.SCAN_PENDING);

    // BullMQ deduplicates by jobId even after completion while the completed
    // job is retained. A resting LIMIT order must be enqueued again on a later
    // scan, so execute-order completions are not retained.
    expect(execute.removeOnComplete).toBe(true);

    // The scan job has no stable jobId and keeps the bounded history.
    expect(scan.removeOnComplete).toEqual({ count: expect.any(Number) });
  });

  test("rejects an unknown queue or job instead of silently defaulting", () => {
    expect(() => jobOptionsFor("nope", "job")).toThrow(/unknown queue/i);
  });
});
