const {
  QUEUE_NAMES,
  ORDER_JOB_NAMES,
  QUEUE_POLICIES,
  jobOptionsFor,
} = require("../../../src/queues/definitions");

describe("queue definitions", () => {
  test("declares the registered queue names", () => {
    expect(QUEUE_NAMES).toEqual({
      ORDERS: "orders",
      NOTIFICATIONS: "notifications",
      ALERTS: "alerts",
    });
  });

  test("declares the order job names", () => {
    expect(ORDER_JOB_NAMES).toEqual({
      EXECUTE_ORDER: "execute-order",
      SCAN_PENDING: "scan-pending",
    });
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

  test("rejects an unknown queue or job instead of silently defaulting", () => {
    expect(() => jobOptionsFor("nope", "job")).toThrow(/unknown queue/i);
  });
});
