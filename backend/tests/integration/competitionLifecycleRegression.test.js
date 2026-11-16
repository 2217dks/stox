const request = require("supertest");
const { Prisma } = require("@prisma/client");

const app = require("../../src/app");
const prisma = require("../../src/config/database");
const marketDataService = require("../../src/services/marketData");
const { getLeagueLeaderboard } = require("../../src/services/competitionService");

const timestamp = Date.now();

let user1Id, user1Token;
let user2Id, user2Token;
let createdLeagueIds = [];
let quoteSpy;

beforeAll(async () => {
  jest.setTimeout(30000);

  quoteSpy = jest.spyOn(marketDataService, "getQuote").mockResolvedValue({
    symbol: "AAPL",
    price: 150,
    timestamp: new Date().toISOString(),
  });

  const u1 = await request(app).post("/api/v1/auth/register").send({
    name: "Lifecycle User 1",
    email: `lifecycle-u1-${timestamp}@example.com`,
    password: "Password123!",
  });
  user1Id = u1.body.data.user.id;
  user1Token = u1.body.data.accessToken;

  const u2 = await request(app).post("/api/v1/auth/register").send({
    name: "Lifecycle User 2",
    email: `lifecycle-u2-${timestamp}@example.com`,
    password: "Password123!",
  });
  user2Id = u2.body.data.user.id;
  user2Token = u2.body.data.accessToken;
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

    const testUserIds = [user1Id, user2Id].filter(Boolean);
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
    // best-effort cleanup
  } finally {
    await prisma.$disconnect();
  }
});

