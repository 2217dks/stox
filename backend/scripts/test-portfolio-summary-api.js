/**
 * Execution Task 7 — Portfolio summary API verification.
 *
 * Exercises GET /api/v1/portfolios/:portfolioId/summary end to end through the real
 * Express router, middleware and error handler, against the LOCAL database:
 *
 *   1. unauthenticated request is rejected
 *   2. invalid token is rejected
 *   3. malformed portfolio id is rejected by validation
 *   4. authenticated owner gets the portfolio summary shape
 *   5. empty portfolio returns a stable zeroed summary
 *   6. aggregates reflect cash + holdings
 *   7. ownership isolation (user A can never read user B's portfolio)
 *   8. nonexistent portfolio -> 404
 *   9. no sensitive user fields are leaked
 *  10. suspended account -> 403 (expected error handling)
 *  11. deleted account -> 404 (expected error handling)
 *
 * Run with: node scripts/test-portfolio-summary-api.js
 */

const express = require("express");
const request = require("supertest");

const authRoutes = require("../src/routes/authRoutes");
const portfolioRoutes = require("../src/routes/portfolioRoutes");
const errorHandler = require("../src/middleware/errorHandler");
const prisma = require("../src/config/database");

const app = express();

app.use(express.json());
app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/portfolios", portfolioRoutes);
app.use(errorHandler);

const EXPECTED_SUMMARY_KEYS = [
  "id",
  "userId",
  "name",
  "description",
  "startingBalance",
  "cashBalance",
  "isDefault",
  "isActive",
  "holdingsValue",
  "totalValue",
  "holdingsCount",
  "createdAt",
  "updatedAt",
];

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertSummaryShape(portfolio) {
  assert(
    portfolio && typeof portfolio === "object",
    "Response did not include data.portfolio.",
  );

  const keys = Object.keys(portfolio).sort();

  assert(
    JSON.stringify(keys) === JSON.stringify([...EXPECTED_SUMMARY_KEYS].sort()),
    `Unexpected summary keys: ${JSON.stringify(keys)}`,
  );
}

