const {
  captureDailyPortfolioSnapshots,
  startPortfolioSnapshotWorker,
} = require("../../../src/workers/portfolioSnapshotWorker");
const {
  captureAllPortfolioSnapshots,
} = require("../../../src/services/portfolioSnapshotService");

jest.mock("../../../src/services/portfolioSnapshotService", () => ({
  captureAllPortfolioSnapshots: jest.fn(),
  capturePortfolioSnapshot: jest.fn(),
}));

describe("portfolioSnapshotWorker unit tests", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("captureDailyPortfolioSnapshots delegates to captureAllPortfolioSnapshots", async () => {
    const mockResult = {
      snapshotDate: "2026-11-14",
      totalPortfolios: 3,
      successful: 3,
      failed: 0,
      errors: [],
    };
    captureAllPortfolioSnapshots.mockResolvedValue(mockResult);

    const asOf = new Date("2026-11-14T23:59:00.000Z");
    const result = await captureDailyPortfolioSnapshots({ asOf });

    expect(result).toEqual(mockResult);
    expect(captureAllPortfolioSnapshots).toHaveBeenCalledWith(
      expect.objectContaining({ asOf }),
    );
  });

  test("startPortfolioSnapshotWorker runs on demand and avoids duplicate runs on same UTC day", async () => {
    captureAllPortfolioSnapshots.mockResolvedValue({
      snapshotDate: "2026-11-14",
      totalPortfolios: 1,
      successful: 1,
      failed: 0,
      errors: [],
    });

    const fixedDate = new Date("2026-11-14T10:00:00.000Z");
    const worker = startPortfolioSnapshotWorker({
      intervalMs: 100000,
      autoStart: false,
    });

    try {
      // First run triggered
      await worker.run(fixedDate);
      expect(worker.getLastCapturedDate()).toBe("2026-11-14");
      expect(captureAllPortfolioSnapshots).toHaveBeenCalledTimes(1);

      // Second call on same date should skip execution
      await worker.run(fixedDate);
      expect(captureAllPortfolioSnapshots).toHaveBeenCalledTimes(1);

      // Explicit force option should run again
      await worker.run(fixedDate, { force: true });
      expect(captureAllPortfolioSnapshots).toHaveBeenCalledTimes(2);
    } finally {
      worker.stop();
    }
  });

  test("startPortfolioSnapshotWorker autoStart triggers capture on startup", async () => {
    captureAllPortfolioSnapshots.mockResolvedValue({
      snapshotDate: "2026-11-14",
      totalPortfolios: 1,
      successful: 1,
      failed: 0,
      errors: [],
    });

    const worker = startPortfolioSnapshotWorker({
      intervalMs: 100000,
      autoStart: true,
    });

    try {
      await worker.initialPromise;
      expect(captureAllPortfolioSnapshots).toHaveBeenCalledTimes(1);
      expect(worker.getLastCapturedDate()).toBe("2026-11-14");
    } finally {
      worker.stop();
    }
  });
});
