/**
 * Execution Task 5 — User statistics API verification.
 *
 * Exercises GET /api/v1/users/me/statistics end to end through the real
 * Express router, middleware and error handler, against the LOCAL database:
 *
 *   1. unauthenticated request is rejected
 *   2. invalid token is rejected
 *   3. authenticated user with no trades gets a stable zeroed shape
 *   4. statistics are computed correctly from the caller's trades
 *   5. user data isolation (user A never sees user B's trades)
 *   6. no sensitive user fields are leaked
 *   7. suspended account -> 403 (expected error handling)
 *   8. deleted account -> 404 (expected error handling)
 *
 * Run with: node scripts/test-user-statistics-api.js
 */

const express = require("express");
const request = require("supertest");

const authRoutes = require("../src/routes/authRoutes");
const userRoutes = require("../src/routes/userRoutes");
const errorHandler = require("../src/middleware/errorHandler");
const prisma = require("../src/config/database");

const app = express();

app.use(express.json());
app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/users", userRoutes);
app.use(errorHandler);

const EXPECTED_STATISTIC_KEYS = [
  "totalTrades",
  "winningTrades",
  "losingTrades",
  "winRate",
  "totalVolume",
  "averageReturn",
  "bestTrade",
  "worstTrade",
];

const TRADE_SUMMARY_KEYS = ["symbol", "realizedPnl", "realizedPnlPct"];

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertStatisticsShape(statistics) {
  assert(
    statistics && typeof statistics === "object",
    "Response did not include data.statistics.",
  );

  const keys = Object.keys(statistics).sort();

  assert(
    JSON.stringify(keys) === JSON.stringify([...EXPECTED_STATISTIC_KEYS].sort()),
    `Unexpected statistics keys: ${JSON.stringify(keys)}`,
  );
}

function assertTradeSummary(summary, label) {
  assert(summary && typeof summary === "object", `${label} is missing.`);

  const keys = Object.keys(summary).sort();

  assert(
    JSON.stringify(keys) === JSON.stringify([...TRADE_SUMMARY_KEYS].sort()),
    `Unexpected ${label} keys: ${JSON.stringify(keys)}`,
  );
}

async function registerUser(name, email) {
  const response = await request(app).post("/api/v1/auth/register").send({
    name,
    email,
    password: "StatisticsTest#2026",
  });

  if (response.status !== 201) {
    console.dir(response.body, { depth: null });
    throw new Error(`Registration failed for ${email}.`);
  }

  const accessToken = response.body.data?.accessToken;
  const userId = response.body.data?.user?.id;

  assert(accessToken, "Registration did not return an access token.");
  assert(userId, "Registration did not return a user id.");

  return { accessToken, userId };
}

async function createTrade({
  portfolioId,
  symbol,
  side = "BUY",
  quantity = "1",
  price = "100",
  totalValue,
  realizedPnl = null,
  realizedPnlPct = null,
}) {
  const order = await prisma.order.create({
    data: {
      portfolioId,
      symbol,
      assetType: "STOCK",
      side,
      type: "MARKET",
      status: "EXECUTED",
      quantity,
      executedPrice: price,
      executedAt: new Date(),
    },
  });

  await prisma.trade.create({
    data: {
      portfolioId,
      orderId: order.id,
      symbol,
      assetType: "STOCK",
      side,
      quantity,
      price,
      totalValue,
      fees: "0",
      realizedPnl,
      realizedPnlPct,
    },
  });
}

async function fetchStatistics(accessToken) {
  return request(app)
    .get("/api/v1/users/me/statistics")
    .set("Authorization", `Bearer ${accessToken}`);
}

