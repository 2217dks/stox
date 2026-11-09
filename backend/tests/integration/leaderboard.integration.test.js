const request = require("supertest");

const app = require("../../src/app");
const prisma = require("../../src/config/database");

const {
  generateLeaderboardSnapshots,
} = require("../../src/services/leaderboardService");

const timestamp = Date.now();

const buildUser = (index) => ({
  name: `Leaderboard Integration User ${index}`,
  email: `leaderboard-integration-${index}-${timestamp}@example.com`,
  password: "IntegrationTest#2026",
});

let snapshotDate;
let snapshotId;
let emptySnapshotId;

let user1Id;
let user2Id;
let user3Id;

let user1AccessToken;

beforeAll(async () => {
  jest.setTimeout(15000);

  const registrations = [];

  for (const index of [1, 2, 3]) {
    const response = await request(app)
      .post("/api/v1/auth/register")
      .send(buildUser(index));

    expect([200, 201]).toContain(response.status);
    registrations.push(response.body.data);
  }

  user1Id = registrations[0].user.id;
  user1AccessToken = registrations[0].accessToken;
  user2Id = registrations[1].user.id;
  user3Id = registrations[2].user.id;

  const latestSnapshot = await prisma.leaderboardSnapshot.findFirst({
    where: {
      scope: "GLOBAL",
      period: "MONTHLY",
    },
    orderBy: {
      snapshotDate: "desc",
    },
    select: {
      snapshotDate: true,
    },
  });

  const baseDate = latestSnapshot?.snapshotDate ?? new Date();

  snapshotDate = new Date(
    Date.UTC(
      baseDate.getUTCFullYear(),
      baseDate.getUTCMonth(),
      baseDate.getUTCDate() + 1,
    ),
  );

  const snapshot = await prisma.leaderboardSnapshot.create({
    data: {
      scope: "GLOBAL",
      period: "MONTHLY",
      snapshotDate,
    },
  });

  snapshotId = snapshot.id;

  await prisma.leaderboardEntry.createMany({
    data: [
      {
        userId: user1Id,
        snapshotId,
        scope: "GLOBAL",
        period: "MONTHLY",
        rank: 1,
        totalValue: "11050",
        returnPct: "10.5",
        snapshotDate,
      },
      {
        userId: user2Id,
        snapshotId,
        scope: "GLOBAL",
        period: "MONTHLY",
        rank: 2,
        totalValue: "10525",
        returnPct: "5.25",
        snapshotDate,
      },
      {
        userId: user3Id,
        snapshotId,
        scope: "GLOBAL",
        period: "MONTHLY",
        rank: 3,
        totalValue: "10300",
        returnPct: "3.0",
        snapshotDate,
      },
    ],
  });

  // The caller follows only user 2, so user 3 must not appear in the friends board.
  await prisma.follow.create({
    data: {
      followerId: user1Id,
      followingId: user2Id,
    },
  });
});

afterAll(async () => {
  if (emptySnapshotId) {
    await prisma.leaderboardSnapshot.deleteMany({
      where: { id: emptySnapshotId },
    });
  }

  if (snapshotId) {
    await prisma.leaderboardSnapshot.deleteMany({
      where: { id: snapshotId },
    });
  }

  await prisma.user.deleteMany({
    where: {
      id: {
        in: [user1Id, user2Id, user3Id].filter(Boolean),
      },
    },
  });

  await prisma.$disconnect();
});

