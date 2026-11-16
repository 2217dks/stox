const request = require("supertest");
const { Prisma } = require("@prisma/client");

const app = require("../../src/app");
const prisma = require("../../src/config/database");
const marketDataService = require("../../src/services/marketData");
const {
  getLeagueLeaderboard,
  joinLeague,
} = require("../../src/services/competitionService");

const timestamp = Date.now();

let user1Id, user1Token;
let user2Id, user2Token;
let user3Id, user3Token;
let suspendedUserId, suspendedUserToken;
let createdLeagueIds = [];
let quoteSpy;

async function createTestTrade({
  portfolioId,
  symbol,
  side,
  quantity,
  price,
  totalValue,
  realizedPnl = null,
  executedAt,
}) {
  const order = await prisma.order.create({
    data: {
      portfolioId,
      symbol,
      assetType: "STOCK",
      side,
      type: "MARKET",
      quantity,
      status: "EXECUTED",
      executedPrice: price,
      executedAt,
    },
  });

  return prisma.trade.create({
    data: {
      orderId: order.id,
      portfolioId,
      symbol,
      assetType: "STOCK",
      side,
      quantity,
      price,
      totalValue,
      realizedPnl,
      executedAt,
    },
  });
}

beforeAll(async () => {
  jest.setTimeout(30000);

  quoteSpy = jest.spyOn(marketDataService, "getQuote").mockResolvedValue({
    symbol: "AAPL",
    price: 150,
    timestamp: new Date().toISOString(),
  });

  // User 1
  const u1 = await request(app).post("/api/v1/auth/register").send({
    name: "League User 1",
    email: `league-u1-${timestamp}@example.com`,
    password: "Password123!",
  });
  user1Id = u1.body.data.user.id;
  user1Token = u1.body.data.accessToken;

  // User 2
  const u2 = await request(app).post("/api/v1/auth/register").send({
    name: "League User 2",
    email: `league-u2-${timestamp}@example.com`,
    password: "Password123!",
  });
  user2Id = u2.body.data.user.id;
  user2Token = u2.body.data.accessToken;

  // User 3
  const u3 = await request(app).post("/api/v1/auth/register").send({
    name: "League User 3",
    email: `league-u3-${timestamp}@example.com`,
    password: "Password123!",
  });
  user3Id = u3.body.data.user.id;
  user3Token = u3.body.data.accessToken;

  // Suspended User
  const uSusp = await request(app).post("/api/v1/auth/register").send({
    name: "League Suspended User",
    email: `league-susp-${timestamp}@example.com`,
    password: "Password123!",
  });
  suspendedUserId = uSusp.body.data.user.id;
  suspendedUserToken = uSusp.body.data.accessToken;

  await prisma.user.update({
    where: { id: suspendedUserId },
    data: { isSuspended: true },
  });
});

afterAll(async () => {
  if (quoteSpy) {
    quoteSpy.mockRestore();
  }
  try {
    for (const leagueId of createdLeagueIds) {
      const members = await prisma.leagueMember.findMany({
        where: { leagueId },
        select: { portfolioId: true },
      });
      const pIds = members.map((m) => m.portfolioId);
      await prisma.leagueMember.deleteMany({ where: { leagueId } });
      await prisma.league.deleteMany({ where: { id: leagueId } });
      if (pIds.length > 0) {
        await prisma.trade.deleteMany({ where: { portfolioId: { in: pIds } } });
        await prisma.order.deleteMany({ where: { portfolioId: { in: pIds } } });
        await prisma.holding.deleteMany({ where: { portfolioId: { in: pIds } } });
        await prisma.portfolio.deleteMany({ where: { id: { in: pIds } } });
      }
    }

    const testUserIds = [user1Id, user2Id, user3Id, suspendedUserId].filter(Boolean);
    if (testUserIds.length > 0) {
      await prisma.leagueMember.deleteMany({ where: { userId: { in: testUserIds } } });
      const portfolios = await prisma.portfolio.findMany({
        where: { userId: { in: testUserIds } },
        select: { id: true },
      });
      const pIds = portfolios.map((p) => p.id);
      if (pIds.length > 0) {
        await prisma.trade.deleteMany({ where: { portfolioId: { in: pIds } } });
        await prisma.order.deleteMany({ where: { portfolioId: { in: pIds } } });
        await prisma.holding.deleteMany({ where: { portfolioId: { in: pIds } } });
        await prisma.portfolio.deleteMany({ where: { id: { in: pIds } } });
      }
      await prisma.user.deleteMany({ where: { id: { in: testUserIds } } });
    }
  } catch (err) {
    // cleanup best effort
  } finally {
    await prisma.$disconnect();
  }
});

