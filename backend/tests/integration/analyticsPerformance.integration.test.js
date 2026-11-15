const request = require("supertest");
const app = require("../../src/app");
const prisma = require("../../src/config/database");
const { disconnectRedis } = require("../../src/config/redis");
const cacheService = require("../../src/services/cacheService");
const { upsertSnapshot } = require("../../src/services/portfolioSnapshotRepository");

describe("Analytics Caching & Performance Integration Tests", () => {
  const timestamp = Date.now();

  const userA = {
    name: "Perf User A",
    email: `perf-user-a-${timestamp}@example.com`,
    password: "PerfPassword#2026",
  };

  const userB = {
    name: "Perf User B",
    email: `perf-user-b-${timestamp}@example.com`,
    password: "PerfPassword#2026",
  };

  let userAId;
  let userBId;
  let tokenA;
  let tokenB;
  let portfolioAId;
  let portfolioBId;

  beforeAll(async () => {
    // 1. Register User A
    const resA = await request(app).post("/api/v1/auth/register").send(userA);
    expect([200, 201]).toContain(resA.status);
    userAId = resA.body.data.user.id;
    tokenA = resA.body.data.accessToken;

    // 2. Register User B
    const resB = await request(app).post("/api/v1/auth/register").send(userB);
    expect([200, 201]).toContain(resB.status);
    userBId = resB.body.data.user.id;
    tokenB = resB.body.data.accessToken;

    const portA = await prisma.portfolio.findFirst({
      where: { userId: userAId, isDefault: true },
    });
    const portB = await prisma.portfolio.findFirst({
      where: { userId: userBId, isDefault: true },
    });
    portfolioAId = portA.id;
    portfolioBId = portB.id;

    // 3. Seed PerformanceSnapshots for User A
    await prisma.performanceSnapshot.createMany({
      data: [
        {
          portfolioId: portfolioAId,
          snapshotDate: new Date("2026-01-10T00:00:00.000Z"),
          totalValue: "10000.00000000",
          cashBalance: "10000.00000000",
          holdingsValue: "0.00000000",
          dailyPnl: "0.00000000",
          dailyPnlPct: "0.0000",
        },
        {
          portfolioId: portfolioAId,
          snapshotDate: new Date("2026-01-31T00:00:00.000Z"),
          totalValue: "10500.00000000",
          cashBalance: "10000.00000000",
          holdingsValue: "500.00000000",
          dailyPnl: "500.00000000",
          dailyPnlPct: "5.0000",
        },
      ],
    });
  });

  describe("Caching & Hit/Miss Lifecycle", () => {
    test("populates cache on first request and serves identical payload on repeat", async () => {
      const initialGen = await cacheService.getPortfolioAnalyticsGeneration(portfolioAId);

      const res1 = await request(app)
        .get(`/api/v1/portfolios/${portfolioAId}/analytics/monthly-performance`)
        .set("Authorization", `Bearer ${tokenA}`);

      expect(res1.status).toBe(200);
      expect(res1.body.data.months).toHaveLength(1);
      expect(res1.body.data.months[0].netPnl).toBe("500");

      const res2 = await request(app)
        .get(`/api/v1/portfolios/${portfolioAId}/analytics/monthly-performance`)
        .set("Authorization", `Bearer ${tokenA}`);

      expect(res2.status).toBe(200);
      expect(res2.body.data).toEqual(res1.body.data);

      const currentGen = await cacheService.getPortfolioAnalyticsGeneration(portfolioAId);
      expect(currentGen).toBe(initialGen);
    });
  });

  describe("Snapshot Invalidation", () => {
    test("invalidates cached analytics when a new snapshot is captured/upserted", async () => {
      // First ensure monthly performance is cached
      const resBefore = await request(app)
        .get(`/api/v1/portfolios/${portfolioAId}/analytics/monthly-performance`)
        .set("Authorization", `Bearer ${tokenA}`);
      expect(resBefore.status).toBe(200);
      expect(resBefore.body.data.months).toHaveLength(1);

      const genBefore = await cacheService.getPortfolioAnalyticsGeneration(portfolioAId);

      // Upsert a February snapshot for portfolio A
      await upsertSnapshot(prisma, {
        portfolioId: portfolioAId,
        snapshotDate: new Date("2026-02-28T00:00:00.000Z"),
        totalValue: "11200.00000000",
        cashBalance: "10000.00000000",
        holdingsValue: "1200.00000000",
        dailyPnl: "700.00000000",
        dailyPnlPct: "6.6667",
      });

      const genAfter = await cacheService.getPortfolioAnalyticsGeneration(portfolioAId);
      expect(Number(genAfter)).toBe(Number(genBefore) + 1);

      // Next request must reflect the newly added February month
      const resAfter = await request(app)
        .get(`/api/v1/portfolios/${portfolioAId}/analytics/monthly-performance`)
        .set("Authorization", `Bearer ${tokenA}`);

      expect(resAfter.status).toBe(200);
      expect(resAfter.body.data.months).toHaveLength(2);
      expect(resAfter.body.data.months[1].month).toBe("2026-02");
      expect(resAfter.body.data.months[1].endValue).toBe("11200");
    });
  });

  describe("User Statistics Caching and Invalidation", () => {
    test("caches user statistics and isolates cross-user cache access", async () => {
      // User A statistics
      const resA = await request(app)
        .get("/api/v1/users/me/statistics")
        .set("Authorization", `Bearer ${tokenA}`);
      expect(resA.status).toBe(200);
      expect(resA.body.data.statistics.totalTrades).toBe(0);

      // User B statistics
      const resB = await request(app)
        .get("/api/v1/users/me/statistics")
        .set("Authorization", `Bearer ${tokenB}`);
      expect(resB.status).toBe(200);
      expect(resB.body.data.statistics.totalTrades).toBe(0);

      // Invalidate User A statistics
      const genABefore = await cacheService.getUserAnalyticsGeneration(userAId);
      const genBBefore = await cacheService.getUserAnalyticsGeneration(userBId);

      await cacheService.invalidateUserAnalytics(userAId);

      const genAAfter = await cacheService.getUserAnalyticsGeneration(userAId);
      const genBAfter = await cacheService.getUserAnalyticsGeneration(userBId);

      expect(Number(genAAfter)).toBe(Number(genABefore) + 1);
      // User B's generation is unaffected
      expect(genBAfter).toBe(genBBefore);
    });

    test("enforces account existence and suspension before serving cached responses", async () => {
      // 1. Create a dedicated user for suspension and deletion testing
      const userC = {
        name: "Suspension Test User",
        email: `suspension-user-${Date.now()}@example.com`,
        password: "SuspensionPass#2026",
      };
      const resC = await request(app).post("/api/v1/auth/register").send(userC);
      expect([200, 201]).toContain(resC.status);
      const userCId = resC.body.data.user.id;
      const tokenC = resC.body.data.accessToken;

      // 2. Populate the cache for active user
      const initialStats = await request(app)
        .get("/api/v1/users/me/statistics")
        .set("Authorization", `Bearer ${tokenC}`);
      expect(initialStats.status).toBe(200);
      expect(initialStats.body.data.statistics.totalTrades).toBe(0);

      const initialMonthly = await request(app)
        .get("/api/v1/users/me/statistics/monthly")
        .set("Authorization", `Bearer ${tokenC}`);
      expect(initialMonthly.status).toBe(200);
      expect(initialMonthly.body.data.monthly).toEqual([]);

      // Verify second request hits the cache for active user
      const cachedStats = await request(app)
        .get("/api/v1/users/me/statistics")
        .set("Authorization", `Bearer ${tokenC}`);
      expect(cachedStats.status).toBe(200);
      expect(cachedStats.body.data).toEqual(initialStats.body.data);

      // 3. Mark the user suspended in database while JWT is still valid
      await prisma.user.update({
        where: { id: userCId },
        data: { isSuspended: true },
      });

      // 4. Retry with still-valid token: assert 403 ACCOUNT_SUSPENDED even on cache hit
      const suspendedStatsRes = await request(app)
        .get("/api/v1/users/me/statistics")
        .set("Authorization", `Bearer ${tokenC}`);
      expect(suspendedStatsRes.status).toBe(403);
      expect(suspendedStatsRes.body.error.code).toBe("ACCOUNT_SUSPENDED");

      const suspendedMonthlyRes = await request(app)
        .get("/api/v1/users/me/statistics/monthly")
        .set("Authorization", `Bearer ${tokenC}`);
      expect(suspendedMonthlyRes.status).toBe(403);
      expect(suspendedMonthlyRes.body.error.code).toBe("ACCOUNT_SUSPENDED");

      // 5. Delete the user from database while JWT is still valid
      await prisma.user.delete({
        where: { id: userCId },
      });

      // 6. Retry with still-valid token: assert 404 USER_NOT_FOUND even on cache hit
      const deletedStatsRes = await request(app)
        .get("/api/v1/users/me/statistics")
        .set("Authorization", `Bearer ${tokenC}`);
      expect(deletedStatsRes.status).toBe(404);
      expect(deletedStatsRes.body.error.code).toBe("USER_NOT_FOUND");

      const deletedMonthlyRes = await request(app)
        .get("/api/v1/users/me/statistics/monthly")
        .set("Authorization", `Bearer ${tokenC}`);
      expect(deletedMonthlyRes.status).toBe(404);
      expect(deletedMonthlyRes.body.error.code).toBe("USER_NOT_FOUND");

      // 7. Verify normal active user (User A) is unaffected and receives valid responses
      const activeRes = await request(app)
        .get("/api/v1/users/me/statistics")
        .set("Authorization", `Bearer ${tokenA}`);
      expect(activeRes.status).toBe(200);
      expect(activeRes.body.data.statistics.totalTrades).toBe(0);
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await disconnectRedis();
  });
});
