const request = require("supertest");
const { Prisma } = require("@prisma/client");

const app = require("../../src/app");
const prisma = require("../../src/config/database");
const marketDataService = require("../../src/services/marketData");

const timestamp = Date.now();

let userId, userToken, portfolioId;
let createdLeagueIds = [];
let quoteSpy;

beforeAll(async () => {
  jest.setTimeout(30000);

  quoteSpy = jest.spyOn(marketDataService, "getQuote").mockResolvedValue({
    symbol: "AAPL",
    price: "150",
    bid: "149.95",
    ask: "150.05",
  });

  const regRes = await request(app).post("/api/v1/auth/register").send({
    name: "Task47 E2E User",
    email: `task47-e2e-${timestamp}@example.com`,
    password: "Password123!",
  });

  userId = regRes.body.data.user.id;
  userToken = regRes.body.data.accessToken;

  const p = await prisma.portfolio.findFirst({
    where: { userId },
  });
  portfolioId = p.id;
});

afterAll(async () => {
  if (quoteSpy) {
    quoteSpy.mockRestore();
  }

  try {
    for (const leagueId of createdLeagueIds) {
      await prisma.leagueMember.deleteMany({ where: { leagueId } });
      await prisma.league.deleteMany({ where: { id: leagueId } });
    }

    if (userId) {
      await prisma.userAchievement.deleteMany({ where: { userId } });
      await prisma.sentimentVote.deleteMany({ where: { userId } });
      await prisma.notification.deleteMany({ where: { userId } });
      await prisma.trade.deleteMany({ where: { portfolioId } });
      await prisma.orderEvent.deleteMany({
        where: { order: { portfolioId } },
      });
      await prisma.order.deleteMany({ where: { portfolioId } });
      await prisma.portfolio.deleteMany({ where: { userId } });
      await prisma.user.deleteMany({ where: { id: userId } });
    }

    await prisma.notification.deleteMany({
      where: { type: "ACHIEVEMENT_UNLOCKED" },
    });
    await prisma.userAchievement.deleteMany({});
  } catch (err) {
    // best-effort cleanup
  } finally {
    await prisma.$disconnect();
  }
});

describe("Task 47 Cross-Feature End-to-End Integration", () => {
  test("E2E Trading Lifecycle: executes trade, unlocks achievement, and emits notification (#130, #133)", async () => {
    // 1. Place a market order
    const orderRes = await request(app)
      .post("/api/v1/orders")
      .set("Authorization", `Bearer ${userToken}`)
      .send({
        portfolioId,
        symbol: "AAPL",
        assetType: "STOCK",
        side: "BUY",
        type: "MARKET",
        quantity: 1,
      });

    expect(orderRes.status).toBe(201);
    const orderId = orderRes.body.data.order.id;

    // Execute order via tradeService
    const { executeOrder } = require("../../src/services/tradeService");
    await executeOrder(orderId, 150);

    // 2. Check achievement unlocked
    const achieveRes = await request(app)
      .get("/api/v1/achievements/mine")
      .set("Authorization", `Bearer ${userToken}`);

    expect(achieveRes.status).toBe(200);
    const codes = achieveRes.body.data.achievements.map((a) => a.achievement.code);
    expect(codes).toContain("FIRST_TRADE");

    // 3. Check notifications received
    const notifRes = await request(app)
      .get("/api/v1/notifications")
      .set("Authorization", `Bearer ${userToken}`);

    expect(notifRes.status).toBe(200);
    const types = notifRes.body.data.notifications.map((n) => n.type);
    expect(types).toContain("ACHIEVEMENT_UNLOCKED");
  });

  test("E2E Order Cancellation: cancels pending limit order and emits ORDER_CANCELLED (#133)", async () => {
    const orderRes = await request(app)
      .post("/api/v1/orders")
      .set("Authorization", `Bearer ${userToken}`)
      .send({
        portfolioId,
        symbol: "AAPL",
        assetType: "STOCK",
        side: "BUY",
        type: "LIMIT",
        limitPrice: 50.0,
        quantity: 1,
      });

    expect(orderRes.status).toBe(201);
    const orderId = orderRes.body.data.order.id;

    const cancelRes = await request(app)
      .delete(`/api/v1/orders/${orderId}`)
      .set("Authorization", `Bearer ${userToken}`);

    expect(cancelRes.status).toBe(200);

    const notifRes = await request(app)
      .get("/api/v1/notifications")
      .set("Authorization", `Bearer ${userToken}`);

    expect(notifRes.status).toBe(200);
    const types = notifRes.body.data.notifications.map((n) => n.type);
    expect(types).toContain("ORDER_CANCELLED");
  });

  test("E2E Sentiment Voting: records vote and retrieves aggregation across windows (#134)", async () => {
    const voteRes = await request(app)
      .post("/api/v1/sentiment/TSLA/vote")
      .set("Authorization", `Bearer ${userToken}`)
      .send({ sentiment: "BULLISH" });

    expect(voteRes.status).toBe(200);
    expect(voteRes.body.data.vote.sentiment).toBe("BULLISH");

    const getRes = await request(app)
      .get("/api/v1/sentiment/TSLA?window=24h")
      .set("Authorization", `Bearer ${userToken}`);

    expect(getRes.status).toBe(200);
    expect(getRes.body.data.totalVotes).toBeGreaterThanOrEqual(1);
    expect(getRes.body.data.userVote).toBe("BULLISH");
  });

  test("E2E Competitions: creates league, user joins, and leaderboard reflects returns (#128)", async () => {
    const startDate = new Date(Date.now() + 86400000).toISOString();
    const endDate = new Date(Date.now() + 86400000 * 7).toISOString();

    const leagueRes = await request(app)
      .post("/api/v1/leagues")
      .set("Authorization", `Bearer ${userToken}`)
      .send({
        name: "E2E Challenge",
        startingBalance: 15000,
        startDate,
        endDate,
      });

    expect(leagueRes.status).toBe(201);
    const leagueId = leagueRes.body.data.league.id;
    createdLeagueIds.push(leagueId);

    const joinRes = await request(app)
      .post(`/api/v1/leagues/${leagueId}/join`)
      .set("Authorization", `Bearer ${userToken}`)
      .send({});

    expect(joinRes.status).toBe(200);

    const boardRes = await request(app).get(`/api/v1/leagues/${leagueId}/leaderboard`);

    expect(boardRes.status).toBe(200);
    expect(boardRes.body.data.leaderboard.length).toBe(1);
    expect(boardRes.body.data.leaderboard[0].userId).toBe(userId);
    expect(boardRes.body.data.leaderboard[0].returnPct).toBe(0);
  });
});
