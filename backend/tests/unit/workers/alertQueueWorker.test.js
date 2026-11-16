jest.mock("../../../src/services/alertEvaluationService", () => ({
  evaluateAlertById: jest.fn(),
  scanActiveAlerts: jest.fn(),
}));

const {
  evaluateAlertById,
  scanActiveAlerts,
} = require("../../../src/services/alertEvaluationService");
const { handleAlertJob } = require("../../../src/workers/alertQueueWorker");
const { ALERT_JOB_NAMES } = require("../../../src/queues/definitions");

const ALERT_ID = "8a2e6b4d-1c3f-4d5e-9a7b-0c1d2e3f4a5b";

describe("alert queue job handler", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("rejects an unknown job name as unrecoverable", async () => {
    await expect(
      handleAlertJob({ name: "mystery", data: {} }),
    ).rejects.toMatchObject({ name: "UnrecoverableError" });
  });

  test("treats a deleted alert as unrecoverable", async () => {
    evaluateAlertById.mockResolvedValue({ outcome: "not_found" });

    await expect(
      handleAlertJob({
        name: ALERT_JOB_NAMES.EVALUATE_ALERT,
        data: { alertId: ALERT_ID },
      }),
    ).rejects.toMatchObject({ name: "UnrecoverableError" });
  });

  test("returns the evaluation result", async () => {
    evaluateAlertById.mockResolvedValue({
      outcome: "triggered",
      alertId: ALERT_ID,
    });

    const result = await handleAlertJob(
      {
        name: ALERT_JOB_NAMES.EVALUATE_ALERT,
        data: { alertId: ALERT_ID },
      },
      { quoteProvider: { getQuote: jest.fn() } },
    );

    expect(result).toEqual({ outcome: "triggered", alertId: ALERT_ID });
  });

  test("forwards the scan filters and batch size", async () => {
    scanActiveAlerts.mockResolvedValue({ scanned: 0, triggered: 0 });

    const options = {
      quoteProvider: { getQuote: jest.fn() },
      now: () => new Date("2026-01-01T00:00:00.000Z"),
      batchSize: 25,
    };

    await handleAlertJob(
      {
        name: ALERT_JOB_NAMES.SCAN_ALERTS,
        data: { symbol: "AAPL" },
      },
      options,
    );

    expect(scanActiveAlerts).toHaveBeenCalledWith(
      { symbol: "AAPL", limit: 25 },
      { quoteProvider: options.quoteProvider, now: options.now },
    );
  });
});