describe("Leagues & Competitions Integration (#128)", () => {
  let activeLeagueId;
  let upcomingLeagueId;

  test("POST /api/v1/leagues creates a new league", async () => {
    const startDate = new Date(Date.now() + 86400000).toISOString();
    const endDate = new Date(Date.now() + 86400000 * 7).toISOString();

    const res = await request(app)
      .post("/api/v1/leagues")
      .set("Authorization", `Bearer ${user1Token}`)
      .send({
        name: "Spring Championship",
        description: "Official spring trading league",
        startingBalance: 20000,
        startDate,
        endDate,
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.league.name).toBe("Spring Championship");
    expect(Number(res.body.data.league.startingBalance)).toBe(20000);
    expect(res.body.data.league.status).toBe("UPCOMING");

    upcomingLeagueId = res.body.data.league.id;
    createdLeagueIds.push(upcomingLeagueId);
  });

  test("GET /api/v1/leagues lists leagues with pagination", async () => {
    const res = await request(app).get("/api/v1/leagues?page=1&limit=10");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.pagination).toBeDefined();
    expect(res.body.pagination.page).toBe(1);
  });

  test("POST /api/v1/leagues/:id/join allows joining an upcoming league", async () => {
    const res = await request(app)
      .post(`/api/v1/leagues/${upcomingLeagueId}/join`)
      .set("Authorization", `Bearer ${user1Token}`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.member.leagueId).toBe(upcomingLeagueId);
    expect(res.body.data.member.userId).toBe(user1Id);
    expect(res.body.data.member.portfolioId).toBeDefined();
  });

  test("POST /api/v1/leagues/:id/join rejects duplicate join with 409", async () => {
    const res = await request(app)
      .post(`/api/v1/leagues/${upcomingLeagueId}/join`)
      .set("Authorization", `Bearer ${user1Token}`)
      .send({});

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("ALREADY_JOINED");
  });

  test("POST /api/v1/leagues/:id/join rejects late join when now >= startDate", async () => {
    // Create a league that started yesterday
    const pastStart = new Date(Date.now() - 86400000);
    const futureEnd = new Date(Date.now() + 86400000 * 5);

    const league = await prisma.league.create({
      data: {
        name: "Started League",
        startingBalance: 10000,
        startDate: pastStart,
        endDate: futureEnd,
        status: "ACTIVE",
      },
    });
    createdLeagueIds.push(league.id);

    const res = await request(app)
      .post(`/api/v1/leagues/${league.id}/join`)
      .set("Authorization", `Bearer ${user2Token}`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("LEAGUE_ALREADY_STARTED");
  });

  test("POST /api/v1/leagues/:id/join rejects custom or existing portfolioId with 400", async () => {
    const p = await prisma.portfolio.create({
      data: {
        userId: user2Id,
        name: "User2 Existing Portfolio",
        startingBalance: 10000,
        cashBalance: 10000,
        reservedCash: 0,
      },
    });

    const res = await request(app)
      .post(`/api/v1/leagues/${upcomingLeagueId}/join`)
      .set("Authorization", `Bearer ${user2Token}`)
      .send({ portfolioId: p.id });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("EXISTING_PORTFOLIO_NOT_ALLOWED");

    await prisma.portfolio.delete({ where: { id: p.id } });
  });

  test("POST /api/v1/leagues/:id/join allocates dedicated portfolio with exact league startingBalance", async () => {
    const res = await request(app)
      .post(`/api/v1/leagues/${upcomingLeagueId}/join`)
      .set("Authorization", `Bearer ${user2Token}`)
      .send({});

    expect(res.status).toBe(200);
    const member = res.body.data.member;
    expect(member.portfolioId).toBeDefined();

    const allocatedPortfolio = await prisma.portfolio.findUnique({
      where: { id: member.portfolioId },
    });
    expect(Number(allocatedPortfolio.startingBalance)).toBe(20000);
    expect(Number(allocatedPortfolio.cashBalance)).toBe(20000);
    expect(Number(allocatedPortfolio.reservedCash)).toBe(0);
  });

  test("POST /api/v1/orders rejects order execution on league portfolio before startDate", async () => {
    const member = await prisma.leagueMember.findUnique({
      where: {
        leagueId_userId: {
          leagueId: upcomingLeagueId,
          userId: user2Id,
        },
      },
    });

    const res = await request(app)
      .post("/api/v1/orders")
      .set("Authorization", `Bearer ${user2Token}`)
      .send({
        portfolioId: member.portfolioId,
        symbol: "AAPL",
        assetType: "STOCK",
        side: "BUY",
        type: "MARKET",
        quantity: "1",
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("LEAGUE_NOT_ACTIVE");
  });

  test("POST /api/v1/leagues/:id/join handles concurrent joins from same user without orphan portfolios", async () => {
    const startDate = new Date(Date.now() + 86400000).toISOString();
    const endDate = new Date(Date.now() + 86400000 * 7).toISOString();

    const league = await prisma.league.create({
      data: {
        name: "Concurrent Join League",
        startingBalance: 10000,
        startDate,
        endDate,
        status: "UPCOMING",
      },
    });
    createdLeagueIds.push(league.id);

    const initialPortfolios = await prisma.portfolio.count({
      where: { userId: user3Id },
    });

    const [res1, res2] = await Promise.all([
      request(app)
        .post(`/api/v1/leagues/${league.id}/join`)
        .set("Authorization", `Bearer ${user3Token}`)
        .send({}),
      request(app)
        .post(`/api/v1/leagues/${league.id}/join`)
        .set("Authorization", `Bearer ${user3Token}`)
        .send({}),
    ]);

    const statuses = [res1.status, res2.status].sort();
    expect(statuses).toEqual([200, 409]);

    const finalPortfolios = await prisma.portfolio.count({
      where: { userId: user3Id },
    });
    expect(finalPortfolios - initialPortfolios).toBe(1);

    const membersCount = await prisma.leagueMember.count({
      where: { leagueId: league.id },
    });
    expect(membersCount).toBe(1);
  });

  test("POST /api/v1/leagues/:id/join enforces capacity atomically when only one slot remains", async () => {
    const startDate = new Date(Date.now() + 86400000).toISOString();
    const endDate = new Date(Date.now() + 86400000 * 7).toISOString();

    const league = await prisma.league.create({
      data: {
        name: "Capacity 1 League",
        startingBalance: 10000,
        maxParticipants: 1,
        startDate,
        endDate,
        status: "UPCOMING",
      },
    });
    createdLeagueIds.push(league.id);

    const [res1, res2] = await Promise.all([
      request(app)
        .post(`/api/v1/leagues/${league.id}/join`)
        .set("Authorization", `Bearer ${user1Token}`)
        .send({}),
      request(app)
        .post(`/api/v1/leagues/${league.id}/join`)
        .set("Authorization", `Bearer ${user2Token}`)
        .send({}),
    ]);

    const statuses = [res1.status, res2.status].sort();
    expect(statuses).toEqual([200, 400]);

    const codes = [res1.body?.error?.code, res2.body?.error?.code].filter(Boolean);
    expect(codes).toContain("LEAGUE_FULL");

    const memberCount = await prisma.leagueMember.count({
      where: { leagueId: league.id },
    });
    expect(memberCount).toBe(1);
  });

  test("POST /api/v1/orders rejects order execution on league portfolio after endDate", async () => {
    const startDate = new Date(Date.now() - 10 * 86400000);
    const endDate = new Date(Date.now() - 86400000);

    const league = await prisma.league.create({
      data: {
        name: "Ended League For Orders",
        startingBalance: 10000,
        startDate,
        endDate,
        status: "COMPLETED",
      },
    });
    createdLeagueIds.push(league.id);

    const p = await prisma.portfolio.create({
      data: {
        userId: user1Id,
        name: "Ended-P",
        startingBalance: 10000,
        cashBalance: 10000,
        reservedCash: 0,
      },
    });

    await prisma.leagueMember.create({
      data: {
        leagueId: league.id,
        userId: user1Id,
        portfolioId: p.id,
        joinedAt: new Date(startDate.getTime() - 10000),
      },
    });

    const res = await request(app)
      .post("/api/v1/orders")
      .set("Authorization", `Bearer ${user1Token}`)
      .send({
        portfolioId: p.id,
        symbol: "AAPL",
        assetType: "STOCK",
        side: "BUY",
        type: "MARKET",
        quantity: "1",
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("LEAGUE_ENDED");
  });

  test("POST /api/v1/orders rejects short selling on league portfolios", async () => {
    const startDate = new Date(Date.now() - 86400000);
    const endDate = new Date(Date.now() + 5 * 86400000);

    const league = await prisma.league.create({
      data: {
        name: "Active Short Reject League",
        startingBalance: 10000,
        startDate,
        endDate,
        status: "ACTIVE",
      },
    });
    createdLeagueIds.push(league.id);

    const p = await prisma.portfolio.create({
      data: {
        userId: user1Id,
        name: "Active-No-Short-P",
        startingBalance: 10000,
        cashBalance: 10000,
        reservedCash: 0,
      },
    });

    await prisma.leagueMember.create({
      data: {
        leagueId: league.id,
        userId: user1Id,
        portfolioId: p.id,
        joinedAt: new Date(startDate.getTime() - 10000),
      },
    });

    const res = await request(app)
      .post("/api/v1/orders")
      .set("Authorization", `Bearer ${user1Token}`)
      .send({
        portfolioId: p.id,
        symbol: "AAPL",
        assetType: "STOCK",
        side: "SELL",
        type: "MARKET",
        quantity: "5",
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("SHORT_SELLING_DISALLOWED");
  });

  test("GET /api/v1/leagues/:id/leaderboard calculates mark-to-market returns and applies tie-breaker hierarchy", async () => {
    // Create an active competition: started 2 days ago, ends in 5 days
    const startDate = new Date(Date.now() - 2 * 86400000);
    const endDate = new Date(Date.now() + 5 * 86400000);

    const league = await prisma.league.create({
      data: {
        name: "Scoring & Tie-breaker League",
        startingBalance: new Prisma.Decimal(10000),
        startDate,
        endDate,
        status: "ACTIVE",
      },
    });
    createdLeagueIds.push(league.id);
    activeLeagueId = league.id;

    // Create 3 portfolios for user1, user2, user3 and suspendedUser
    const p1 = await prisma.portfolio.create({
      data: {
        userId: user1Id,
        name: "L-P1",
        startingBalance: 10000,
        cashBalance: 10000,
        reservedCash: 0,
      },
    });

    const p2 = await prisma.portfolio.create({
      data: {
        userId: user2Id,
        name: "L-P2",
        startingBalance: 10000,
        cashBalance: 10000,
        reservedCash: 0,
      },
    });

    const p3 = await prisma.portfolio.create({
      data: {
        userId: user3Id,
        name: "L-P3",
        startingBalance: 10000,
        cashBalance: 10000,
        reservedCash: 0,
      },
    });

    const pSusp = await prisma.portfolio.create({
      data: {
        userId: suspendedUserId,
        name: "L-PSusp",
        startingBalance: 10000,
        cashBalance: 10000,
        reservedCash: 0,
      },
    });

    // Add members with controlled join dates (before startDate)
    const joinDate1 = new Date(startDate.getTime() - 3600000);
    const joinDate2 = new Date(startDate.getTime() - 7200000); // earlier joiner
    const joinDate3 = new Date(startDate.getTime() - 1800000);

    await prisma.leagueMember.createMany({
      data: [
        {
          leagueId: league.id,
          userId: user1Id,
          portfolioId: p1.id,
          joinedAt: joinDate1,
        },
        {
          leagueId: league.id,
          userId: user2Id,
          portfolioId: p2.id,
          joinedAt: joinDate2,
        },
        {
          leagueId: league.id,
          userId: user3Id,
          portfolioId: p3.id,
          joinedAt: joinDate3,
        },
        {
          leagueId: league.id,
          userId: suspendedUserId,
          portfolioId: pSusp.id,
          joinedAt: joinDate1,
        },
      ],
    });

    // User 1 trades inside the window: BUY 10 AAPL @ 150 = $1,500
    // Then SELL 10 AAPL @ 200 = $2,000 -> Cash = 10,000 - 1,500 + 2,000 = $10,500 (+5% return)
    // Plus an OUT-OF-RANGE trade executed BEFORE startDate: should be strictly excluded!
    const outOfRangeTradeDate = new Date(startDate.getTime() - 10000000);
    const inRangeTrade1 = new Date(startDate.getTime() + 3600000);
    const inRangeTrade2 = new Date(startDate.getTime() + 7200000);

    // Out-of-range trade for User 1 (e.g. +$5,000 profit made before league started)
    await createTestTrade({
      portfolioId: p1.id,
      symbol: "MSFT",
      side: "BUY",
      quantity: 10,
      price: 100,
      totalValue: 1000,
      executedAt: outOfRangeTradeDate,
    });

    // In-range trades for User 1:
    await createTestTrade({
      portfolioId: p1.id,
      symbol: "AAPL",
      side: "BUY",
      quantity: 10,
      price: 150,
      totalValue: 1500,
      executedAt: inRangeTrade1,
    });
    await createTestTrade({
      portfolioId: p1.id,
      symbol: "AAPL",
      side: "SELL",
      quantity: 10,
      price: 200,
      totalValue: 2000,
      realizedPnl: 500,
      executedAt: inRangeTrade2,
    });

    // User 2: Zero trades. Return = 0%, totalValue = $10,000, tradeCount = 0.
    // User 3: Traded 1 BUY of 10 GOOG @ 100 ($1,000) and sold @ 100 ($1,000). Return = 0%, totalValue = $10,000, tradeCount = 2.
    await createTestTrade({
      portfolioId: p3.id,
      symbol: "GOOG",
      side: "BUY",
      quantity: 10,
      price: 100,
      totalValue: 1000,
      executedAt: inRangeTrade1,
    });
    await createTestTrade({
      portfolioId: p3.id,
      symbol: "GOOG",
      side: "SELL",
      quantity: 10,
      price: 100,
      totalValue: 1000,
      realizedPnl: 0,
      executedAt: inRangeTrade2,
    });

    // User Suspended: Traded +10% return, but is suspended so must NOT appear on leaderboard.
    await createTestTrade({
      portfolioId: pSusp.id,
      symbol: "TSLA",
      side: "BUY",
      quantity: 10,
      price: 100,
      totalValue: 1000,
      executedAt: inRangeTrade1,
    });
    await createTestTrade({
      portfolioId: pSusp.id,
      symbol: "TSLA",
      side: "SELL",
      quantity: 10,
      price: 200,
      totalValue: 2000,
      realizedPnl: 1000,
      executedAt: inRangeTrade2,
    });

    const res = await request(app).get(`/api/v1/leagues/${league.id}/leaderboard`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const { leaderboard } = res.body.data;
    // Must contain exactly 3 users (suspended user excluded)
    expect(leaderboard.length).toBe(3);
    const userIds = leaderboard.map((l) => l.userId);
    expect(userIds).not.toContain(suspendedUserId);

    // Rank 1: User 1
    // return = +5% (from $500 profit on AAPL). Out of range trade was excluded!
    // tradeCount = 2 (out of range trade excluded from tradeCount!)
    expect(leaderboard[0].rank).toBe(1);
    expect(leaderboard[0].userId).toBe(user1Id);
    expect(leaderboard[0].returnPct).toBe(5);
    expect(leaderboard[0].totalValue).toBe(10500);
    expect(leaderboard[0].tradeCount).toBe(2);

    // Both User 2 and User 3 have returnPct = 0% and totalValue = 10000.
    // Tie-breaker hierarchy:
    // 1. returnPct (0 vs 0 - tie)
    // 2. totalValue (10000 vs 10000 - tie)
    // 3. tradeCount DESC: User 3 has tradeCount 2 > User 2 has tradeCount 0!
    // So User 3 must be Rank 2, and User 2 must be Rank 3!
    expect(leaderboard[1].rank).toBe(2);
    expect(leaderboard[1].userId).toBe(user3Id);
    expect(leaderboard[1].returnPct).toBe(0);
    expect(leaderboard[1].tradeCount).toBe(2);

    // User 2: Rank 3 (zero trades, ranked by score and tie-breaker without artificial demotion)
    expect(leaderboard[2].rank).toBe(3);
    expect(leaderboard[2].userId).toBe(user2Id);
    expect(leaderboard[2].returnPct).toBe(0);
    expect(leaderboard[2].tradeCount).toBe(0);
  });

  test("Completed league freezes valuation, sets status COMPLETED, and persists finalReturn and rank", async () => {
    // Create an expired league (endDate in the past)
    const startDate = new Date(Date.now() - 10 * 86400000);
    const endDate = new Date(Date.now() - 1 * 86400000);

    const league = await prisma.league.create({
      data: {
        name: "Completed Competition",
        startingBalance: 10000,
        startDate,
        endDate,
        status: "ACTIVE", // should finalize to COMPLETED
      },
    });
    createdLeagueIds.push(league.id);

    const p = await prisma.portfolio.create({
      data: {
        userId: user1Id,
        name: "Comp-P1",
        startingBalance: 10000,
        cashBalance: 10000,
        reservedCash: 0,
      },
    });

    const member = await prisma.leagueMember.create({
      data: {
        leagueId: league.id,
        userId: user1Id,
        portfolioId: p.id,
        joinedAt: new Date(startDate.getTime() - 100000),
      },
    });

    // Execute 1 trade inside the period: +$2,000 profit (+20%)
    await createTestTrade({
      portfolioId: p.id,
      symbol: "NVDA",
      side: "BUY",
      quantity: 10,
      price: 100,
      totalValue: 1000,
      executedAt: new Date(startDate.getTime() + 3600000),
    });
    await createTestTrade({
      portfolioId: p.id,
      symbol: "NVDA",
      side: "SELL",
      quantity: 10,
      price: 300,
      totalValue: 3000,
      realizedPnl: 2000,
      executedAt: new Date(startDate.getTime() + 7200000),
    });

    // Request leaderboard for the ended league
    const res = await request(app).get(`/api/v1/leagues/${league.id}/leaderboard`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.league.status).toBe("COMPLETED");

    const entry = res.body.data.leaderboard[0];
    expect(entry.rank).toBe(1);
    expect(entry.returnPct).toBe(20);

    // Verify persisted state in database
    const updatedLeague = await prisma.league.findUnique({
      where: { id: league.id },
    });
    expect(updatedLeague.status).toBe("COMPLETED");

    const updatedMember = await prisma.leagueMember.findUnique({
      where: { id: member.id },
    });
    expect(updatedMember.rank).toBe(1);
    expect(Number(updatedMember.finalReturn)).toBe(20);
  });
});
