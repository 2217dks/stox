const mockFakeRedis = {
  store: new Map(),
  get: jest.fn(async (key) => mockFakeRedis.store.get(key) ?? null),
  set: jest.fn(async (key, val, ex, ttl) => {
    mockFakeRedis.store.set(key, val);
    return "OK";
  }),
  del: jest.fn(async (...keys) => {
    let count = 0;
    for (const k of keys) {
      if (mockFakeRedis.store.delete(k)) count++;
    }
    return count;
  }),
  incr: jest.fn(async (key) => {
    const cur = Number(mockFakeRedis.store.get(key) || 0);
    const next = cur + 1;
    mockFakeRedis.store.set(key, String(next));
    return next;
  }),
  eval: jest.fn(async (script, numKeys, key1, key2, expectedGen, val, ttl) => {
    // Emulates CACHE_ANALYTICS_IF_GENERATION_MATCHES
    const currentGen = mockFakeRedis.store.get(key1);
    if (currentGen === expectedGen) {
      mockFakeRedis.store.set(key2, val);
      return 1;
    }
    return 0;
  }),
};

jest.mock("../../../src/config/redis", () => ({
  getRedis: jest.fn(async () => mockFakeRedis),
}));

jest.mock("../../../src/utils/logger", () => ({
  warn: jest.fn(),
  info: jest.fn(),
}));

const cacheService = require("../../../src/services/cacheService");
const cacheKeys = require("../../../src/utils/cacheKeys");

