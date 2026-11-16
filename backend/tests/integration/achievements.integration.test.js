const request = require("supertest");

const app = require("../../src/app");
const prisma = require("../../src/config/database");
const {
  reconcileAchievements,
  ensureCatalog,
} = require("../../src/services/achievementService");

const timestamp = Date.now();

let userId;
let userAccessToken;
let portfolioId;

beforeAll(async () => {
  jest.setTimeout(30000);

  const userRes = await request(app).post("/api/v1/auth/register").send({
    name: "Achievement Integration User",
    email: `achievement-user-${timestamp}@example.com`,
    password: "IntegrationTest#2026",
  });

  expect([200, 201]).toContain(userRes.status);
  userId = userRes.body.data.user.id;
  userAccessToken = userRes.body.data.accessToken;

  const portfolio = await prisma.portfolio.findFirst({
    where: { userId },
  });
  portfolioId = portfolio.id;
});

afterAll(async () => {
  if (userId) {
    await prisma.userAchievement.deleteMany({ where: { userId } });
    await prisma.notification.deleteMany({ where: { userId } });
    await prisma.trade.deleteMany({ where: { portfolioId } });
    await prisma.order.deleteMany({ where: { portfolioId } });
    await prisma.portfolio.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  }

  await prisma.$disconnect();
});

describe("Achievements Integration", () => {
  beforeEach(async () => {
    await ensureCatalog();
  });

  test("GET /api/v1/achievements returns full catalog", async () => {
    const res = await request(app).get("/api/v1/achievements");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const codes = res.body.data.achievements.map((a) => a.code);
    expect(codes).toContain("FIRST_TRADE");
    expect(codes).toContain("FIRST_PROFIT");
    expect(codes).toContain("TEN_SUCCESSFUL_TRADES");
    expect(codes).toContain("PORTFOLIO_MILESTONE");
  });

  test("GET /api/v1/achievements/mine returns user achievements", async () => {
    const unauth = await request(app).get("/api/v1/achievements/mine");
    expect(unauth.status).toBe(401);

    const res = await request(app)
      .get("/api/v1/achievements/mine")
      .set("Authorization", `Bearer ${userAccessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data.achievements)).toBe(true);
  });

  test("triggers FIRST_TRADE on first executed trade and creates notification", async () => {
    // Create an order and trade
    const order = await prisma.order.create({
      data: {
        portfolioId,
        symbol: "AAPL",
        assetType: "STOCK",
        side: "BUY",
        type: "MARKET",
        status: "EXECUTED",
        quantity: "1",
        executedPrice: "150",
        executedAt: new Date(),
      },
    });

    const trade = await prisma.trade.create({
      data: {
        orderId: order.id,
        portfolioId,
        symbol: "AAPL",
        assetType: "STOCK",
        side: "BUY",
        quantity: "1",
        price: "150",
        totalValue: "150",
        realizedPnl: "0",
        executedAt: new Date(),
      },
    });

    const { evaluateAndGrantAchievements } = require("../../src/services/achievementService");
    await evaluateAndGrantAchievements(userId, { trade, order });

    const mineRes = await request(app)
      .get("/api/v1/achievements/mine")
      .set("Authorization", `Bearer ${userAccessToken}`);

    expect(mineRes.status).toBe(200);
    const mineCodes = mineRes.body.data.achievements.map((a) => a.achievement.code);
    expect(mineCodes).toContain("FIRST_TRADE");

    // Notification created
    const notification = await prisma.notification.findFirst({
      where: {
        userId,
        type: "ACHIEVEMENT_UNLOCKED",
        data: {
          path: ["code"],
          equals: "FIRST_TRADE",
        },
      },
    });
    expect(notification).not.toBeNull();
    expect(notification.title).toBe("Achievement unlocked");
  });

  test("triggers FIRST_PROFIT on trade with realizedPnl > 0", async () => {
    const order = await prisma.order.create({
      data: {
        portfolioId,
        symbol: "AAPL",
        assetType: "STOCK",
        side: "SELL",
        type: "MARKET",
        status: "EXECUTED",
        quantity: "1",
        executedPrice: "200",
        executedAt: new Date(),
      },
    });

    const trade = await prisma.trade.create({
      data: {
        orderId: order.id,
        portfolioId,
        symbol: "AAPL",
        assetType: "STOCK",
        side: "SELL",
        quantity: "1",
        price: "200",
        totalValue: "200",
        realizedPnl: "50",
        executedAt: new Date(),
      },
    });

    const { evaluateAndGrantAchievements } = require("../../src/services/achievementService");
    await evaluateAndGrantAchievements(userId, { trade, order });

    const mineRes = await request(app)
      .get("/api/v1/achievements/mine")
      .set("Authorization", `Bearer ${userAccessToken}`);

    const mineCodes = mineRes.body.data.achievements.map((a) => a.achievement.code);
    expect(mineCodes).toContain("FIRST_PROFIT");
  });

  test("triggers PORTFOLIO_MILESTONE when portfolio totalValue reaches 2x starting balance", async () => {
    // Current startingBalance is 10000. Set cashBalance to 20000 (2x)
    await prisma.portfolio.update({
      where: { id: portfolioId },
      data: { cashBalance: "20500" },
    });

    const { evaluateAndGrantAchievements } = require("../../src/services/achievementService");
    await evaluateAndGrantAchievements(userId);

    const mineRes = await request(app)
      .get("/api/v1/achievements/mine")
      .set("Authorization", `Bearer ${userAccessToken}`);

    const mineCodes = mineRes.body.data.achievements.map((a) => a.achievement.code);
    expect(mineCodes).toContain("PORTFOLIO_MILESTONE");
  });

  test("durable reconciliation recovers ungranted achievements idempotently", async () => {
    // Add 9 more profitable trades (total >= 10 profitable trades)
    for (let i = 1; i <= 9; i++) {
      const order = await prisma.order.create({
        data: {
          portfolioId,
          symbol: "AAPL",
          assetType: "STOCK",
          side: "SELL",
          type: "MARKET",
          status: "EXECUTED",
          quantity: "1",
          executedPrice: "200",
          executedAt: new Date(),
        },
      });

      await prisma.trade.create({
        data: {
          orderId: order.id,
          portfolioId,
          symbol: "AAPL",
          assetType: "STOCK",
          side: "SELL",
          quantity: "1",
          price: "200",
          totalValue: "200",
          realizedPnl: "10",
          executedAt: new Date(),
        },
      });
    }

    // Run reconciliation job
    const summary = await reconcileAchievements();
    expect(summary.usersChecked).toBeGreaterThanOrEqual(1);

    const mineRes = await request(app)
      .get("/api/v1/achievements/mine")
      .set("Authorization", `Bearer ${userAccessToken}`);

    const mineCodes = mineRes.body.data.achievements.map((a) => a.achievement.code);
    expect(mineCodes).toContain("TEN_SUCCESSFUL_TRADES");

    // Second reconciliation run is a clean idempotent no-op
    const secondSummary = await reconcileAchievements();
    expect(secondSummary.newlyGranted).toBe(0);
  });
});
