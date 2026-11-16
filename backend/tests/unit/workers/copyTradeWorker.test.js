jest.mock("../../../src/services/copyTradeService", () => ({
  fanOutCopyTrades: jest.fn(),
  scanUnprocessedCopyTrades: jest.fn(),
  DEFAULT_MAX_ATTEMPTS: 3,
}));

jest.mock("../../../src/queues/connection", () => ({
  createQueueConnection: jest.fn(),
}));

jest.mock("../../../src/queues/copyTradeQueue", () => ({
  enqueueCopyTradeFanOut: jest.fn(),
}));

const {
  fanOutCopyTrades,
  scanUnprocessedCopyTrades,
} = require("../../../src/services/copyTradeService");
const {
  enqueueCopyTradeFanOut,
} = require("../../../src/queues/copyTradeQueue");
const {
  handleCopyTradeJob,
} = require("../../../src/workers/copyTradeWorker");
const { COPY_TRADE_JOB_NAMES } = require("../../../src/queues/definitions");

const TRADE_ID = "6f1f7c2e-0d7f-4c2a-9b8f-2f9a1d0c3b4e";

function makeJob(overrides = {}) {
  return {
    id: "job-1",
    name: COPY_TRADE_JOB_NAMES.FAN_OUT,
    data: { tradeId: TRADE_ID },
    ...overrides,
  };
}

describe("copy-trade worker handler", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("routes a fan-out job to the service", async () => {
    fanOutCopyTrades.mockResolvedValue({
      sourceTradeId: TRADE_ID,
      eligible: 1,
      placed: 1,
      failed: 0,
      skipped: 0,
      retryable: 0,
    });

    const result = await handleCopyTradeJob(makeJob(), { maxAttempts: 3 });

    expect(fanOutCopyTrades).toHaveBeenCalledWith({
      tradeId: TRADE_ID,
      orderService: undefined,
      maxAttempts: 3,
    });
    expect(result).toMatchObject({ placed: 1 });
  });

  test("scan-pending enqueues every unprocessed trade", async () => {
    scanUnprocessedCopyTrades.mockResolvedValue([
      { id: TRADE_ID },
      { id: "8a2e6b4d-1c3f-4d5e-9a7b-0c1d2e3f4a5b" },
    ]);
    enqueueCopyTradeFanOut.mockResolvedValue({ enqueued: true });

    const result = await handleCopyTradeJob(
      makeJob({ name: COPY_TRADE_JOB_NAMES.SCAN_PENDING, data: { limit: 10 } }),
      { batchSize: 100 },
    );

    expect(scanUnprocessedCopyTrades).toHaveBeenCalledWith({ limit: 10 });
    expect(enqueueCopyTradeFanOut).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ scanned: 2, enqueued: 2, failed: 0 });
  });

  test("rejects an unknown job name as unrecoverable", async () => {
    await expect(
      handleCopyTradeJob(makeJob({ name: "mystery" }), {}),
    ).rejects.toMatchObject({ name: "UnrecoverableError" });
  });

  test("treats a missing source trade as unrecoverable", async () => {
    fanOutCopyTrades.mockRejectedValue(
      Object.assign(new Error("missing"), { code: "SOURCE_TRADE_NOT_FOUND" }),
    );

    await expect(handleCopyTradeJob(makeJob(), {})).rejects.toMatchObject({
      name: "UnrecoverableError",
    });
  });

  test("lets a retryable failure surface as a normal error", async () => {
    fanOutCopyTrades.mockRejectedValue(
      Object.assign(new Error("retry"), { code: "COPY_TRADE_RETRY" }),
    );

    await expect(handleCopyTradeJob(makeJob(), {})).rejects.toMatchObject({
      code: "COPY_TRADE_RETRY",
    });
  });
});