async function registerUser(name, email) {
  const response = await request(app).post("/api/v1/auth/register").send({
    name,
    email,
    password: "SummaryTest#2026",
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

function fetchSummary(portfolioId, accessToken) {
  const req = request(app).get(`/api/v1/portfolios/${portfolioId}/summary`);

  if (accessToken) {
    req.set("Authorization", `Bearer ${accessToken}`);
  }

  return req;
}

async function main() {
  const suffix = Date.now();

  let userA = null;
  let userB = null;
  let userBDeleted = false;

  try {
    console.log("Starting portfolio summary API test...\n");

    // --------------------------------------------------
    // 1. Unauthenticated request
    // --------------------------------------------------

    const noAuth = await request(app).get(
      "/api/v1/portfolios/00000000-0000-0000-0000-000000000000/summary",
    );

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

    const invalidToken = await fetchSummary(
      "00000000-0000-0000-0000-000000000000",
      "definitely-not-a-valid-token",
    );

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
    // 3. Malformed portfolio id
    // --------------------------------------------------

    userA = await registerUser("Summary User A", `summary-a-${suffix}@stox.local`);
    userB = await registerUser("Summary User B", `summary-b-${suffix}@stox.local`);

    const malformed = await fetchSummary("not-a-uuid", userA.accessToken);

    assert(
      malformed.status === 400,
      `Expected 400 for malformed id, got ${malformed.status}`,
    );
    assert(
      malformed.body.error?.code === "VALIDATION_ERROR",
      `Expected VALIDATION_ERROR, got ${JSON.stringify(malformed.body.error)}`,
    );

    console.log("✓ Malformed portfolio id returns 400 VALIDATION_ERROR");

    // --------------------------------------------------
    // 4. Empty portfolio summary
    // --------------------------------------------------

    const portfolioA = await prisma.portfolio.findFirst({
      where: { userId: userA.userId, isDefault: true },
    });
    const portfolioB = await prisma.portfolio.findFirst({
      where: { userId: userB.userId, isDefault: true },
    });

    assert(portfolioA, "User A has no default portfolio.");
    assert(portfolioB, "User B has no default portfolio.");

    const emptyResponse = await fetchSummary(
      portfolioA.id,
      userA.accessToken,
    );

    assert(
      emptyResponse.status === 200,
      `Expected 200, got ${emptyResponse.status}: ${JSON.stringify(emptyResponse.body)}`,
    );
    assert(emptyResponse.body.success === true, "Success must have success=true.");

    const emptySummary = emptyResponse.body.data?.portfolio;
    assertSummaryShape(emptySummary);

    assert(emptySummary.id === portfolioA.id, "Summary returned wrong portfolio.");
    assert(emptySummary.userId === userA.userId, "Summary returned wrong owner.");
    assert(
      emptySummary.holdingsCount === 0,
      `Expected holdingsCount 0, got ${emptySummary.holdingsCount}`,
    );
    assert(
      emptySummary.holdingsValue === "0",
      `Expected holdingsValue "0", got "${emptySummary.holdingsValue}"`,
    );
    assert(
      emptySummary.totalValue === emptySummary.cashBalance,
      `Expected totalValue === cashBalance, got ${emptySummary.totalValue}`,
    );

    console.log("✓ Empty portfolio returns a stable zeroed summary");

    // --------------------------------------------------
    // 5. Aggregates reflect cash + holdings
    // --------------------------------------------------

    await prisma.holding.createMany({
      data: [
        {
          portfolioId: portfolioA.id,
          symbol: "AAPL",
          assetType: "STOCK",
          quantity: "10",
          averageBuyPrice: "150",
          totalInvested: "1500",
          isShort: false,
        },
        {
          portfolioId: portfolioA.id,
          symbol: "ETHUSDT",
          assetType: "CRYPTO",
          quantity: "2",
          averageBuyPrice: "2000",
          totalInvested: "4000",
          isShort: false,
        },
      ],
    });

    await prisma.portfolio.update({
      where: { id: portfolioA.id },
      data: { cashBalance: "4500.50000000" },
    });

    const populated = await fetchSummary(portfolioA.id, userA.accessToken);
    const summary = populated.body.data?.portfolio;

    assertSummaryShape(summary);
    assert(
      summary.holdingsCount === 2,
      `Expected holdingsCount 2, got ${summary.holdingsCount}`,
    );
    assert(
      summary.holdingsValue === "5500",
      `Expected holdingsValue "5500", got "${summary.holdingsValue}"`,
    );
    assert(
      summary.cashBalance === "4500.5",
      `Expected cashBalance "4500.5", got "${summary.cashBalance}"`,
    );
    assert(
      summary.totalValue === "10000.5",
      `Expected totalValue "10000.5", got "${summary.totalValue}"`,
    );

    console.log("✓ Summary aggregates cash and holdings correctly");

    // --------------------------------------------------
    // 6. Ownership isolation
    // --------------------------------------------------

    const crossUser = await fetchSummary(portfolioA.id, userB.accessToken);

    assert(
      crossUser.status === 404,
      `Expected 404 for another user's portfolio, got ${crossUser.status}`,
    );
    assert(
      crossUser.body.error?.code === "PORTFOLIO_NOT_FOUND",
      `Expected PORTFOLIO_NOT_FOUND, got ${JSON.stringify(crossUser.body.error)}`,
    );

    console.log("✓ Portfolio ownership isolation holds");

    // --------------------------------------------------
    // 7. Nonexistent portfolio
    // --------------------------------------------------

    const missing = await fetchSummary(
      "00000000-0000-0000-0000-000000000000",
      userA.accessToken,
    );

    assert(
      missing.status === 404,
      `Expected 404 for nonexistent portfolio, got ${missing.status}`,
    );
    assert(
      missing.body.error?.code === "PORTFOLIO_NOT_FOUND",
      `Expected PORTFOLIO_NOT_FOUND, got ${JSON.stringify(missing.body.error)}`,
    );

    console.log("✓ Nonexistent portfolio returns 404 PORTFOLIO_NOT_FOUND");

    // --------------------------------------------------
    // 8. Sensitive fields must not be exposed
    // --------------------------------------------------

    const serialized = JSON.stringify(summary);

    for (const forbidden of [
      "passwordHash",
      "googleId",
      "pushToken",
      "refreshTokens",
    ]) {
      assert(
        !serialized.includes(forbidden),
        `Summary response leaked sensitive field: ${forbidden}`,
      );
    }

    console.log("✓ No sensitive user fields leaked");

    // --------------------------------------------------
    // 9. Suspended account -> 403
    // --------------------------------------------------

    await prisma.user.update({
      where: { id: userA.userId },
      data: { isSuspended: true },
    });

    const suspended = await fetchSummary(portfolioA.id, userA.accessToken);

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
    // 10. Deleted account -> 404
    // --------------------------------------------------

    await prisma.user.delete({ where: { id: userB.userId } });
    userBDeleted = true;

    const deleted = await fetchSummary(portfolioB.id, userB.accessToken);

    assert(
      deleted.status === 404,
      `Expected 404 for deleted account, got ${deleted.status}`,
    );
    assert(
      deleted.body.error?.code === "USER_NOT_FOUND",
      `Expected USER_NOT_FOUND, got ${JSON.stringify(deleted.body.error)}`,
    );

    console.log("✓ Deleted account gets 404 USER_NOT_FOUND");

    console.log("\nPORTFOLIO SUMMARY API TEST PASSED");
  } catch (error) {
    console.error("\nPORTFOLIO SUMMARY API TEST FAILED");
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
