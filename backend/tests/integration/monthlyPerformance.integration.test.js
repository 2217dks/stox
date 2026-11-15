const request = require("supertest");
const app = require("../../src/app");
const prisma = require("../../src/config/database");

describe("Monthly Performance & Statistics Integration Tests", () => {
  const timestamp = Date.now();

  const userA = {
    name: "Monthly User A",
    email: `monthly-user-a-${timestamp}@example.com`,
    password: "MonthlyPass#2026",
  };

  const userB = {
    name: "Monthly User B",
    email: `monthly-user-b-${timestamp}@example.com`,
    password: "MonthlyPass#2026",
  };

  let userAId;
  let userBId;
  let tokenA;
  let tokenB;
  let portfolioAId;
  let portfolioBId;

  beforeAll(async () => {
    // 1. Register users
    const resA = await request(app).post("/api/v1/auth/register").send(userA);
    expect([200, 201]).toContain(resA.status);
    userAId = resA.body.data.user.id;
    tokenA = resA.body.data.accessToken;

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

    // 2. Seed PerformanceSnapshots for User A: Jan and Feb 2026
    await prisma.performanceSnapshot.createMany({
      data: [
        {
          portfolioId: portfolioAId,
          snapshotDate: new Date("2026-01-05T00:00:00.000Z"),
          totalValue: "10000",
          cashBalance: "10000",
          holdingsValue: "0",
          dailyPnl: "0",
          dailyPnlPct: "0",
        },
        {
          portfolioId: portfolioAId,
          snapshotDate: new Date("2026-01-31T00:00:00.000Z"),
          totalValue: "10500",
          cashBalance: "10000",
          holdingsValue: "500",
          dailyPnl: "500",
          dailyPnlPct: "5.0",
        },
        {
          portfolioId: portfolioAId,
          snapshotDate: new Date("2026-02-15T00:00:00.000Z"),
          totalValue: "10800",
          cashBalance: "10000",
          holdingsValue: "800",
          dailyPnl: "300",
          dailyPnlPct: "2.85",
        },
        {
          portfolioId: portfolioAId,
          snapshotDate: new Date("2026-02-28T00:00:00.000Z"),
          totalValue: "11000",
          cashBalance: "10000",
          holdingsValue: "1000",
          dailyPnl: "200",
          dailyPnlPct: "1.85",
        },
      ],
    });

    // 3. Seed Orders & Trades for User A
    const orderA1 = await prisma.order.create({
      data: {
        portfolioId: portfolioAId,
        symbol: "AAPL",
        assetType: "STOCK",
        side: "SELL",
        type: "MARKET",
        status: "EXECUTED",
        quantity: "10",
        executedPrice: "150",
        executedAt: new Date("2026-01-15T10:00:00.000Z"),
      },
    });

    await prisma.trade.create({
      data: {
        portfolioId: portfolioAId,
        orderId: orderA1.id,
        symbol: "AAPL",
        assetType: "STOCK",
        side: "SELL",
        quantity: "10",
        price: "150",
        totalValue: "1500",
        fees: "0",
        realizedPnl: "200",
        realizedPnlPct: "15.38",
        executedAt: new Date("2026-01-15T10:00:00.000Z"),
      },
    });

    const orderA2 = await prisma.order.create({
      data: {
        portfolioId: portfolioAId,
        symbol: "MSFT",
        assetType: "STOCK",
        side: "SELL",
        type: "MARKET",
        status: "EXECUTED",
        quantity: "5",
        executedPrice: "200",
        executedAt: new Date("2026-02-10T10:00:00.000Z"),
      },
    });

    await prisma.trade.create({
      data: {
        portfolioId: portfolioAId,
        orderId: orderA2.id,
        symbol: "MSFT",
        assetType: "STOCK",
        side: "SELL",
        quantity: "5",
        price: "200",
        totalValue: "1000",
        fees: "0",
        realizedPnl: "300",
        realizedPnlPct: "42.85",
        executedAt: new Date("2026-02-10T10:00:00.000Z"),
      },
    });
  });

  afterAll(async () => {
    // Cleanup created test data
    if (userAId || userBId) {
      await prisma.user.deleteMany({
        where: { id: { in: [userAId, userBId].filter(Boolean) } },
      });
    }

    await prisma.$disconnect();
  });

  describe("Portfolio Monthly Performance API", () => {
    test("rejects unauthenticated requests with 401 UNAUTHORIZED", async () => {
      const res = await request(app).get(
        `/api/v1/portfolios/${portfolioAId}/analytics/monthly-performance`,
      );
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("UNAUTHORIZED");
    });

    test("enforces portfolio ownership with 404 PORTFOLIO_NOT_FOUND", async () => {
      const res = await request(app)
        .get(`/api/v1/portfolios/${portfolioAId}/analytics/monthly-performance`)
        .set("Authorization", `Bearer ${tokenB}`);
      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("PORTFOLIO_NOT_FOUND");
    });

    test("returns aggregated monthly performance for portfolio owner", async () => {
      const res = await request(app)
        .get(`/api/v1/portfolios/${portfolioAId}/analytics/monthly-performance`)
        .set("Authorization", `Bearer ${tokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.portfolioId).toBe(portfolioAId);
      expect(Array.isArray(res.body.data.months)).toBe(true);
      expect(res.body.data.months).toHaveLength(2);

      const jan = res.body.data.months[0];
      expect(jan.month).toBe("2026-01");
      expect(jan.startValue).toBe("10000");
      expect(jan.endValue).toBe("10500");
      expect(jan.netPnl).toBe("500");
      expect(jan.returnPct).toBe("5.0000");
      expect(jan.realizedPnl).toBe("200");
      expect(jan.unrealizedPnl).toBe("300");
      expect(jan.snapshotCount).toBe(2);

      const feb = res.body.data.months[1];
      expect(feb.month).toBe("2026-02");
      expect(feb.startValue).toBe("10500");
      expect(feb.endValue).toBe("11000");
      expect(feb.netPnl).toBe("500");
      expect(feb.returnPct).toBe("4.7619");
      expect(feb.realizedPnl).toBe("300");
      expect(feb.unrealizedPnl).toBe("200");
      expect(feb.snapshotCount).toBe(2);
    });

    test("supports direct route /:portfolioId/monthly-performance", async () => {
      const res = await request(app)
        .get(`/api/v1/portfolios/${portfolioAId}/monthly-performance`)
        .set("Authorization", `Bearer ${tokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.months).toHaveLength(2);
    });

    test("filters monthly performance by year", async () => {
      const res2026 = await request(app)
        .get(`/api/v1/portfolios/${portfolioAId}/analytics/monthly-performance?year=2026`)
        .set("Authorization", `Bearer ${tokenA}`);
      expect(res2026.status).toBe(200);
      expect(res2026.body.data.months).toHaveLength(2);

      const res2025 = await request(app)
        .get(`/api/v1/portfolios/${portfolioAId}/analytics/monthly-performance?year=2025`)
        .set("Authorization", `Bearer ${tokenA}`);
      expect(res2025.status).toBe(200);
      expect(res2025.body.data.months).toHaveLength(0);
    });

    test("rejects invalid date range when 'from' >= 'to'", async () => {
      const res = await request(app)
        .get(`/api/v1/portfolios/${portfolioAId}/analytics/monthly-performance?from=2026-02-15T00:00:00Z&to=2026-01-01T00:00:00Z`)
        .set("Authorization", `Bearer ${tokenA}`);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    });
  });

  describe("User Monthly Trade Statistics API", () => {
    test("rejects unauthenticated requests to /me/statistics/monthly with 401", async () => {
      const res = await request(app).get("/api/v1/users/me/statistics/monthly");
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    test("returns user monthly trade breakdown for authenticated user", async () => {
      const res = await request(app)
        .get("/api/v1/users/me/statistics/monthly")
        .set("Authorization", `Bearer ${tokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data.monthly)).toBe(true);
      expect(res.body.data.monthly).toHaveLength(2);

      const [jan, feb] = res.body.data.monthly;
      expect(jan.month).toBe("2026-01");
      expect(jan.totalTrades).toBe(1);
      expect(jan.winningTrades).toBe(1);
      expect(jan.winRate).toBe(1);
      expect(jan.totalVolume).toBe("1500");
      expect(jan.realizedPnl).toBe("200");

      expect(feb.month).toBe("2026-02");
      expect(feb.totalTrades).toBe(1);
      expect(feb.winningTrades).toBe(1);
      expect(feb.winRate).toBe(1);
      expect(feb.totalVolume).toBe("1000");
      expect(feb.realizedPnl).toBe("300");
    });

    test("supports includeMonthly=true on /me/statistics", async () => {
      const res = await request(app)
        .get("/api/v1/users/me/statistics?includeMonthly=true")
        .set("Authorization", `Bearer ${tokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.statistics).toHaveProperty("totalTrades", 2);
      expect(res.body.data.statistics).toHaveProperty("winningTrades", 2);
      expect(res.body.data.statistics).toHaveProperty("monthly");
      expect(res.body.data.statistics.monthly).toHaveLength(2);
    });

    test("isolates user trade statistics: User B sees empty monthly stats", async () => {
      const res = await request(app)
        .get("/api/v1/users/me/statistics/monthly")
        .set("Authorization", `Bearer ${tokenB}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.monthly).toHaveLength(0);
    });
  });
});
