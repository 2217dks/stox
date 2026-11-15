const request = require("supertest");
const app = require("../../src/app");
const prisma = require("../../src/config/database");
const { disconnectRedis } = require("../../src/config/redis");
const cacheService = require("../../src/services/cacheService");
const { upsertSnapshot } = require("../../src/services/portfolioSnapshotRepository");
const {
  getUserStatistics,
  buildTradeFilter,
  computeWinRate,
  toDecimalString,
  serializeTradeSummary,
} = require("../../src/services/userStatisticsService");

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

  describe("Consolidated User Statistics Query & Equivalence", () => {
    let equivUserId;
    let equivPortfolio1Id;
    let equivPortfolio2Id;

    async function runLegacyFiveQueries(userId, filters = {}) {
      const ownedTradeFilter = buildTradeFilter(userId, filters);
      const [totals, winningTrades, losingTrades, bestTrade, worstTrade] =
        await Promise.all([
          prisma.trade.aggregate({
            where: ownedTradeFilter,
            _count: true,
            _sum: { totalValue: true },
            _avg: { realizedPnlPct: true },
          }),
          prisma.trade.count({
            where: { ...ownedTradeFilter, realizedPnl: { gt: 0 } },
          }),
          prisma.trade.count({
            where: { ...ownedTradeFilter, realizedPnl: { lt: 0 } },
          }),
          prisma.trade.findFirst({
            where: { ...ownedTradeFilter, realizedPnl: { not: null } },
            orderBy: [{ realizedPnl: "desc" }, { executedAt: "desc" }],
            select: { symbol: true, realizedPnl: true, realizedPnlPct: true },
          }),
          prisma.trade.findFirst({
            where: { ...ownedTradeFilter, realizedPnl: { not: null } },
            orderBy: [{ realizedPnl: "asc" }, { executedAt: "desc" }],
            select: { symbol: true, realizedPnl: true, realizedPnlPct: true },
          }),
        ]);

      return {
        totalTrades: totals._count,
        winningTrades,
        losingTrades,
        winRate: computeWinRate(winningTrades, losingTrades),
        totalVolume: toDecimalString(totals._sum.totalValue) ?? "0",
        averageReturn: toDecimalString(totals._avg.realizedPnlPct),
        bestTrade: serializeTradeSummary(bestTrade),
        worstTrade: serializeTradeSummary(worstTrade),
      };
    }

    beforeAll(async () => {
      const userEquiv = {
        name: "Equiv User",
        email: `equiv-user-${Date.now()}@example.com`,
        password: "EquivPassword#2026",
      };
      const regRes = await request(app).post("/api/v1/auth/register").send(userEquiv);
      equivUserId = regRes.body.data.user.id;

      const p1 = await prisma.portfolio.findFirst({
        where: { userId: equivUserId, isDefault: true },
      });
      equivPortfolio1Id = p1.id;

      const p2 = await prisma.portfolio.create({
        data: {
          userId: equivUserId,
          name: "Second Portfolio",
          cashBalance: "50000",
        },
      });
      equivPortfolio2Id = p2.id;

      // Seed diverse trades:
      // 1. AAPL BUY in P1 (executedAt: 2026-01-01) -> null realized values
      const o1 = await prisma.order.create({
        data: {
          portfolioId: equivPortfolio1Id,
          symbol: "AAPL",
          assetType: "STOCK",
          side: "BUY",
          type: "MARKET",
          status: "EXECUTED",
          quantity: "10",
          executedPrice: "150",
        },
      });
      await prisma.trade.create({
        data: {
          portfolioId: equivPortfolio1Id,
          orderId: o1.id,
          symbol: "AAPL",
          assetType: "STOCK",
          side: "BUY",
          quantity: "10",
          price: "150",
          totalValue: "1500",
          executedAt: new Date("2026-01-01T10:00:00.000Z"),
          realizedPnl: null,
          realizedPnlPct: null,
        },
      });

      // 2. AAPL SELL in P1 (executedAt: 2026-01-05) -> win: realizedPnl: 200
      const o2 = await prisma.order.create({
        data: {
          portfolioId: equivPortfolio1Id,
          symbol: "AAPL",
          assetType: "STOCK",
          side: "SELL",
          type: "MARKET",
          status: "EXECUTED",
          quantity: "10",
          executedPrice: "170",
        },
      });
      await prisma.trade.create({
        data: {
          portfolioId: equivPortfolio1Id,
          orderId: o2.id,
          symbol: "AAPL",
          assetType: "STOCK",
          side: "SELL",
          quantity: "10",
          price: "170",
          totalValue: "1700",
          executedAt: new Date("2026-01-05T10:00:00.000Z"),
          realizedPnl: "200",
          realizedPnlPct: "13.33333333",
        },
      });

      // 3. MSFT BUY in P1 (executedAt: 2026-01-10) -> null realized values
      const o3 = await prisma.order.create({
        data: {
          portfolioId: equivPortfolio1Id,
          symbol: "MSFT",
          assetType: "STOCK",
          side: "BUY",
          type: "MARKET",
          status: "EXECUTED",
          quantity: "5",
          executedPrice: "300",
        },
      });
      await prisma.trade.create({
        data: {
          portfolioId: equivPortfolio1Id,
          orderId: o3.id,
          symbol: "MSFT",
          assetType: "STOCK",
          side: "BUY",
          quantity: "5",
          price: "300",
          totalValue: "1500",
          executedAt: new Date("2026-01-10T10:00:00.000Z"),
          realizedPnl: null,
          realizedPnlPct: null,
        },
      });

      // 4. MSFT SELL in P1 (executedAt: 2026-01-12) -> BREAKEVEN: realizedPnl: 0
      const o4 = await prisma.order.create({
        data: {
          portfolioId: equivPortfolio1Id,
          symbol: "MSFT",
          assetType: "STOCK",
          side: "SELL",
          type: "MARKET",
          status: "EXECUTED",
          quantity: "5",
          executedPrice: "300",
        },
      });
      await prisma.trade.create({
        data: {
          portfolioId: equivPortfolio1Id,
          orderId: o4.id,
          symbol: "MSFT",
          assetType: "STOCK",
          side: "SELL",
          quantity: "5",
          price: "300",
          totalValue: "1500",
          executedAt: new Date("2026-01-12T10:00:00.000Z"),
          realizedPnl: "0",
          realizedPnlPct: "0",
        },
      });

      // 5. TSLA SELL in P1 (executedAt: 2026-01-15) -> loss: realizedPnl: -500
      const o5 = await prisma.order.create({
        data: {
          portfolioId: equivPortfolio1Id,
          symbol: "TSLA",
          assetType: "STOCK",
          side: "SELL",
          type: "MARKET",
          status: "EXECUTED",
          quantity: "20",
          executedPrice: "200",
        },
      });
      await prisma.trade.create({
        data: {
          portfolioId: equivPortfolio1Id,
          orderId: o5.id,
          symbol: "TSLA",
          assetType: "STOCK",
          side: "SELL",
          quantity: "20",
          price: "200",
          totalValue: "4000",
          executedAt: new Date("2026-01-15T10:00:00.000Z"),
          realizedPnl: "-500",
          realizedPnlPct: "-11.11111111",
        },
      });

      // 6. NVDA SELL in P2 (executedAt: 2026-01-20) -> tie for win: realizedPnl: 200, but executedAt later than AAPL
      const o6 = await prisma.order.create({
        data: {
          portfolioId: equivPortfolio2Id,
          symbol: "NVDA",
          assetType: "STOCK",
          side: "SELL",
          type: "MARKET",
          status: "EXECUTED",
          quantity: "10",
          executedPrice: "500",
        },
      });
      await prisma.trade.create({
        data: {
          portfolioId: equivPortfolio2Id,
          orderId: o6.id,
          symbol: "NVDA",
          assetType: "STOCK",
          side: "SELL",
          quantity: "10",
          price: "500",
          totalValue: "5000",
          executedAt: new Date("2026-01-20T10:00:00.000Z"),
          realizedPnl: "200",
          realizedPnlPct: "4.16666667",
        },
      });

      // 7. GOOG SELL in P2 (executedAt: 2026-01-25) -> tie for loss: realizedPnl: -500, but executedAt later than TSLA
      const o7 = await prisma.order.create({
        data: {
          portfolioId: equivPortfolio2Id,
          symbol: "GOOG",
          assetType: "STOCK",
          side: "SELL",
          type: "MARKET",
          status: "EXECUTED",
          quantity: "8",
          executedPrice: "100",
        },
      });
      await prisma.trade.create({
        data: {
          portfolioId: equivPortfolio2Id,
          orderId: o7.id,
          symbol: "GOOG",
          assetType: "STOCK",
          side: "SELL",
          quantity: "8",
          price: "100",
          totalValue: "800",
          executedAt: new Date("2026-01-25T10:00:00.000Z"),
          realizedPnl: "-500",
          realizedPnlPct: "-38.46153846",
        },
      });

      // 8. BTCUSDT SELL in P2 with high precision (executedAt: 2026-02-01)
      const o8 = await prisma.order.create({
        data: {
          portfolioId: equivPortfolio2Id,
          symbol: "BTCUSDT",
          assetType: "CRYPTO",
          side: "SELL",
          type: "MARKET",
          status: "EXECUTED",
          quantity: "0.12345678",
          executedPrice: "65432.12345678",
        },
      });
      await prisma.trade.create({
        data: {
          portfolioId: equivPortfolio2Id,
          orderId: o8.id,
          symbol: "BTCUSDT",
          assetType: "CRYPTO",
          side: "SELL",
          quantity: "0.12345678",
          price: "65432.12345678",
          totalValue: "8078.04183061",
          executedAt: new Date("2026-02-01T10:00:00.000Z"),
          realizedPnl: "1234.56789012",
          realizedPnlPct: "18.04183061",
        },
      });
    });

    test("produces exact same statistics as legacy 5-query execution across all trades", async () => {
      const optimized = await getUserStatistics(equivUserId, {}, { prevalidated: true });
      const legacy = await runLegacyFiveQueries(equivUserId, {});

      expect(optimized).toEqual(legacy);
      expect(optimized.totalTrades).toBe(8);
      expect(optimized.winningTrades).toBe(3); // AAPL, NVDA, BTCUSDT
      expect(optimized.losingTrades).toBe(2);  // TSLA, GOOG
      expect(optimized.winRate).toBe(0.6);     // 3 / (3 + 2) = 0.6000 (breakeven excluded)
      expect(optimized.bestTrade).toEqual({
        symbol: "BTCUSDT",
        realizedPnl: "1234.56789012",
        realizedPnlPct: "18.04183061",
      });
      expect(optimized.worstTrade).toEqual({
        symbol: "GOOG",
        realizedPnl: "-500",
        realizedPnlPct: "-38.46153846",
      });
    });

    test("preserves exact tie-breaking when two trades share identical realizedPnl", async () => {
      // Filter to Portfolio 1 where AAPL is +200, MSFT is 0, TSLA is -500
      const optimized = await getUserStatistics(
        equivUserId,
        { portfolioId: equivPortfolio1Id },
        { prevalidated: true },
      );
      const legacy = await runLegacyFiveQueries(equivUserId, {
        portfolioId: equivPortfolio1Id,
      });

      expect(optimized).toEqual(legacy);
      expect(optimized.totalTrades).toBe(5);
      expect(optimized.winningTrades).toBe(1);
      expect(optimized.losingTrades).toBe(1);
      expect(optimized.winRate).toBe(0.5);
      expect(optimized.bestTrade?.symbol).toBe("AAPL");
      expect(optimized.worstTrade?.symbol).toBe("TSLA");
    });

    test("produces exact match when filtered by symbol, side, and date bounds", async () => {
      // 1. Symbol filter
      const optSymbol = await getUserStatistics(
        equivUserId,
        { symbol: "AAPL" },
        { prevalidated: true },
      );
      const legSymbol = await runLegacyFiveQueries(equivUserId, { symbol: "AAPL" });
      expect(optSymbol).toEqual(legSymbol);

      // 2. Side filter (BUY trades only - all realized values are null)
      const optBuy = await getUserStatistics(
        equivUserId,
        { side: "BUY" },
        { prevalidated: true },
      );
      const legBuy = await runLegacyFiveQueries(equivUserId, { side: "BUY" });
      expect(optBuy).toEqual(legBuy);
      expect(optBuy.winningTrades).toBe(0);
      expect(optBuy.losingTrades).toBe(0);
      expect(optBuy.winRate).toBe(0);
      expect(optBuy.averageReturn).toBeNull();
      expect(optBuy.bestTrade).toBeNull();
      expect(optBuy.worstTrade).toBeNull();

      // 3. Date range filter
      const dateFilters = {
        from: new Date("2026-01-02T00:00:00.000Z"),
        to: new Date("2026-01-22T00:00:00.000Z"),
      };
      const optDate = await getUserStatistics(equivUserId, dateFilters, {
        prevalidated: true,
      });
      const legDate = await runLegacyFiveQueries(equivUserId, dateFilters);
      expect(optDate).toEqual(legDate);
    });

    test("produces exact zeroed shape for empty trade history", async () => {
      // User A has 0 trades
      const optEmpty = await getUserStatistics(userAId, {}, { prevalidated: true });
      const legEmpty = await runLegacyFiveQueries(userAId, {});

      expect(optEmpty).toEqual(legEmpty);
      expect(optEmpty).toEqual({
        totalTrades: 0,
        winningTrades: 0,
        losingTrades: 0,
        winRate: 0,
        totalVolume: "0",
        averageReturn: null,
        bestTrade: null,
        worstTrade: null,
      });
    });

    test("asserts optimized path executes single query and bypasses legacy prisma trade methods", async () => {
      const queryRawSpy = jest.spyOn(prisma, "$queryRaw");
      const aggregateSpy = jest.spyOn(prisma.trade, "aggregate");
      const countSpy = jest.spyOn(prisma.trade, "count");
      const findFirstSpy = jest.spyOn(prisma.trade, "findFirst");

      await getUserStatistics(equivUserId, {}, { prevalidated: true });

      expect(queryRawSpy).toHaveBeenCalledTimes(1);
      expect(aggregateSpy).not.toHaveBeenCalled();
      expect(countSpy).not.toHaveBeenCalled();
      expect(findFirstSpy).not.toHaveBeenCalled();

      queryRawSpy.mockRestore();
      aggregateSpy.mockRestore();
      countSpy.mockRestore();
      findFirstSpy.mockRestore();
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await disconnectRedis();
  });
});
