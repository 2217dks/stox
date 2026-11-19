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
let emptyWeeklySnapshotId;

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
  if (emptyWeeklySnapshotId) {
    await prisma.leaderboardSnapshot.deleteMany({
      where: { id: emptyWeeklySnapshotId },
    });
  }

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

  test("returns an empty board when the latest weekly snapshot has no entries", async () => {
    // Integration tests share a local database that may already contain
    // production-like or previously generated snapshots. Create a snapshot
    // later than any real one so the assertion is deterministic without
    // deleting existing leaderboard history. The true "no snapshot at all"
    // branch is covered by the service unit tests.
    const emptyWeeklyDate = new Date("2099-06-19T00:00:00.000Z");

    // Recover from a previous interrupted run that left this test-only row.
    await prisma.leaderboardSnapshot.deleteMany({
      where: {
        scope: "GLOBAL",
        period: "WEEKLY",
        snapshotDate: emptyWeeklyDate,
      },
    });

    const emptySnapshot = await prisma.leaderboardSnapshot.create({
      data: {
        scope: "GLOBAL",
        period: "WEEKLY",
        snapshotDate: emptyWeeklyDate,
      },
    });

    emptyWeeklySnapshotId = emptySnapshot.id;

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

  test("excludes suspended users from generated leaderboard snapshots", async () => {
    const testDate = new Date("2099-06-18T00:00:00.000Z");

    try {
      await prisma.user.update({
        where: { id: user3Id },
        data: { isSuspended: true },
      });

      await generateLeaderboardSnapshots({ date: testDate });

      const user3Entries = await prisma.leaderboardEntry.findMany({
        where: {
          userId: user3Id,
          scope: "GLOBAL",
          snapshotDate: testDate,
        },
      });

      expect(user3Entries).toHaveLength(0);

      const activeUserEntries = await prisma.leaderboardEntry.findMany({
        where: {
          userId: user1Id,
          scope: "GLOBAL",
          snapshotDate: testDate,
        },
      });

      expect(activeUserEntries.length).toBeGreaterThan(0);
    } finally {
      await prisma.user.update({
        where: { id: user3Id },
        data: { isSuspended: false },
      });

      await prisma.leaderboardSnapshot.deleteMany({
        where: {
          scope: "GLOBAL",
          snapshotDate: testDate,
        },
      });
    }
  });

  test("rolls back transaction and persists no snapshots or entries when lock lease is lost during final period DB work", async () => {
    const rollbackDate = new Date("2099-06-25T00:00:00.000Z");

    await prisma.leaderboardEntry.deleteMany({
      where: { snapshotDate: rollbackDate },
    });
    await prisma.leaderboardSnapshot.deleteMany({
      where: { snapshotDate: rollbackDate },
    });

    const abortController = new AbortController();

    // Intercept Prisma's interactive transaction client to simulate lease loss during final period (ALL_TIME) DB work
    const origTransaction = prisma.$transaction.bind(prisma);
    const transactionSpy = jest
      .spyOn(prisma, "$transaction")
      .mockImplementation(async (cb, ...args) => {
        if (typeof cb === "function") {
          return origTransaction(
            async (tx) => {
              const origUpsert = tx.leaderboardSnapshot.upsert.bind(
                tx.leaderboardSnapshot,
              );
              tx.leaderboardSnapshot.upsert = async (params) => {
                const res = await origUpsert(params);
                // In the final period (ALL_TIME), trigger the lost lease abort signal
                if (
                  params?.where?.scope_period_snapshotDate?.period ===
                  "ALL_TIME"
                ) {
                  abortController.abort();
                }
                return res;
              };
              return cb(tx);
            },
            ...args,
          );
        }
        return origTransaction(cb, ...args);
      });

    try {
      await expect(
        generateLeaderboardSnapshots({
          date: rollbackDate,
          signal: abortController.signal,
        }),
      ).rejects.toMatchObject({
        code: "LOCK_RENEWAL_FAILED",
      });

      // Verify database effects: the transaction must have rolled back completely.
      // Even though DAILY, WEEKLY, and MONTHLY snapshots were already written during the loop,
      // zero snapshots and zero entries must be persisted in the database.
      const persistedSnapshots = await prisma.leaderboardSnapshot.findMany({
        where: {
          scope: "GLOBAL",
          snapshotDate: rollbackDate,
        },
      });
      expect(persistedSnapshots).toHaveLength(0);

      const persistedEntries = await prisma.leaderboardEntry.findMany({
        where: {
          scope: "GLOBAL",
          snapshotDate: rollbackDate,
        },
      });
      expect(persistedEntries).toHaveLength(0);
    } finally {
      transactionSpy.mockRestore();
      await prisma.leaderboardEntry.deleteMany({
        where: { snapshotDate: rollbackDate },
      });
      await prisma.leaderboardSnapshot.deleteMany({
        where: { snapshotDate: rollbackDate },
      });
    }
  });

  describe("GET /api/v1/leaderboard/history", () => {
    test("rejects unauthenticated requests", async () => {
      const response = await request(app).get("/api/v1/leaderboard/history");

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe("UNAUTHORIZED");
    });

    test("validates period, date formats, and conflicting parameters", async () => {
      const invalidPeriod = await request(app)
        .get("/api/v1/leaderboard/history?period=INVALID")
        .set("Authorization", `Bearer ${user1AccessToken}`);
      expect(invalidPeriod.status).toBe(400);

      const invalidDate = await request(app)
        .get("/api/v1/leaderboard/history?date=2026-13-45")
        .set("Authorization", `Bearer ${user1AccessToken}`);
      expect(invalidDate.status).toBe(400);

      const conflicting = await request(app)
        .get("/api/v1/leaderboard/history?date=2026-11-14&from=2026-11-01")
        .set("Authorization", `Bearer ${user1AccessToken}`);
      expect(conflicting.status).toBe(400);

      const invalidRange = await request(app)
        .get("/api/v1/leaderboard/history?from=2026-11-15&to=2026-11-10")
        .set("Authorization", `Bearer ${user1AccessToken}`);
      expect(invalidRange.status).toBe(400);
    });

    test("returns historical entries for an exact snapshot date ordered by rank", async () => {
      const dateString = snapshotDate.toISOString().slice(0, 10);
      const response = await request(app)
        .get(`/api/v1/leaderboard/history?period=MONTHLY&date=${dateString}`)
        .set("Authorization", `Bearer ${user1AccessToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      const { leaderboard, pagination } = response.body.data;
      expect(pagination.total).toBe(3);
      expect(leaderboard).toHaveLength(3);
      expect(leaderboard.map((e) => e.rank)).toEqual([1, 2, 3]);
      expect(leaderboard[0].userId).toBe(user1Id);
    });

    test("returns entries across date range ordered by snapshotDate desc, rank asc with pagination", async () => {
      const olderDate = new Date(Date.UTC(2025, 0, 1));
      const newerDate = new Date(Date.UTC(2025, 0, 2));

      const olderSnapshot = await prisma.leaderboardSnapshot.create({
        data: {
          scope: "GLOBAL",
          period: "DAILY",
          snapshotDate: olderDate,
        },
      });
      const newerSnapshot = await prisma.leaderboardSnapshot.create({
        data: {
          scope: "GLOBAL",
          period: "DAILY",
          snapshotDate: newerDate,
        },
      });

      await prisma.leaderboardEntry.createMany({
        data: [
          {
            userId: user1Id,
            snapshotId: olderSnapshot.id,
            scope: "GLOBAL",
            period: "DAILY",
            rank: 1,
            totalValue: "10000",
            returnPct: "5.0",
            snapshotDate: olderDate,
          },
          {
            userId: user2Id,
            snapshotId: olderSnapshot.id,
            scope: "GLOBAL",
            period: "DAILY",
            rank: 2,
            totalValue: "9000",
            returnPct: "2.0",
            snapshotDate: olderDate,
          },
          {
            userId: user1Id,
            snapshotId: newerSnapshot.id,
            scope: "GLOBAL",
            period: "DAILY",
            rank: 1,
            totalValue: "12000",
            returnPct: "8.0",
            snapshotDate: newerDate,
          },
          {
            userId: user2Id,
            snapshotId: newerSnapshot.id,
            scope: "GLOBAL",
            period: "DAILY",
            rank: 2,
            totalValue: "11000",
            returnPct: "6.0",
            snapshotDate: newerDate,
          },
        ],
      });

      try {
        const page1 = await request(app)
          .get(
            "/api/v1/leaderboard/history?period=DAILY&from=2025-01-01&to=2025-01-02&page=1&limit=2",
          )
          .set("Authorization", `Bearer ${user1AccessToken}`);

        expect(page1.status).toBe(200);
        expect(page1.body.data.pagination.total).toBe(4);
        expect(page1.body.data.pagination.totalPages).toBe(2);
        expect(page1.body.data.leaderboard).toHaveLength(2);
        // newer date comes first (snapshotDate desc)
        expect(page1.body.data.leaderboard[0].snapshotDate.slice(0, 10)).toBe(
          "2025-01-02",
        );
        expect(page1.body.data.leaderboard[0].rank).toBe(1);
        expect(page1.body.data.leaderboard[1].snapshotDate.slice(0, 10)).toBe(
          "2025-01-02",
        );
        expect(page1.body.data.leaderboard[1].rank).toBe(2);

        const page2 = await request(app)
          .get(
            "/api/v1/leaderboard/history?period=DAILY&from=2025-01-01&to=2025-01-02&page=2&limit=2",
          )
          .set("Authorization", `Bearer ${user1AccessToken}`);

        expect(page2.status).toBe(200);
        expect(page2.body.data.leaderboard).toHaveLength(2);
        expect(page2.body.data.leaderboard[0].snapshotDate.slice(0, 10)).toBe(
          "2025-01-01",
        );
        expect(page2.body.data.leaderboard[0].rank).toBe(1);
        expect(page2.body.data.leaderboard[1].snapshotDate.slice(0, 10)).toBe(
          "2025-01-01",
        );
        expect(page2.body.data.leaderboard[1].rank).toBe(2);
      } finally {
        await prisma.leaderboardSnapshot.deleteMany({
          where: {
            id: { in: [olderSnapshot.id, newerSnapshot.id] },
          },
        });
      }
    });

    test("preserves stored ranks verbatim with gaps when suspended users are filtered", async () => {
      const dateString = snapshotDate.toISOString().slice(0, 10);

      try {
        await prisma.user.update({
          where: { id: user2Id },
          data: { isSuspended: true },
        });

        const response = await request(app)
          .get(`/api/v1/leaderboard/history?period=MONTHLY&date=${dateString}`)
          .set("Authorization", `Bearer ${user1AccessToken}`);

        expect(response.status).toBe(200);
        const { leaderboard, pagination } = response.body.data;
        expect(pagination.total).toBe(2);
        expect(leaderboard).toHaveLength(2);

        // User 2 (rank 2) is omitted; ranks 1 and 3 are preserved verbatim with a gap!
        expect(leaderboard.map((e) => e.userId)).toEqual([user1Id, user3Id]);
        expect(leaderboard.map((e) => e.rank)).toEqual([1, 3]);
      } finally {
        await prisma.user.update({
          where: { id: user2Id },
          data: { isSuspended: false },
        });
      }
    });

    test("defaults to latest snapshot date when no date or range is provided", async () => {
      const defaultDate = new Date("2099-01-01T00:00:00.000Z");
      const testSnapshot = await prisma.leaderboardSnapshot.create({
        data: {
          scope: "GLOBAL",
          period: "ALL_TIME",
          snapshotDate: defaultDate,
        },
      });

      await prisma.leaderboardEntry.create({
        data: {
          userId: user1Id,
          snapshotId: testSnapshot.id,
          scope: "GLOBAL",
          period: "ALL_TIME",
          rank: 1,
          totalValue: "15000",
          returnPct: "15.0",
          snapshotDate: defaultDate,
        },
      });

      try {
        const response = await request(app)
          .get("/api/v1/leaderboard/history")
          .set("Authorization", `Bearer ${user1AccessToken}`);

        expect(response.status).toBe(200);
        expect(response.body.data.leaderboard.length).toBeGreaterThan(0);
        expect(response.body.data.leaderboard[0].rank).toBe(1);
        expect(response.body.data.leaderboard[0].period).toBe("ALL_TIME");
      } finally {
        await prisma.leaderboardSnapshot.deleteMany({
          where: { id: testSnapshot.id },
        });
      }
    });
  });
});
