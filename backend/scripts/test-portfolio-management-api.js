/**
 * Execution Task 6 — Portfolio management API verification.
 *
 * Exercises the three portfolio management endpoints end to end through the
 * real Express router, middleware and error handler, against the LOCAL database:
 *
 *   GET    /api/v1/portfolios/:portfolioId   (detail)
 *   PATCH  /api/v1/portfolios/:portfolioId   (update)
 *   DELETE /api/v1/portfolios/:portfolioId   (soft deactivate)
 *
 * Covered:
 *   1. unauthenticated requests are rejected
 *   2. invalid (non-UUID) portfolio ids -> 400 VALIDATION_ERROR
 *   3. nonexistent portfolio -> 404 PORTFOLIO_NOT_FOUND
 *   4. ownership isolation (another user's portfolio is invisible)
 *   5. detail success + exact response shape
 *   6. valid updates (name, description, description-only)
 *   7. invalid updates -> 400 VALIDATION_ERROR
 *   8. duplicate name -> 409 PORTFOLIO_NAME_EXISTS
 *   9. unsafe/protected fields are ignored
 *  10. default/Main portfolio cannot be deleted -> 409 PORTFOLIO_DEFAULT
 *  11. delete deactivates without corrupting related holdings/orders
 *
 * Run with: node scripts/test-portfolio-management-api.js
 */

const { randomUUID } = require("crypto");
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

const EXPECTED_PORTFOLIO_KEYS = [
  "id",
  "userId",
  "name",
  "description",
  "startingBalance",
  "cashBalance",
  "isDefault",
  "isActive",
  "createdAt",
  "updatedAt",
];

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertPortfolioShape(portfolio) {
  assert(portfolio && typeof portfolio === "object", "Missing portfolio object.");

  const keys = Object.keys(portfolio).sort();

  assert(
    JSON.stringify(keys) === JSON.stringify([...EXPECTED_PORTFOLIO_KEYS].sort()),
    `Unexpected portfolio keys: ${JSON.stringify(keys)}`,
  );
}

function assertErrorEnvelope(response, status, code) {
  assert(
    response.status === status,
    `Expected ${status}, got ${response.status}: ${JSON.stringify(response.body)}`,
  );
  assert(
    response.body.success === false,
    `Expected success=false: ${JSON.stringify(response.body)}`,
  );
  assert(
    response.body.error?.code === code,
    `Expected code ${code}, got ${JSON.stringify(response.body.error)}`,
  );
}

function authed(method, token, path) {
  return request(app)
    [method](path)
    .set("Authorization", `Bearer ${token}`);
}

async function registerUser(name, email) {
  const response = await request(app).post("/api/v1/auth/register").send({
    name,
    email,
    password: "PortfolioTest#2026",
  });

  if (response.status !== 201) {
    console.dir(response.body, { depth: null });
    throw new Error(`Registration failed for ${email}.`);
  }

  return {
    accessToken: response.body.data.accessToken,
    userId: response.body.data.user.id,
  };
}

async function createPortfolio(token, name, description) {
  const response = await authed("post", token, "/api/v1/portfolios").send({
    name,
    description,
  });

  if (response.status !== 201) {
    console.dir(response.body, { depth: null });
    throw new Error(`Unable to create portfolio "${name}".`);
  }

  return response.body.data.portfolio;
}

