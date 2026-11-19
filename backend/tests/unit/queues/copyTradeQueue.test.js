jest.mock("../../../src/queues/index", () => ({
  getQueue: jest.fn(),
  isQueuesEnabled: jest.fn(),
  closeQueues: jest.fn(),
}));

const { getQueue } = require("../../../src/queues/index");
const {
  enqueueCopyTradeFanOut,
} = require("../../../src/queues/copyTradeQueue");
const {
  QUEUE_NAMES,
  COPY_TRADE_JOB_NAMES,
} = require("../../../src/queues/definitions");

const TRADE_ID = "6f1f7c2e-0d7f-4c2a-9b8f-2f9a1d0c3b4e";

function makeQueue() {
  return {
    add: jest.fn(async (name, data, options) => ({
      id: options?.jobId ?? "job-1",
      name,
      data,
    })),
    getJob: jest.fn(),
  };
}

describe("copy trade queue", () => {
  let queue;

  beforeEach(() => {
    queue = makeQueue();
    getQueue.mockReturnValue(queue);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("enqueueCopyTradeFanOut", () => {
    test("enqueues a fan-out job keyed by the trade id", async () => {
      const result = await enqueueCopyTradeFanOut({ tradeId: TRADE_ID });

      expect(queue.add).toHaveBeenCalledWith(
        COPY_TRADE_JOB_NAMES.FAN_OUT,
        { tradeId: TRADE_ID },
        expect.objectContaining({ jobId: TRADE_ID }),
      );
      expect(result).toEqual({ enqueued: true, jobId: TRADE_ID });
    });

    test("retries a retained failed job instead of being deduplicated by its id", async () => {
      const retry = jest.fn(async () => {});
      queue.getJob.mockResolvedValue({
        id: TRADE_ID,
        getState: async () => "failed",
        retry,
      });

      const result = await enqueueCopyTradeFanOut({ tradeId: TRADE_ID });

      expect(retry).toHaveBeenCalledTimes(1);
      expect(queue.add).not.toHaveBeenCalled();
      expect(result).toEqual({
        enqueued: true,
        jobId: TRADE_ID,
        retried: true,
      });
    });

    test("removes a completed job so the trade can be fanned out again", async () => {
      const remove = jest.fn(async () => {});
      queue.getJob.mockResolvedValue({
        id: TRADE_ID,
        getState: async () => "completed",
        remove,
      });

      const result = await enqueueCopyTradeFanOut({ tradeId: TRADE_ID });

      expect(remove).toHaveBeenCalledTimes(1);
      expect(queue.add).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ enqueued: true, jobId: TRADE_ID });
    });

    test("is a no-op when queues are disabled", async () => {
      getQueue.mockReturnValue(null);

      const result = await enqueueCopyTradeFanOut({ tradeId: TRADE_ID });

      expect(result).toEqual({ enqueued: false, reason: "QUEUES_DISABLED" });
      expect(queue.add).not.toHaveBeenCalled();
    });
  });
});
