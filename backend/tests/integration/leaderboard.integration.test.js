const request = require("supertest");

const app = require("../../src/app");
const prisma = require("../../src/config/database");

const timestamp = Date.now();

const buildUser = (index) => ({
  name: `Leaderboard Integration User ${index}`,
  email: `leaderboard-integration-${index}-${timestamp}@example.com`,
  password: "IntegrationTest#2026",
});

const snapshotDate = new Date("2026-10-01T00:00:00.000Z");

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

  await prisma.leaderboardEntry.createMany({
    data: [
      {
        userId: user1Id,
        scope: "GLOBAL",
        period: "MONTHLY",
        rank: 1,
        totalValue: "11050",
        returnPct: "10.5",
        snapshotDate,
      },
      {
        userId: user2Id,
        scope: "GLOBAL",
        period: "MONTHLY",
        rank: 2,
        totalValue: "10525",
        returnPct: "5.25",
        snapshotDate,
      },
      {
        userId: user3Id,
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
});