describe("Analytics Cache Race and Invalidation Mechanics", () => {
  const portfolioId = "port-race-111";
  const userId = "user-race-222";

  beforeEach(() => {
    mockFakeRedis.store.clear();
    jest.clearAllMocks();
  });

  test("stale in-flight portfolio loader cannot repopulate cache after invalidation", async () => {
    // Initial generation is 0
    mockFakeRedis.store.set(cacheKeys.portfolioAnalyticsGeneration(portfolioId), "0");

    let resolveInFlight;
    const inFlightPromise = new Promise((resolve) => {
      resolveInFlight = resolve;
    });

    // Loader 1 starts while generation is 0
    const loader1 = jest.fn(async () => {
      await inFlightPromise;
      return { heatmap: [{ date: "2026-01-01", pnl: "100" }] };
    });

    const runLoader1 = cacheService.getOrSetPortfolioHeatmap(
      portfolioId,
      userId,
      { period: "1M" },
      loader1,
    );

    // Invalidation occurs while Loader 1 is still computing
    await cacheService.invalidatePortfolioAnalytics(portfolioId);
    expect(mockFakeRedis.store.get(cacheKeys.portfolioAnalyticsGeneration(portfolioId))).toBe("1");

    // Loader 1 finally completes
    resolveInFlight();
    const result1 = await runLoader1;
    expect(result1).toEqual({ heatmap: [{ date: "2026-01-01", pnl: "100" }] });

    // The stale write for generation 0 was rejected by the generation check
    const gen0Key = cacheKeys.analyticsPortfolioHeatmap(portfolioId, userId, {
      period: "1M",
      generation: "0",
    });
    expect(mockFakeRedis.store.has(gen0Key)).toBe(false);

    // Subsequent request starts with generation 1 and populates fresh data
    const loader2 = jest.fn().mockResolvedValue({
      heatmap: [{ date: "2026-01-01", pnl: "200" }],
    });

    const result2 = await cacheService.getOrSetPortfolioHeatmap(
      portfolioId,
      userId,
      { period: "1M" },
      loader2,
    );

    expect(result2).toEqual({ heatmap: [{ date: "2026-01-01", pnl: "200" }] });
    expect(loader2).toHaveBeenCalledTimes(1);

    const gen1Key = cacheKeys.analyticsPortfolioHeatmap(portfolioId, userId, {
      period: "1M",
      generation: "1",
    });
    expect(mockFakeRedis.store.has(gen1Key)).toBe(true);

    // Immediate second read is a cache hit
    const loader3 = jest.fn();
    const result3 = await cacheService.getOrSetPortfolioHeatmap(
      portfolioId,
      userId,
      { period: "1M" },
      loader3,
    );
    expect(result3).toEqual({ heatmap: [{ date: "2026-01-01", pnl: "200" }] });
    expect(loader3).not.toHaveBeenCalled();
  });

  test("stale in-flight user statistics loader cannot repopulate cache after trade invalidation", async () => {
    mockFakeRedis.store.set(cacheKeys.userAnalyticsGeneration(userId), "0");

    let resolveSlowStats;
    const slowStatsPromise = new Promise((resolve) => {
      resolveSlowStats = resolve;
    });

    const slowStatsLoader = jest.fn(async () => {
      await slowStatsPromise;
      return { totalTrades: 1, totalVolume: "100" };
    });

    const runSlow = cacheService.getOrSetUserStatistics(
      userId,
      { symbol: "AAPL" },
      slowStatsLoader,
    );

    // Trade executes -> invalidates user analytics (generation -> 1)
    await cacheService.invalidateUserAnalytics(userId);
    expect(mockFakeRedis.store.get(cacheKeys.userAnalyticsGeneration(userId))).toBe("1");

    // Slow loader finishes
    resolveSlowStats();
    await runSlow;

    // Verify stale key was not set
    const staleKey = cacheKeys.analyticsUserStatistics(userId, {
      symbol: "AAPL",
      generation: "0",
    });
    expect(mockFakeRedis.store.has(staleKey)).toBe(false);

    // Fresh loader writes under generation 1
    const freshStatsLoader = jest.fn().mockResolvedValue({
      totalTrades: 2,
      totalVolume: "250",
    });

    const freshResult = await cacheService.getOrSetUserStatistics(
      userId,
      { symbol: "AAPL" },
      freshStatsLoader,
    );

    expect(freshResult).toEqual({ totalTrades: 2, totalVolume: "250" });
    const freshKey = cacheKeys.analyticsUserStatistics(userId, {
      symbol: "AAPL",
      generation: "1",
    });
    expect(mockFakeRedis.store.has(freshKey)).toBe(true);
  });

  test("preserves null/missing values and decimal string types across cache writes", async () => {
    const rawMetrics = {
      annualizedVolatility: null,
      maxDrawdown: "-0.1550",
      sharpeRatio: null,
      observationCount: 1,
    };

    const loader = jest.fn().mockResolvedValue(rawMetrics);
    const cachedResult = await cacheService.getOrSetPortfolioRiskMetrics(
      portfolioId,
      userId,
      { period: "1M" },
      loader,
    );

    expect(cachedResult).toEqual(rawMetrics);
    expect(cachedResult.annualizedVolatility).toBeNull();
    expect(cachedResult.maxDrawdown).toBe("-0.1550");
    expect(cachedResult.sharpeRatio).toBeNull();

    // Re-read from cache
    const secondResult = await cacheService.getOrSetPortfolioRiskMetrics(
      portfolioId,
      userId,
      { period: "1M" },
      jest.fn(),
    );

    expect(secondResult).toEqual(rawMetrics);
  });

  test("ensures strict cross-user and cross-portfolio cache separation", async () => {
    const userA = "user-A";
    const userB = "user-B";
    const portA = "port-A";
    const portB = "port-B";

    const loaderA = jest.fn().mockResolvedValue({ user: "A" });
    const loaderB = jest.fn().mockResolvedValue({ user: "B" });

    const resA = await cacheService.getOrSetPortfolioHeatmap(
      portA,
      userA,
      { period: "1M" },
      loaderA,
    );
    const resB = await cacheService.getOrSetPortfolioHeatmap(
      portB,
      userB,
      { period: "1M" },
      loaderB,
    );

    expect(resA).toEqual({ user: "A" });
    expect(resB).toEqual({ user: "B" });
    expect(loaderA).toHaveBeenCalledTimes(1);
    expect(loaderB).toHaveBeenCalledTimes(1);
  });
});