async function main() {
  const suffix = Date.now();

  let userA = null;
  let userB = null;

  try {
    console.log("Starting portfolio management API test...\n");

    const validId = randomUUID();

    // --------------------------------------------------
    // 1. Unauthenticated requests
    // --------------------------------------------------

    assertErrorEnvelope(
      await request(app).get(`/api/v1/portfolios/${validId}`),
      401,
      "UNAUTHORIZED",
    );
    assertErrorEnvelope(
      await request(app)
        .patch(`/api/v1/portfolios/${validId}`)
        .send({ name: "Nope" }),
      401,
      "UNAUTHORIZED",
    );
    assertErrorEnvelope(
      await request(app).delete(`/api/v1/portfolios/${validId}`),
      401,
      "UNAUTHORIZED",
    );

    console.log("✓ Unauthenticated GET/PATCH/DELETE return 401 UNAUTHORIZED");

    // --------------------------------------------------
    // 2. Create users
    // --------------------------------------------------

    userA = await registerUser("Portfolio User A", `pm-a-${suffix}@stox.local`);
    userB = await registerUser("Portfolio User B", `pm-b-${suffix}@stox.local`);

    const mainA = await prisma.portfolio.findFirst({
      where: { userId: userA.userId, isDefault: true },
    });

    assert(mainA, "User A has no default portfolio.");

    console.log("✓ Test users A and B registered (each with a Main Portfolio)");

    // --------------------------------------------------
    // 3. Invalid portfolio id (non-UUID)
    // --------------------------------------------------

    assertErrorEnvelope(
      await authed("get", userA.accessToken, "/api/v1/portfolios/not-a-uuid"),
      400,
      "VALIDATION_ERROR",
    );
    assertErrorEnvelope(
      await authed("patch", userA.accessToken, "/api/v1/portfolios/not-a-uuid").send({
        name: "Whatever",
      }),
      400,
      "VALIDATION_ERROR",
    );
    assertErrorEnvelope(
      await authed("delete", userA.accessToken, "/api/v1/portfolios/not-a-uuid"),
      400,
      "VALIDATION_ERROR",
    );

    console.log("✓ Invalid portfolio ids return 400 VALIDATION_ERROR");

    // --------------------------------------------------
    // 4. Nonexistent portfolio (valid UUID)
    // --------------------------------------------------

    const ghostId = randomUUID();

    assertErrorEnvelope(
      await authed("get", userA.accessToken, `/api/v1/portfolios/${ghostId}`),
      404,
      "PORTFOLIO_NOT_FOUND",
    );
    assertErrorEnvelope(
      await authed("patch", userA.accessToken, `/api/v1/portfolios/${ghostId}`).send({
        name: "Ghost",
      }),
      404,
      "PORTFOLIO_NOT_FOUND",
    );
    assertErrorEnvelope(
      await authed("delete", userA.accessToken, `/api/v1/portfolios/${ghostId}`),
      404,
      "PORTFOLIO_NOT_FOUND",
    );

    console.log("✓ Nonexistent portfolio returns 404 PORTFOLIO_NOT_FOUND");

    // --------------------------------------------------
    // 5. Prepare test portfolios
    // --------------------------------------------------

    const growth = await createPortfolio(
      userA.accessToken,
      "Growth",
      "Initial description",
    );

    assert(growth.isActive === true, "New portfolio should be active.");
    assert(growth.isDefault === false, "New portfolio should not be default.");

    await createPortfolio(userB.accessToken, "B Only", "User B portfolio");

    console.log("✓ Test portfolios created");

    // --------------------------------------------------
    // 6. Ownership isolation
    // --------------------------------------------------

    assertErrorEnvelope(
      await authed("get", userB.accessToken, `/api/v1/portfolios/${growth.id}`),
      404,
      "PORTFOLIO_NOT_FOUND",
    );
    assertErrorEnvelope(
      await authed("patch", userB.accessToken, `/api/v1/portfolios/${growth.id}`).send({
        name: "Stolen",
      }),
      404,
      "PORTFOLIO_NOT_FOUND",
    );
    assertErrorEnvelope(
      await authed("delete", userB.accessToken, `/api/v1/portfolios/${growth.id}`),
      404,
      "PORTFOLIO_NOT_FOUND",
    );

    const growthAfterB = await prisma.portfolio.findUnique({
      where: { id: growth.id },
    });

    assert(
      growthAfterB.userId === userA.userId,
      "Ownership check failed: portfolio changed owner.",
    );
    assert(growthAfterB.name === "Growth", "User B was able to rename the portfolio.");
    assert(growthAfterB.isActive === true, "User B was able to deactivate the portfolio.");

    console.log("✓ Another user's portfolio is invisible (404) and untouched");

    // --------------------------------------------------
    // 7. Detail success + shape
    // --------------------------------------------------

    const detail = await authed(
      "get",
      userA.accessToken,
      `/api/v1/portfolios/${growth.id}`,
    );

    assert(detail.status === 200, `Expected 200, got ${detail.status}`);

    const detailPortfolio = detail.body.data?.portfolio;
    assertPortfolioShape(detailPortfolio);

    assert(detailPortfolio.id === growth.id, "Detail returned the wrong portfolio.");
    assert(detailPortfolio.userId === userA.userId, "Detail returned the wrong owner.");
    assert(detailPortfolio.name === "Growth", "Detail returned the wrong name.");
    assert(
      detailPortfolio.description === "Initial description",
      "Detail returned the wrong description.",
    );
    assert(
      detailPortfolio.startingBalance === "10000",
      `Expected startingBalance "10000", got "${detailPortfolio.startingBalance}"`,
    );
    assert(
      detailPortfolio.cashBalance === "10000",
      `Expected cashBalance "10000", got "${detailPortfolio.cashBalance}"`,
    );

    console.log("✓ Portfolio detail returns one owned portfolio with the expected shape");

    // --------------------------------------------------
    // 8. Valid updates
    // --------------------------------------------------

    const renamed = await authed(
      "patch",
      userA.accessToken,
      `/api/v1/portfolios/${growth.id}`,
    ).send({ name: "Growth Renamed", description: "Updated description" });

    assert(renamed.status === 200, `Expected 200, got ${renamed.status}`);
    assert(renamed.body.success === true, "Update must return success=true.");
    assert(
      renamed.body.data?.portfolio?.name === "Growth Renamed",
      "Update did not apply the new name.",
    );
    assert(
      renamed.body.data?.portfolio?.description === "Updated description",
      "Update did not apply the new description.",
    );

    const persisted = await prisma.portfolio.findUnique({
      where: { id: growth.id },
    });
    assert(persisted.name === "Growth Renamed", "Name was not persisted.");

    const descriptionOnly = await authed(
      "patch",
      userA.accessToken,
      `/api/v1/portfolios/${growth.id}`,
    ).send({ description: "Description only" });

    assert(descriptionOnly.status === 200, "Description-only update failed.");
    assert(
      descriptionOnly.body.data?.portfolio?.name === "Growth Renamed",
      "Description-only update unexpectedly changed the name.",
    );
    assert(
      descriptionOnly.body.data?.portfolio?.description === "Description only",
      "Description-only update did not apply.",
    );

    const cleared = await authed(
      "patch",
      userA.accessToken,
      `/api/v1/portfolios/${growth.id}`,
    ).send({ description: null });

    assert(cleared.status === 200, "Clearing the description failed.");
    assert(
      cleared.body.data?.portfolio?.description === null,
      "Description was not cleared to null.",
    );

    console.log("✓ Valid portfolio updates work and persist");

    // --------------------------------------------------
    // 9. Invalid updates
    // --------------------------------------------------

    assertErrorEnvelope(
      await authed("patch", userA.accessToken, `/api/v1/portfolios/${growth.id}`).send({}),
      400,
      "VALIDATION_ERROR",
    );
    assertErrorEnvelope(
      await authed("patch", userA.accessToken, `/api/v1/portfolios/${growth.id}`).send({
        name: "   ",
      }),
      400,
      "VALIDATION_ERROR",
    );
    assertErrorEnvelope(
      await authed("patch", userA.accessToken, `/api/v1/portfolios/${growth.id}`).send({
        name: "x".repeat(101),
      }),
      400,
      "VALIDATION_ERROR",
    );
    assertErrorEnvelope(
      await authed("patch", userA.accessToken, `/api/v1/portfolios/${growth.id}`).send({
        description: 12345,
      }),
      400,
      "VALIDATION_ERROR",
    );

    console.log("✓ Invalid updates return 400 VALIDATION_ERROR");

    // --------------------------------------------------
    // 10. Duplicate portfolio name
    // --------------------------------------------------

    assertErrorEnvelope(
      await authed("patch", userA.accessToken, `/api/v1/portfolios/${growth.id}`).send({
        name: "Main Portfolio",
      }),
      409,
      "PORTFOLIO_NAME_EXISTS",
    );

    const afterDuplicate = await prisma.portfolio.findUnique({
      where: { id: growth.id },
    });
    assert(
      afterDuplicate.name === "Growth Renamed",
      "Duplicate-name update was applied anyway.",
    );

    console.log("✓ Duplicate portfolio name returns 409 PORTFOLIO_NAME_EXISTS");

    // --------------------------------------------------
    // 11. Unsafe/protected fields are ignored
    // --------------------------------------------------

    const unsafeAttempt = await authed(
      "patch",
      userA.accessToken,
      `/api/v1/portfolios/${growth.id}`,
    ).send({
      name: "Safe Name",
      userId: userB.userId,
      startingBalance: "1",
      cashBalance: "1",
      isDefault: true,
      isActive: false,
    });

    assert(unsafeAttempt.status === 200, "Update with extra fields should still succeed.");

    const afterUnsafe = await prisma.portfolio.findUnique({
      where: { id: growth.id },
    });

    assert(afterUnsafe.name === "Safe Name", "The allowed name field was not applied.");
    assert(afterUnsafe.userId === userA.userId, "userId must not be updatable.");
    assert(
      afterUnsafe.startingBalance.toString() === "10000",
      "startingBalance must not be updatable.",
    );
    assert(
      afterUnsafe.cashBalance.toString() === "10000",
      "cashBalance must not be updatable.",
    );
    assert(afterUnsafe.isDefault === false, "isDefault must not be updatable.");
    assert(afterUnsafe.isActive === true, "isActive must not be updatable via PATCH.");

    console.log("✓ Unsafe/protected fields cannot be updated via PATCH");

    // --------------------------------------------------
    // 12. Protected default portfolio deletion
    // --------------------------------------------------

    assertErrorEnvelope(
      await authed("delete", userA.accessToken, `/api/v1/portfolios/${mainA.id}`),
      409,
      "PORTFOLIO_DEFAULT",
    );

    const mainAfterDelete = await prisma.portfolio.findUnique({
      where: { id: mainA.id },
    });
    assert(mainAfterDelete.isActive === true, "The default portfolio was deactivated.");

    // Another user cannot even see it (ownership wins over the default rule).
    assertErrorEnvelope(
      await authed("delete", userB.accessToken, `/api/v1/portfolios/${mainA.id}`),
      404,
      "PORTFOLIO_NOT_FOUND",
    );

    console.log("✓ Default/Main portfolio cannot be deleted (409 PORTFOLIO_DEFAULT)");

    // --------------------------------------------------
    // 13. Valid delete (soft deactivate) + data integrity
    // --------------------------------------------------

    await prisma.holding.create({
      data: {
        portfolioId: growth.id,
        symbol: "AAPL",
        assetType: "STOCK",
        quantity: "3",
        averageBuyPrice: "100",
        totalInvested: "300",
      },
    });

    const order = await prisma.order.create({
      data: {
        portfolioId: growth.id,
        symbol: "AAPL",
        assetType: "STOCK",
        side: "BUY",
        type: "MARKET",
        status: "EXECUTED",
        quantity: "3",
        executedPrice: "100",
        executedAt: new Date(),
      },
    });

    const deleted = await authed(
      "delete",
      userA.accessToken,
      `/api/v1/portfolios/${growth.id}`,
    );

    assert(deleted.status === 200, `Expected 200, got ${deleted.status}`);
    assert(deleted.body.success === true, "Delete must return success=true.");
    assertPortfolioShape(deleted.body.data?.portfolio);
    assert(
      deleted.body.data.portfolio.isActive === false,
      "Deleted portfolio should report isActive=false.",
    );

    const afterDelete = await prisma.portfolio.findUnique({
      where: { id: growth.id },
    });
    assert(afterDelete !== null, "Delete removed the row instead of deactivating it.");
    assert(afterDelete.isActive === false, "Portfolio was not deactivated in the database.");

    const holdingCount = await prisma.holding.count({
      where: { portfolioId: growth.id },
    });
    const orderCount = await prisma.order.count({ where: { id: order.id } });

    assert(holdingCount === 1, "Deleting a portfolio corrupted its holdings.");
    assert(orderCount === 1, "Deleting a portfolio corrupted its orders.");

    console.log("✓ Delete soft-deactivates without corrupting related holdings/orders");

    // --------------------------------------------------
    // 14. Delete is idempotent
    // --------------------------------------------------

    const deletedAgain = await authed(
      "delete",
      userA.accessToken,
      `/api/v1/portfolios/${growth.id}`,
    );

    assert(deletedAgain.status === 200, "Repeated delete should be idempotent.");
    assert(
      deletedAgain.body.data?.portfolio?.isActive === false,
      "Repeated delete returned an active portfolio.",
    );

    console.log("✓ Repeated delete is idempotent");

    // --------------------------------------------------
    // 15. Regression: list still returns portfolios
    // --------------------------------------------------

    const list = await authed("get", userA.accessToken, "/api/v1/portfolios");

    assert(list.status === 200, `Expected 200 from list, got ${list.status}`);
    assert(Array.isArray(list.body.data?.portfolios), "List did not return an array.");

    const listedGrowth = list.body.data.portfolios.find((item) => item.id === growth.id);
    assert(listedGrowth, "Deactivated portfolio disappeared from the list.");
    assert(
      listedGrowth.isActive === false,
      "List did not reflect the deactivated state.",
    );

    console.log("✓ Portfolio list still works and reflects the deactivated state");

    // --------------------------------------------------
    // 16. Sensitive field leak check
    // --------------------------------------------------

    const serialized = JSON.stringify(list.body);
    for (const forbidden of ["passwordHash", "googleId", "pushToken", "refreshTokens"]) {
      assert(
        !serialized.includes(forbidden),
        `Portfolio response leaked sensitive field: ${forbidden}`,
      );
    }

    console.log("✓ No sensitive user fields leaked");

    console.log("\nPORTFOLIO MANAGEMENT API TEST PASSED");
  } catch (error) {
    console.error("\nPORTFOLIO MANAGEMENT API TEST FAILED");
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    try {
      const ids = [userA?.userId, userB?.userId].filter(Boolean);

      if (ids.length > 0) {
        await prisma.user.deleteMany({ where: { id: { in: ids } } });
      }
    } catch (cleanupError) {
      console.error(`Cleanup failed: ${cleanupError.message}`);
      process.exitCode = 1;
    }

    await prisma.$disconnect();
  }
}

main();