describe("Task 47 Competition Scoring and Lifecycle Regressions (#128, PR #149)", () => {
  test("end-to-end competition lifecycle: UPCOMING -> ACTIVE -> COMPLETED with scoring and restrictions", async () => {
    // 1. Create league scheduled to start in 1 day and end in 8 days
    const startDate = new Date(Date.now() + 86400000);
    const endDate = new Date(Date.now() + 8 * 86400000);

    const createRes = await request(app)
      .post("/api/v1/leagues")
      .set("Authorization", `Bearer ${user1Token}`)
      .send({
        name: "E2E Lifecycle Championship",
        description: "Regression test league",
        startingBalance: 15000,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        maxParticipants: 10,
      });

    expect(createRes.status).toBe(201);
    const leagueId = createRes.body.data.league.id;
    createdLeagueIds.push(leagueId);
    expect(createRes.body.data.league.status).toBe("UPCOMING");

    // 2. Both User 1 and User 2 join before start
    const join1 = await request(app)
      .post(`/api/v1/leagues/${leagueId}/join`)
      .set("Authorization", `Bearer ${user1Token}`)
      .send({});
    expect(join1.status).toBe(200);
    const p1Id = join1.body.data.member.portfolioId;

    const join2 = await request(app)
      .post(`/api/v1/leagues/${leagueId}/join`)
      .set("Authorization", `Bearer ${user2Token}`)
      .send({});
    expect(join2.status).toBe(200);
    const p2Id = join2.body.data.member.portfolioId;

    // Verify dedicated portfolio balances
    const p1 = await prisma.portfolio.findUnique({ where: { id: p1Id } });
    expect(Number(p1.startingBalance)).toBe(15000);
    expect(Number(p1.cashBalance)).toBe(15000);

    // 3. User 1 tries to place an order before start date -> rejected LEAGUE_NOT_ACTIVE
    const preOrder = await request(app)
      .post("/api/v1/orders")
      .set("Authorization", `Bearer ${user1Token}`)
      .send({
        portfolioId: p1Id,
        symbol: "AAPL",
        assetType: "STOCK",
        side: "BUY",
        type: "MARKET",
        quantity: "1",
      });
    expect(preOrder.status).toBe(400);
    expect(preOrder.body.error.code).toBe("LEAGUE_NOT_ACTIVE");

    // 4. Advance league start to 2 hours ago (transitioning to ACTIVE)
    const activeStart = new Date(Date.now() - 7200000);
    await prisma.league.update({
      where: { id: leagueId },
      data: { startDate: activeStart },
    });

    // Verification of status consistency:
    const detailRes = await request(app).get(`/api/v1/leagues/${leagueId}`);
    expect(detailRes.body.data.league.status).toBe("ACTIVE");

    // Joining after start is rejected
    const lateJoin = await request(app)
      .post(`/api/v1/leagues/${leagueId}/join`)
      .set("Authorization", `Bearer ${user1Token}`)
      .send({});
    expect(lateJoin.status).toBe(400);
    expect(lateJoin.body.error.code).toBe("LEAGUE_ALREADY_STARTED");

    // 5. Short selling is disallowed on league portfolio
    const shortOrder = await request(app)
      .post("/api/v1/orders")
      .set("Authorization", `Bearer ${user1Token}`)
      .send({
        portfolioId: p1Id,
        symbol: "AAPL",
        assetType: "STOCK",
        side: "SELL",
        type: "MARKET",
        quantity: "10",
      });
    expect(shortOrder.status).toBe(400);
    expect(shortOrder.body.error.code).toBe("SHORT_SELLING_DISALLOWED");

    // 6. Execute in-period trade for User 1:
    // BUY 10 AAPL @ 150, fees = 20. Total invested = 1500, fees = 20. Cash = 15000 - 1500 - 20 = 13480.
    const order1 = await prisma.order.create({
      data: {
        portfolioId: p1Id,
        symbol: "AAPL",
        assetType: "STOCK",
        side: "BUY",
        type: "MARKET",
        status: "EXECUTED",
        quantity: 10,
        executedPrice: 150,
        executedAt: new Date(activeStart.getTime() + 3600000),
      },
    });

    await prisma.trade.create({
      data: {
        orderId: order1.id,
        portfolioId: p1Id,
        symbol: "AAPL",
        assetType: "STOCK",
        side: "BUY",
        quantity: 10,
        price: 150,
        totalValue: 1500,
        fees: 20,
        executedAt: new Date(activeStart.getTime() + 3600000),
      },
    });

    // 7. Request active leaderboard with mock quote AAPL = $170
    // Holdings value = 10 * 170 = 1700.
    // Total value = 13480 + 1700 = 15180.
    // Return % = ((15180 - 15000) / 15000) * 100 = 1.2%.
    const mockProvider = {
      getQuote: jest.fn().mockResolvedValue({ symbol: "AAPL", price: "170" }),
    };

    const activeLb = await getLeagueLeaderboard({
      leagueId,
      now: new Date(),
      priceProvider: mockProvider,
      finalizeIfEnded: false,
    });

    expect(activeLb.league.status).toBe("ACTIVE");
    expect(activeLb.leaderboard[0].userId).toBe(user1Id);
    expect(activeLb.leaderboard[0].returnPct).toBe(1.2);
    expect(activeLb.leaderboard[0].totalValue).toBe(15180);
    expect(activeLb.leaderboard[1].userId).toBe(user2Id);
    expect(activeLb.leaderboard[1].returnPct).toBe(0);

    // 8. End the league (endDate set to past)
    const pastEnd = new Date(Date.now() - 3600000);
    await prisma.league.update({
      where: { id: leagueId },
      data: { endDate: pastEnd },
    });

    // Orders placed after end are rejected
    const postEndOrder = await request(app)
      .post("/api/v1/orders")
      .set("Authorization", `Bearer ${user1Token}`)
      .send({
        portfolioId: p1Id,
        symbol: "AAPL",
        assetType: "STOCK",
        side: "BUY",
        type: "MARKET",
        quantity: "1",
      });
    expect(postEndOrder.status).toBe(400);
    expect(postEndOrder.body.error.code).toBe("LEAGUE_ENDED");

    // 9. When price is unavailable at completion time, finalization rejects and does NOT persist rank
    const brokenProvider = {
      getHistoricalPrice: jest.fn().mockRejectedValue(new Error("Downstream quote outage")),
    };

    await expect(
      getLeagueLeaderboard({
        leagueId,
        now: new Date(),
        priceProvider: brokenProvider,
        finalizeIfEnded: true,
      }),
    ).rejects.toMatchObject({
      code: "MARKET_DATA_PROVIDER_UNAVAILABLE",
      statusCode: 503,
    });

    // Check DB: ranks still unassigned!
    const unrankedMembers = await prisma.leagueMember.findMany({
      where: { leagueId },
    });
    expect(unrankedMembers.every((m) => m.rank === null)).toBe(true);

    // 10. Finalize with valid historical provider: AAPL close = $180
    // Holdings value = 10 * 180 = 1800.
    // Total value = 13480 + 1800 = 15280.
    // Return % = ((15280 - 15000) / 15000) * 100 = 1.8667%.
    const validHistProvider = {
      getHistoricalPrice: jest.fn().mockResolvedValue({ symbol: "AAPL", price: "180" }),
    };

    const finalLb = await getLeagueLeaderboard({
      leagueId,
      now: new Date(),
      priceProvider: validHistProvider,
      finalizeIfEnded: true,
    });

    expect(finalLb.league.status).toBe("COMPLETED");
    expect(finalLb.leaderboard[0].rank).toBe(1);
    expect(finalLb.leaderboard[0].returnPct).toBe(1.8667);

    // Verify DB persisted final ranks and returns
    const rankedMembers = await prisma.leagueMember.findMany({
      where: { leagueId },
      orderBy: { rank: "asc" },
    });
    expect(rankedMembers[0].userId).toBe(user1Id);
    expect(rankedMembers[0].rank).toBe(1);
    expect(Number(rankedMembers[0].finalReturn)).toBeCloseTo(1.8667, 3);
    expect(rankedMembers[1].userId).toBe(user2Id);
    expect(rankedMembers[1].rank).toBe(2);
    expect(Number(rankedMembers[1].finalReturn)).toBe(0);
  });

  test("allows order placement after startDate when stored status is still UPCOMING without prior league fetch", async () => {
    // 1. Create upcoming league starting in 1 hour
    const now = Date.now();
    const futureStart = new Date(now + 3600000);
    const futureEnd = new Date(now + 86400000);

    const createRes = await request(app)
      .post("/api/v1/leagues")
      .set("Authorization", `Bearer ${user1Token}`)
      .send({
        name: "No-Fetch Direct Order League",
        description: "Regression test for placing an order after startDate without prior GET",
        startingBalance: 10000,
        startDate: futureStart.toISOString(),
        endDate: futureEnd.toISOString(),
        maxParticipants: 5,
      });

    expect(createRes.status).toBe(201);
    const leagueId = createRes.body.data.league.id;
    createdLeagueIds.push(leagueId);

    // 2. User joins league while still upcoming
    const joinRes = await request(app)
      .post(`/api/v1/leagues/${leagueId}/join`)
      .set("Authorization", `Bearer ${user1Token}`)
      .send({});
    expect(joinRes.status).toBe(200);
    const portfolioId = joinRes.body.data.member.portfolioId;

    // 3. Advance startDate in DB to 5 minutes ago, while explicitly leaving status: "UPCOMING"
    const pastStart = new Date(Date.now() - 300000);
    await prisma.league.update({
      where: { id: leagueId },
      data: {
        startDate: pastStart,
        status: "UPCOMING",
      },
    });

    // Verify stored DB status is indeed still "UPCOMING"
    const storedLeague = await prisma.league.findUnique({
      where: { id: leagueId },
      select: { status: true },
    });
    expect(storedLeague.status).toBe("UPCOMING");

    // 4. Directly place an order on the league portfolio WITHOUT fetching list or detail first
    const orderRes = await request(app)
      .post("/api/v1/orders")
      .set("Authorization", `Bearer ${user1Token}`)
      .send({
        portfolioId,
        symbol: "AAPL",
        assetType: "STOCK",
        side: "BUY",
        type: "MARKET",
        quantity: "2",
      });

    expect(orderRes.status).toBe(201);
    expect(orderRes.body.success).toBe(true);
    expect(orderRes.body.data.order.portfolioId).toBe(portfolioId);
    expect(orderRes.body.data.order.symbol).toBe("AAPL");
    expect(orderRes.body.data.order.status).toBe("PENDING");
  });
});

