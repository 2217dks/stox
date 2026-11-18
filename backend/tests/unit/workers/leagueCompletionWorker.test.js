const {
  startLeagueCompletionWorker,
} = require("../../../src/workers/leagueCompletionWorker");
const competitionService = require("../../../src/services/competitionService");
const logger = require("../../../src/utils/logger");

jest.mock("../../../src/services/competitionService", () => ({
  processCompletedLeagues: jest.fn(),
}));

jest.mock("../../../src/utils/logger", () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
}));

describe("leagueCompletionWorker", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test("runs completion on startup and sets up interval timer", async () => {
    competitionService.processCompletedLeagues.mockResolvedValue([
      { completed: true, leagueId: "league-1" },
    ]);

    const worker = startLeagueCompletionWorker({
      intervalMs: 30000,
      runOnStartup: true,
    });

    expect(competitionService.processCompletedLeagues).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(30000);
    expect(competitionService.processCompletedLeagues).toHaveBeenCalledTimes(2);

    worker.stop();
  });

  test("can disable runOnStartup", async () => {
    competitionService.processCompletedLeagues.mockResolvedValue([]);

    const worker = startLeagueCompletionWorker({
      intervalMs: 15000,
      runOnStartup: false,
    });

    expect(competitionService.processCompletedLeagues).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(15000);
    expect(competitionService.processCompletedLeagues).toHaveBeenCalledTimes(1);

    worker.stop();
  });

  test("handles error in tick gracefully without throwing", async () => {
    competitionService.processCompletedLeagues.mockRejectedValue(
      new Error("Database connection lost"),
    );

    const worker = startLeagueCompletionWorker({
      intervalMs: 20000,
      runOnStartup: true,
    });

    // Startup tick throws internally
    await Promise.resolve();
    expect(logger.error).toHaveBeenCalledWith(
      "League completion processing failed",
      expect.objectContaining({ error: "Database connection lost" }),
    );

    worker.stop();
  });

  test("stop clears interval and prevents future ticks", async () => {
    competitionService.processCompletedLeagues.mockResolvedValue([]);

    const worker = startLeagueCompletionWorker({
      intervalMs: 10000,
      runOnStartup: false,
    });

    worker.stop();

    await jest.advanceTimersByTimeAsync(30000);
    expect(competitionService.processCompletedLeagues).not.toHaveBeenCalled();
  });

  test("skips concurrent tick if previous run is still active", async () => {
    let resolvePromise;
    competitionService.processCompletedLeagues.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePromise = resolve;
        }),
    );

    const worker = startLeagueCompletionWorker({
      intervalMs: 5000,
      runOnStartup: false,
    });

    // Trigger tick manually
    const firstTick = worker.tick();
    expect(competitionService.processCompletedLeagues).toHaveBeenCalledTimes(1);

    // Trigger second tick while first is still pending
    await worker.tick();
    expect(competitionService.processCompletedLeagues).toHaveBeenCalledTimes(1);

    // Resolve first tick
    resolvePromise([]);
    await firstTick;

    // Next tick should now proceed
    competitionService.processCompletedLeagues.mockResolvedValue([]);
    await worker.tick();
    expect(competitionService.processCompletedLeagues).toHaveBeenCalledTimes(2);

    worker.stop();
  });
});

