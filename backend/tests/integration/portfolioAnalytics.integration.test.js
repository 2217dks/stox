const request = require("supertest");
const app = require("../../src/app");
const prisma = require("../../src/config/database");
const marketData = require("../../src/services/marketData");

describe("Portfolio Analytics Integration Tests", () => {
  const timestamp = Date.now();

  const userA = {
    name: "Analytics User A",
    email: `analytics-user-a-${timestamp}@example.com`,
    password: "AnalyticsPass#2026",
  };

  const userB = {
    name: "Analytics User B",
    email: `analytics-user-b-${timestamp}@example.com`,
    password: "AnalyticsPass#2026",
  };

  let userAId;
  let userBId;
  let tokenA;
  let tokenB;
  let portfolioAId;
  let portfolioBId;

  let getQuoteSpy;
  let getHistoricalPricesSpy;

  beforeAll(async () => {
    jest.setTimeout(20000);

    // Register User A
    const resA = await request(app)
      .post("/api/v1/auth/register")
      .send(userA);
    expect([200, 201]).toContain(resA.status);
    userAId = resA.body.data.user.id;
    tokenA = resA.body.data.accessToken;

    // Register User B
    const resB = await request(app)
      .post("/api/v1/auth/register")
      .send(userB);
    expect([200, 201]).toContain(resB.status);
    userBId = resB.body.data.user.id;
    tokenB = resB.body.data.accessToken;

    // Get portfolios
    const portA = await prisma.portfolio.findFirst({
      where: { userId: userAId, isDefault: true },
    });
    const portB = await prisma.portfolio.findFirst({
      where: { userId: userBId, isDefault: true },
    });
    portfolioAId = portA.id;
    portfolioBId = portB.id;

    // Seed historical snapshots for Portfolio A
    await prisma.performanceSnapshot.createMany({
      data: [
        {
          portfolioId: portfolioAId,
          snapshotDate: new Date("2026-11-01T00:00:00.000Z"),
          totalValue: "10000.00000000",
          cashBalance: "10000.00000000",
          holdingsValue: "0.00000000",
          dailyPnl: "0.00000000",
          dailyPnlPct: "0.0000",
        },
        {
          portfolioId: portfolioAId,
          snapshotDate: new Date("2026-11-02T00:00:00.000Z"),
          totalValue: "10200.00000000",
          cashBalance: "10000.00000000",
          holdingsValue: "200.00000000",
          dailyPnl: "200.00000000",
          dailyPnlPct: "0.0200",
        },
        {
          portfolioId: portfolioAId,
          snapshotDate: new Date("2026-11-03T00:00:00.000Z"),
          totalValue: "10100.00000000",
          cashBalance: "10000.00000000",
          holdingsValue: "100.00000000",
          dailyPnl: "-100.00000000",
          dailyPnlPct: "-0.0098",
        },
        {
          portfolioId: portfolioAId,
          snapshotDate: new Date("2026-11-04T00:00:00.000Z"),
          totalValue: "10500.00000000",
          cashBalance: "10000.00000000",
          holdingsValue: "500.00000000",
          dailyPnl: "400.00000000",
          dailyPnlPct: "0.0396",
        },
      ],
    });

    // Mock market data quotes & historical prices
    getQuoteSpy = jest.spyOn(marketData, "getQuote").mockResolvedValue({
      symbol: "AAPL",
      price: "150.00",
      timestamp: Date.now(),
    });

    getHistoricalPricesSpy = jest.spyOn(marketData, "getHistoricalPrices").mockResolvedValue({
      assetClass: "STOCK",
      interval: "1d",
      prices: [
        {
          timestamp: new Date("2026-11-01T00:00:00.000Z").getTime(),
          open: "500",
          high: "505",
          low: "498",
          close: "500",
          volume: "1000000",
        },
        {
          timestamp: new Date("2026-11-02T00:00:00.000Z").getTime(),
          open: "500",
          high: "512",
          low: "499",
          close: "510",
          volume: "1200000",
        },
        {
          timestamp: new Date("2026-11-03T00:00:00.000Z").getTime(),
          open: "510",
          high: "511",
          low: "502",
          close: "505",
          volume: "950000",
        },
        {
          timestamp: new Date("2026-11-04T00:00:00.000Z").getTime(),
          open: "505",
          high: "525",
          low: "504",
          close: "520",
          volume: "1100000",
        },
      ],
    });
  });

  afterAll(async () => {
    if (getQuoteSpy) getQuoteSpy.mockRestore();
    if (getHistoricalPricesSpy) getHistoricalPricesSpy.mockRestore();

    await prisma.user.deleteMany({
      where: {
        id: { in: [userAId, userBId].filter(Boolean) },
      },
    });

    await prisma.$disconnect();
  });

  describe("Authentication checks", () => {
    test("rejects unauthenticated requests to heatmap with 401", async () => {
      const res = await request(app).get(`/api/v1/portfolios/${portfolioAId}/pnl-heatmap`);
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("UNAUTHORIZED");
    });

    test("rejects unauthenticated requests to risk-metrics with 401", async () => {
      const res = await request(app).get(`/api/v1/portfolios/${portfolioAId}/risk-metrics`);
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("UNAUTHORIZED");
    });

    test("rejects unauthenticated requests to benchmark with 401", async () => {
      const res = await request(app).get(`/api/v1/portfolios/${portfolioAId}/benchmark`);
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    test("rejects unauthenticated requests to benchmark-comparison with 401", async () => {
      const res = await request(app).get(`/api/v1/portfolios/${portfolioAId}/benchmark-comparison`);
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });
  });

  describe("Authorization & ownership checks", () => {
    test("returns 404 PORTFOLIO_NOT_FOUND when accessing another user's portfolio", async () => {
      const res = await request(app)
        .get(`/api/v1/portfolios/${portfolioAId}/pnl-heatmap`)
        .set("Authorization", `Bearer ${tokenB}`);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("PORTFOLIO_NOT_FOUND");
    });

    test("returns 404 PORTFOLIO_NOT_FOUND when portfolio does not exist", async () => {
      const nonexistentId = "00000000-0000-4000-8000-000000000000";
      const res = await request(app)
        .get(`/api/v1/portfolios/${nonexistentId}/risk-metrics`)
        .set("Authorization", `Bearer ${tokenA}`);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("PORTFOLIO_NOT_FOUND");
    });
  });

  describe("Input validation checks", () => {
    test("returns 400 VALIDATION_ERROR on invalid portfolio UUID", async () => {
      const res = await request(app)
        .get("/api/v1/portfolios/invalid-uuid/pnl-heatmap")
        .set("Authorization", `Bearer ${tokenA}`);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    });

    test("returns 400 VALIDATION_ERROR on invalid period query param", async () => {
      const res = await request(app)
        .get(`/api/v1/portfolios/${portfolioAId}/pnl-heatmap?period=INVALID_PERIOD`)
        .set("Authorization", `Bearer ${tokenA}`);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    });

    test("returns 400 VALIDATION_ERROR on invalid riskFreeRate", async () => {
      const res = await request(app)
        .get(`/api/v1/portfolios/${portfolioAId}/risk-metrics?riskFreeRate=-0.05`)
        .set("Authorization", `Bearer ${tokenA}`);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    });
  });

  describe("Successful operations", () => {
    test("GET /:portfolioId/pnl-heatmap returns daily records and summary", async () => {
      const res = await request(app)
        .get(`/api/v1/portfolios/${portfolioAId}/pnl-heatmap?period=ALL`)
        .set("Authorization", `Bearer ${tokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.portfolioId).toBe(portfolioAId);
      expect(res.body.data.period).toBe("ALL");
      expect(Array.isArray(res.body.data.heatmap)).toBe(true);
      expect(res.body.data.heatmap.length).toBeGreaterThanOrEqual(4);
      expect(res.body.data.summary).toHaveProperty("totalPnl");
      expect(res.body.data.summary).toHaveProperty("winDays");
      expect(res.body.data.summary).toHaveProperty("lossDays");
      expect(res.body.data.summary).toHaveProperty("flatDays");
    });

    test("GET /:portfolioId/risk-metrics returns full metrics suite", async () => {
      const res = await request(app)
        .get(`/api/v1/portfolios/${portfolioAId}/risk-metrics?period=ALL&riskFreeRate=0.02`)
        .set("Authorization", `Bearer ${tokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.portfolioId).toBe(portfolioAId);
      expect(res.body.data.metrics).toHaveProperty("annualizedVolatility");
      expect(res.body.data.metrics).toHaveProperty("maxDrawdown");
      expect(res.body.data.metrics).toHaveProperty("currentDrawdown");
      expect(res.body.data.metrics).toHaveProperty("peakValue");
      expect(res.body.data.metrics).toHaveProperty("peakDate");
      expect(res.body.data.metrics).toHaveProperty("sharpeRatio");
      expect(res.body.data.metrics).toHaveProperty("observationCount");
      expect(res.body.data.metrics.observationCount).toBeGreaterThanOrEqual(4);
    });

    test("GET /:portfolioId/benchmark returns historical prices and returns", async () => {
      const res = await request(app)
        .get(`/api/v1/portfolios/${portfolioAId}/benchmark?symbol=SPY&period=1M`)
        .set("Authorization", `Bearer ${tokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.benchmark).toBe("SPY");
      expect(Array.isArray(res.body.data.prices)).toBe(true);
      expect(res.body.data.prices[0]).toHaveProperty("date");
      expect(res.body.data.prices[0]).toHaveProperty("price");
      expect(res.body.data.prices[0]).toHaveProperty("dailyReturn");
    });

    test("GET /:portfolioId/benchmark-comparison returns aligned comparison and alpha/beta", async () => {
      const res = await request(app)
        .get(`/api/v1/portfolios/${portfolioAId}/benchmark-comparison?symbol=SPY&period=ALL`)
        .set("Authorization", `Bearer ${tokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.benchmark).toBe("SPY");
      expect(res.body.data.summary).toHaveProperty("portfolioReturn");
      expect(res.body.data.summary).toHaveProperty("benchmarkReturn");
      expect(res.body.data.summary).toHaveProperty("alpha");
      expect(res.body.data.summary).toHaveProperty("beta");
      expect(res.body.data.summary).toHaveProperty("correlation");
      expect(Array.isArray(res.body.data.comparison)).toBe(true);
    });
  });

  describe("Provider error handling", () => {
    test("propagates provider failures gracefully when market data fails", async () => {
      getHistoricalPricesSpy.mockRejectedValueOnce({
        statusCode: 503,
        code: "MARKET_DATA_PROVIDER_UNAVAILABLE",
        message: "Market data provider is currently unavailable.",
      });

      const res = await request(app)
        .get(`/api/v1/portfolios/${portfolioAId}/benchmark?symbol=SPY&period=1M`)
        .set("Authorization", `Bearer ${tokenA}`);

      expect(res.status).toBe(503);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("MARKET_DATA_PROVIDER_UNAVAILABLE");
    });
  });
});