async function main() {
  const suffix = Date.now();

  let userA = null;
  let userB = null;
  let userBDeleted = false;

  try {
    console.log("Starting user statistics API test...\n");

    // --------------------------------------------------
    // 1. Unauthenticated request
    // --------------------------------------------------

    const noAuth = await request(app).get("/api/v1/users/me/statistics");

    assert(
      noAuth.status === 401,
      `Expected 401 without auth, got ${noAuth.status}: ${JSON.stringify(noAuth.body)}`,
    );
    assert(noAuth.body.success === false, "Error response must have success=false.");
    assert(
      noAuth.body.error?.code === "UNAUTHORIZED",
      `Expected UNAUTHORIZED, got ${JSON.stringify(noAuth.body.error)}`,
    );

    console.log("✓ Unauthenticated request returns 401 UNAUTHORIZED");

    // --------------------------------------------------
    // 2. Invalid token
    // --------------------------------------------------

    const invalidToken = await fetchStatistics("definitely-not-a-valid-token");

    assert(
      invalidToken.status === 401,
      `Expected 401 for invalid token, got ${invalidToken.status}`,
    );
    assert(
      invalidToken.body.error?.code === "INVALID_ACCESS_TOKEN",
      `Expected INVALID_ACCESS_TOKEN, got ${JSON.stringify(invalidToken.body.error)}`,
    );

    console.log("✓ Invalid token returns 401 INVALID_ACCESS_TOKEN");

    // --------------------------------------------------
    // 3. Create test users (registration also creates Main Portfolio)
    // --------------------------------------------------

    userA = await registerUser(
      "Statistics User A",
      `stats-a-${suffix}@stox.local`,
    );
    userB = await registerUser(
      "Statistics User B",
      `stats-b-${suffix}@stox.local`,
    );

    const portfolioA = await prisma.portfolio.findFirst({
      where: { userId: userA.userId },
    });
    const portfolioB = await prisma.portfolio.findFirst({
      where: { userId: userB.userId },
    });

    assert(portfolioA, "User A has no portfolio to attach trades to.");
    assert(portfolioB, "User B has no portfolio to attach trades to.");

    console.log("✓ Test users A and B registered");

    // --------------------------------------------------
    // 4. Authenticated user with no trades
    // --------------------------------------------------

    const emptyResponse = await fetchStatistics(userA.accessToken);

    assert(
      emptyResponse.status === 200,
      `Expected 200 for authenticated request, got ${emptyResponse.status}`,
    );
    assert(
      emptyResponse.body.success === true,
      "Success response must have success=true.",
    );

    const emptyStats = emptyResponse.body.data?.statistics;
    assertStatisticsShape(emptyStats);

    assert(emptyStats.totalTrades === 0, "Expected totalTrades 0.");
    assert(emptyStats.winningTrades === 0, "Expected winningTrades 0.");
    assert(emptyStats.losingTrades === 0, "Expected losingTrades 0.");
    assert(emptyStats.winRate === 0, "Expected winRate 0.");
    assert(emptyStats.totalVolume === "0", "Expected totalVolume \"0\".");
    assert(
      emptyStats.averageReturn === null,
      "Expected averageReturn null with no trades.",
    );
    assert(emptyStats.bestTrade === null, "Expected bestTrade null.");
    assert(emptyStats.worstTrade === null, "Expected worstTrade null.");

    console.log("✓ Authenticated user with no trades gets a stable zeroed shape");

    // --------------------------------------------------
    // 5. Seed user A trades
    //     2 winners, 1 loser, 1 break-even, 1 open (no realized P&L)
    // --------------------------------------------------

    await createTrade({
      portfolioId: portfolioA.id,
      symbol: "AAPL",
      totalValue: "1000",
      realizedPnl: "200",
      realizedPnlPct: "10",
    });
    await createTrade({
      portfolioId: portfolioA.id,
      symbol: "MSFT",
      totalValue: "2000",
      realizedPnl: "500",
      realizedPnlPct: "20",
    });
    await createTrade({
      portfolioId: portfolioA.id,
      symbol: "TSLA",
      side: "SELL",
      totalValue: "1500",
      realizedPnl: "-300",
      realizedPnlPct: "-8",
    });
    await createTrade({
      portfolioId: portfolioA.id,
      symbol: "NVDA",
      totalValue: "500",
      realizedPnl: "0",
      realizedPnlPct: "0",
    });
    await createTrade({
      portfolioId: portfolioA.id,
      symbol: "AMZN",
      totalValue: "400",
    });

    console.log("✓ Seeded 5 trades for user A");

    const statsA = (await fetchStatistics(userA.accessToken)).body.data
      ?.statistics;

    assertStatisticsShape(statsA);

    assert(statsA.totalTrades === 5, `Expected totalTrades 5, got ${statsA.totalTrades}`);
    assert(statsA.winningTrades === 2, `Expected winningTrades 2, got ${statsA.winningTrades}`);
    assert(statsA.losingTrades === 1, `Expected losingTrades 1, got ${statsA.losingTrades}`);
    assert(
      statsA.winRate === 0.6667,
      `Expected winRate 0.6667, got ${statsA.winRate}`,
    );
    assert(
      Number(statsA.totalVolume) === 5400,
      `Expected totalVolume 5400, got ${statsA.totalVolume}`,
    );
    assert(
      Number(statsA.averageReturn) === 5.5,
      `Expected averageReturn 5.5 (NULLs excluded), got ${statsA.averageReturn}`,
    );

    assertTradeSummary(statsA.bestTrade, "bestTrade");
    assertTradeSummary(statsA.worstTrade, "worstTrade");
    assert(
      statsA.bestTrade.symbol === "MSFT",
      `Expected bestTrade MSFT, got ${statsA.bestTrade.symbol}`,
    );
    assert(
      Number(statsA.bestTrade.realizedPnl) === 500,
      `Expected bestTrade.realizedPnl 500, got ${statsA.bestTrade.realizedPnl}`,
    );
    assert(
      statsA.worstTrade.symbol === "TSLA",
      `Expected worstTrade TSLA, got ${statsA.worstTrade.symbol}`,
    );
    assert(
      Number(statsA.worstTrade.realizedPnl) === -300,
      `Expected worstTrade.realizedPnl -300, got ${statsA.worstTrade.realizedPnl}`,
    );

    console.log("✓ User A statistics computed correctly from Trade data");

    // --------------------------------------------------
    // 6. Seed user B trades (different values, for isolation)
    // --------------------------------------------------

    await createTrade({
      portfolioId: portfolioB.id,
      symbol: "BTCUSDT",
      totalValue: "300",
      realizedPnl: "-50",
      realizedPnlPct: "-5",
    });
    await createTrade({
      portfolioId: portfolioB.id,
      symbol: "ETHUSDT",
      totalValue: "700",
      realizedPnl: "150",
      realizedPnlPct: "15",
    });

    const statsB = (await fetchStatistics(userB.accessToken)).body.data
      ?.statistics;

    assertStatisticsShape(statsB);
    assert(statsB.totalTrades === 2, `Expected user B totalTrades 2, got ${statsB.totalTrades}`);
    assert(
      Number(statsB.totalVolume) === 1000,
      `Expected user B totalVolume 1000, got ${statsB.totalVolume}`,
    );
    assert(
      statsB.bestTrade?.symbol === "ETHUSDT",
      `Expected user B bestTrade ETHUSDT, got ${statsB.bestTrade?.symbol}`,
    );

    console.log("✓ User B statistics computed independently");

    // --------------------------------------------------
    // 7. Isolation: user A's numbers must not change
    // --------------------------------------------------

    const statsAAgain = (await fetchStatistics(userA.accessToken)).body.data
      ?.statistics;

    assert(
      statsAAgain.totalTrades === 5,
      `Isolation breach: user A sees ${statsAAgain.totalTrades} trades (expected 5).`,
    );
    assert(
      Number(statsAAgain.totalVolume) === 5400,
      `Isolation breach: user A totalVolume ${statsAAgain.totalVolume} (expected 5400).`,
    );
    assert(
      statsAAgain.bestTrade?.symbol === "MSFT",
      `Isolation breach: user A bestTrade ${statsAAgain.bestTrade?.symbol} (expected MSFT).`,
    );

    console.log("✓ User data isolation holds (A never sees B's trades)");

    // --------------------------------------------------
    // 8. Sensitive fields must not be exposed
    // --------------------------------------------------

    const serialized = JSON.stringify(statsAAgain);

    for (const forbidden of [
      "passwordHash",
      "googleId",
      "pushToken",
      "refreshTokens",
    ]) {
      assert(
        !serialized.includes(forbidden),
        `Statistics response leaked sensitive field: ${forbidden}`,
      );
    }

    console.log("✓ No sensitive user fields leaked");

    // --------------------------------------------------
    // 9. Suspended account -> 403 ACCOUNT_SUSPENDED
    // --------------------------------------------------

    await prisma.user.update({
      where: { id: userA.userId },
      data: { isSuspended: true },
    });

    const suspended = await fetchStatistics(userA.accessToken);

    assert(
      suspended.status === 403,
      `Expected 403 for suspended account, got ${suspended.status}`,
    );
    assert(
      suspended.body.error?.code === "ACCOUNT_SUSPENDED",
      `Expected ACCOUNT_SUSPENDED, got ${JSON.stringify(suspended.body.error)}`,
    );

    await prisma.user.update({
      where: { id: userA.userId },
      data: { isSuspended: false },
    });

    console.log("✓ Suspended account gets 403 ACCOUNT_SUSPENDED");

    // --------------------------------------------------
    // 10. Deleted account -> 404 USER_NOT_FOUND
    // --------------------------------------------------

    await prisma.user.delete({ where: { id: userB.userId } });
    userBDeleted = true;

    const deleted = await fetchStatistics(userB.accessToken);

    assert(
      deleted.status === 404,
      `Expected 404 for deleted account, got ${deleted.status}`,
    );
    assert(
      deleted.body.error?.code === "USER_NOT_FOUND",
      `Expected USER_NOT_FOUND, got ${JSON.stringify(deleted.body.error)}`,
    );

    console.log("✓ Deleted account gets 404 USER_NOT_FOUND");

    console.log("\nUSER STATISTICS API TEST PASSED");
  } catch (error) {
    console.error("\nUSER STATISTICS API TEST FAILED");
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    try {
      const idsToDelete = [];

      if (userA?.userId) idsToDelete.push(userA.userId);
      if (userB?.userId && !userBDeleted) idsToDelete.push(userB.userId);

      if (idsToDelete.length > 0) {
        await prisma.user.deleteMany({ where: { id: { in: idsToDelete } } });
      }
    } catch (cleanupError) {
      console.error(`Cleanup failed: ${cleanupError.message}`);
      process.exitCode = 1;
    }

    await prisma.$disconnect();
  }
}

main();