describe("Leaderboard integration API", () => {
  test("rejects unauthenticated leaderboard requests", async () => {
    const response = await request(app).get("/api/v1/leaderboard");

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("UNAUTHORIZED");
  });

  test("returns the global leaderboard ordered by rank", async () => {
    const response = await request(app)
      .get("/api/v1/leaderboard?period=MONTHLY")
      .set("Authorization", `Bearer ${user1AccessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);

    const { leaderboard, pagination } = response.body.data;

    expect(pagination.total).toBe(3);
    expect(leaderboard).toHaveLength(3);

    expect(leaderboard.map((entry) => entry.rank)).toEqual([1, 2, 3]);
    expect(leaderboard[0].userId).toBe(user1Id);
    expect(leaderboard[0].user.id).toBe(user1Id);
    expect(leaderboard[0].returnPct).toBe("10.5");
  });

  test("returns an empty board when no snapshot exists for the period", async () => {
    const response = await request(app)
      .get("/api/v1/leaderboard?period=WEEKLY")
      .set("Authorization", `Bearer ${user1AccessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.data.leaderboard).toHaveLength(0);
    expect(response.body.data.pagination.total).toBe(0);
  });

  test("rejects an invalid leaderboard period", async () => {
    const response = await request(app)
      .get("/api/v1/leaderboard?period=YEARLY")
      .set("Authorization", `Bearer ${user1AccessToken}`);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  test("returns the friends leaderboard scoped to the caller and followees", async () => {
    const response = await request(app)
      .get("/api/v1/leaderboard/friends?period=MONTHLY")
      .set("Authorization", `Bearer ${user1AccessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);

    const leaderboard = response.body.data.leaderboard;
    const userIds = leaderboard.map((entry) => entry.userId);

    expect(userIds).toContain(user1Id);
    expect(userIds).toContain(user2Id);
    expect(userIds).not.toContain(user3Id);

    // Re-ranked by return: user 1 (10.5) before user 2 (5.25).
    expect(leaderboard[0].userId).toBe(user1Id);
    expect(leaderboard[0].rank).toBe(1);
  });

  test("uses user ID as a deterministic tie-breaker for equal friends", async () => {
    await prisma.leaderboardEntry.updateMany({
      where: {
        scope: "GLOBAL",
        period: "MONTHLY",
        snapshotDate,
        userId: {
          in: [user1Id, user2Id],
        },
      },
      data: {
        returnPct: "5.25",
        totalValue: "10525",
      },
    });

    const response = await request(app)
      .get("/api/v1/leaderboard/friends?period=MONTHLY")
      .set("Authorization", `Bearer ${user1AccessToken}`);

    expect(response.status).toBe(200);

    const leaderboard = response.body.data.leaderboard;

    const expectedOrder = [user1Id, user2Id].sort((a, b) => a.localeCompare(b));

    expect(leaderboard.map((entry) => entry.userId)).toEqual(expectedOrder);
    expect(leaderboard.map((entry) => entry.rank)).toEqual([1, 2]);
  });

  test("returns an empty board when the latest snapshot has no entries", async () => {
    const emptySnapshotDate = new Date(snapshotDate);
    emptySnapshotDate.setUTCDate(emptySnapshotDate.getUTCDate() + 1);

    const emptySnapshot = await prisma.leaderboardSnapshot.create({
      data: {
        scope: "GLOBAL",
        period: "MONTHLY",
        snapshotDate: emptySnapshotDate,
      },
    });

    emptySnapshotId = emptySnapshot.id;

    const response = await request(app)
      .get("/api/v1/leaderboard?period=MONTHLY")
      .set("Authorization", `Bearer ${user1AccessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.leaderboard).toHaveLength(0);
    expect(response.body.data.pagination.total).toBe(0);
  });

  test("generates all period snapshots and refreshes them idempotently", async () => {
    const testDate = new Date("2099-06-17T00:00:00.000Z");
    const previousDay = new Date("2099-06-16T12:00:00.000Z");
    const currentDay = new Date("2099-06-17T12:00:00.000Z");

    const portfolio = await prisma.portfolio.findFirst({
      where: {
        userId: user1Id,
        isDefault: true,
      },
    });

    expect(portfolio).not.toBeNull();

    const originalCashBalance = portfolio.cashBalance;
    const orderIds = [];

    try {
      await prisma.portfolio.update({
        where: { id: portfolio.id },
        data: { cashBalance: "11000" },
      });

      for (const [executedAt, realizedPnl] of [
        [previousDay, "200"],
        [currentDay, "500"],
      ]) {
        const order = await prisma.order.create({
          data: {
            portfolioId: portfolio.id,
            symbol: "LEADERBOARDTEST",
            assetType: "STOCK",
            side: "SELL",
            type: "MARKET",
            status: "EXECUTED",
            quantity: "1",
            executedPrice: "100",
            executedAt,
          },
        });

        orderIds.push(order.id);

        await prisma.trade.create({
          data: {
            portfolioId: portfolio.id,
            orderId: order.id,
            symbol: "LEADERBOARDTEST",
            assetType: "STOCK",
            side: "SELL",
            quantity: "1",
            price: "100",
            totalValue: "100",
            realizedPnl,
            executedAt,
          },
        });
      }

      const firstRun = await generateLeaderboardSnapshots({
        date: testDate,
      });

      expect(firstRun.snapshotDate.toISOString()).toBe(
        "2099-06-17T00:00:00.000Z",
      );

      expect(firstRun.leaderboards.map((item) => item.period)).toEqual([
        "DAILY",
        "WEEKLY",
        "MONTHLY",
        "ALL_TIME",
      ]);

      const snapshots = await prisma.leaderboardSnapshot.findMany({
        where: {
          scope: "GLOBAL",
          snapshotDate: testDate,
        },
      });

      expect(snapshots).toHaveLength(4);

      const entries = await prisma.leaderboardEntry.findMany({
        where: {
          userId: user1Id,
          scope: "GLOBAL",
          snapshotDate: testDate,
        },
      });

      expect(entries).toHaveLength(4);

      const entriesByPeriod = Object.fromEntries(
        entries.map((entry) => [entry.period, entry]),
      );

      // Current-day P&L only.
      expect(Number(entriesByPeriod.DAILY.returnPct)).toBe(5);

      // Previous day is also included in weekly and monthly P&L.
      expect(Number(entriesByPeriod.WEEKLY.returnPct)).toBe(7);
      expect(Number(entriesByPeriod.MONTHLY.returnPct)).toBe(7);

      // Portfolio value is 11,000 against a starting balance of 10,000.
      expect(Number(entriesByPeriod.ALL_TIME.returnPct)).toBe(10);

      // Generating the same date again must refresh, not duplicate.
      await generateLeaderboardSnapshots({ date: testDate });

      const snapshotsAfterRerun = await prisma.leaderboardSnapshot.findMany({
        where: {
          scope: "GLOBAL",
          snapshotDate: testDate,
        },
      });

      expect(snapshotsAfterRerun).toHaveLength(4);

      const entriesAfterRerun = await prisma.leaderboardEntry.findMany({
        where: {
          userId: user1Id,
          scope: "GLOBAL",
          snapshotDate: testDate,
        },
      });

      expect(entriesAfterRerun).toHaveLength(4);

      // Verify the API consumes the generated snapshot.
      const response = await request(app)
        .get("/api/v1/leaderboard?period=MONTHLY")
        .set("Authorization", `Bearer ${user1AccessToken}`);

      expect(response.status).toBe(200);

      const apiEntry = response.body.data.leaderboard.find(
        (entry) => entry.userId === user1Id,
      );

      expect(apiEntry).toBeDefined();
      expect(Number(apiEntry.returnPct)).toBe(7);
    } finally {
      await prisma.leaderboardSnapshot.deleteMany({
        where: {
          scope: "GLOBAL",
          snapshotDate: testDate,
        },
      });

      await prisma.order.deleteMany({
        where: {
          id: { in: orderIds },
        },
      });

      await prisma.portfolio.update({
        where: { id: portfolio.id },
        data: { cashBalance: originalCashBalance },
      });
    }
  });
});
