// ============================================================
// TASK 1 — Notification / Follow / LeaderboardEntry / Post / Alert
//          schema verification
// ============================================================
//
// Exercises the five Task 1 models end to end against the LOCAL,
// migrated database:
//   1. creates all five models (Notification, Follow, LeaderboardEntry,
//      Post, Alert)
//   2. proves duplicate Follow rows are rejected by the unique constraint
//   3. proves cascade deletion when the owning user is removed
//   4. proves the Alert state transition ACTIVE -> TRIGGERED
//   5. proves the Notification read transition isRead false -> true
//      with readAt populated
//   6. proves the LeaderboardEntry uniqueness constraint
//   7. proves an enum value is enforced by the PostgreSQL enum
//   8. removes everything it created
//
// Run from the backend/ directory:  node scripts/test-task1-schema.js

const prisma = require("../src/config/database");

// Tiny assertion helper so a failed check fails the script loudly.
function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function main() {
  console.log("Starting Task 1 schema test...\n");

  // Unique per-run suffix so repeated runs never collide on the unique email.
  const suffix = Date.now();
  const emailA = `task1-a-${suffix}@stox.test`;
  const emailB = `task1-b-${suffix}@stox.test`;

  // Same calendar day for both leaderboard entries so the (scope, period,
  // snapshotDate, userId) unique constraint is the only thing that can fail.
  const snapshotDate = new Date("2026-10-01T00:00:00.000Z");

  let userA;
  let userB;

  try {
    // ----------------------------------------------------------
    // Setup: two users so Follow has a real follower/following pair
    // ----------------------------------------------------------

    userA = await prisma.user.create({
      data: {
        email: emailA,
        name: "Task 1 User A",
        passwordHash: "TEST_ONLY_HASH",
      },
    });

    userB = await prisma.user.create({
      data: {
        email: emailB,
        name: "Task 1 User B",
        passwordHash: "TEST_ONLY_HASH",
      },
    });

    console.log("✓ Users created:", userA.id, userB.id);

    // ----------------------------------------------------------
    // 1. Create all five models
    // ----------------------------------------------------------

    const notification = await prisma.notification.create({
      data: {
        userId: userA.id,
        type: "ORDER_EXECUTED",
        title: "Order executed",
        message: "Your AAPL order has been executed.",
        data: { symbol: "AAPL", quantity: 5 },
      },
    });

    await prisma.follow.create({
      data: {
        followerId: userA.id,
        followingId: userB.id,
      },
    });

    const symbol = await prisma.symbol.upsert({
      where: { symbol: "AAPL" },
      update: {},
      create: {
        symbol: "AAPL",
        name: "Apple Inc.",
        assetType: "STOCK",
        exchange: "NASDAQ",
      },
    });

const alert = await prisma.alert.create({
  data: {
    userId: userA.id,
    symbolId: symbol.id,
    condition: "PRICE_ABOVE",
    targetPrice: "250.5",
  },
});

    await prisma.leaderboardEntry.create({
      data: {
        userId: userA.id,
        scope: "GLOBAL",
        period: "MONTHLY",
        rank: 1,
        totalValue: "12000.5",
        returnPct: "20.05",
        snapshotDate,
      },
    });

    const post = await prisma.post.create({
      data: {
        authorId: userA.id,
        content: "Opened a new AAPL position.",
        symbol: "AAPL",
        metadata: { kind: "trade" },
      },
    });

    console.log(
      "✓ Notification, Follow, Alert, LeaderboardEntry, Post created",
    );

    // Sanity-check the documented column defaults.
    assert(
      notification.isRead === false,
      "notification.isRead should default to false",
    );
    assert(
      notification.readAt === null,
      "notification.readAt should default to null",
    );
    assert(alert.status === "ACTIVE", "alert.status should default to ACTIVE");
    assert(
      alert.sendEmail === true,
      "alert.sendEmail should default to true",
    );
    assert(alert.sendPush === false, "alert.sendPush should default to false");
    assert(post.isHidden === false, "post.isHidden should default to false");

    // ----------------------------------------------------------
    // 2. Duplicate Follow rejection
    // ----------------------------------------------------------

    let duplicateFollowRejected = false;

    try {
      await prisma.follow.create({
        data: {
          followerId: userA.id, // same pair again -> must fail
          followingId: userB.id,
        },
      });
    } catch (error) {
      duplicateFollowRejected = error.code === "P2002";
    }

    assert(
      duplicateFollowRejected,
      "duplicate Follow must be rejected (P2002)",
    );

    console.log("✓ Duplicate Follow rejected by unique constraint");

    // ----------------------------------------------------------
    // 4. Alert state transition: ACTIVE -> TRIGGERED
    // ----------------------------------------------------------

    const triggeredAt = new Date();
    const triggeredAlert = await prisma.alert.update({
      where: { id: alert.id },
      data: { status: "TRIGGERED", triggeredAt },
    });

    assert(
      triggeredAlert.status === "TRIGGERED",
      "alert status should transition ACTIVE -> TRIGGERED",
    );
    assert(
      triggeredAlert.triggeredAt instanceof Date,
      "alert triggeredAt should be populated",
    );

    console.log("✓ Alert transition ACTIVE -> TRIGGERED verified");

    // ----------------------------------------------------------
    // 5. Notification read transition: isRead false -> true + readAt
    // ----------------------------------------------------------

    const readAt = new Date();
    const readNotification = await prisma.notification.update({
      where: { id: notification.id },
      data: { isRead: true, readAt },
    });

    assert(
      readNotification.isRead === true,
      "notification.isRead should become true",
    );
    assert(
      readNotification.readAt instanceof Date,
      "notification.readAt should be populated when read",
    );

    console.log("✓ Notification read transition isRead false -> true verified");

    // ----------------------------------------------------------
    // 6. LeaderboardEntry uniqueness constraint
    // ----------------------------------------------------------

    let duplicateEntryRejected = false;

    try {
      await prisma.leaderboardEntry.create({
        data: {
          userId: userA.id,
          scope: "GLOBAL", // same (scope, period, snapshotDate, userId)
          period: "MONTHLY",
          rank: 2,
          totalValue: "1",
          returnPct: "1",
          snapshotDate,
        },
      });
    } catch (error) {
      duplicateEntryRejected = error.code === "P2002";
    }

    assert(
      duplicateEntryRejected,
      "duplicate LeaderboardEntry must be rejected (P2002)",
    );

    console.log("✓ LeaderboardEntry uniqueness enforced");

    // ----------------------------------------------------------
    // 7. Enum validation
    //    `type` is a real PostgreSQL enum, so the database rejects
    //    values outside the NotificationType set.
    // ----------------------------------------------------------

    let enumRejected = false;

    try {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "Notification"
           ("id", "userId", "type", "title", "message", "isRead", "createdAt")
         VALUES ($1, $2, 'NOT_A_REAL_TYPE', 'Bad enum', 'Bad enum', false, now())`,
        `bad-enum-${suffix}`,
        userA.id,
      );
    } catch (error) {
      enumRejected = /invalid input value for enum/i.test(String(error.message));
    }

    assert(enumRejected, "invalid NotificationType must be rejected by the enum");

    console.log("✓ NotificationType enum enforced at the database level");

    // ----------------------------------------------------------
    // 3. Cascade deletion
    //    Removing the owning user must remove every owned Task 1 row.
    // ----------------------------------------------------------

    await prisma.user.delete({ where: { id: userA.id } });

    const remaining = {
      notifications: await prisma.notification.count({
        where: { userId: userA.id },
      }),
      alerts: await prisma.alert.count({ where: { userId: userA.id } }),
      leaderboardEntries: await prisma.leaderboardEntry.count({
        where: { userId: userA.id },
      }),
      posts: await prisma.post.count({ where: { authorId: userA.id } }),
      follows: await prisma.follow.count({ where: { followerId: userA.id } }),
    };

    assert(
      Object.values(remaining).every((count) => count === 0),
      `cascade delete should remove all owned rows, got ${JSON.stringify(remaining)}`,
    );

    // Reassign userA so the finally block does not retry the delete.
    userA = null;

    console.log(
      "✓ Cascade deletion removed Notification, Alert, LeaderboardEntry, Post, Follow",
    );
  } finally {
    // ----------------------------------------------------------
    // 8. Clean up everything this script created
    // ----------------------------------------------------------

    if (userA) {
      await prisma.user.delete({ where: { id: userA.id } }).catch(() => {});
    }

    if (userB) {
      await prisma.user.delete({ where: { id: userB.id } }).catch(() => {});
    }

    console.log("✓ Test data cleaned up");
  }

  console.log("\nTASK 1 SCHEMA DATABASE TEST PASSED");
}

main()
  .catch((error) => {
    console.error("\nTASK 1 SCHEMA DATABASE TEST FAILED");
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
