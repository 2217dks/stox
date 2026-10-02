const prisma = require("../src/config/database");

const API_BASE_URL = "http://localhost:8000/api/v1";

const timestamp = Date.now();

const user1 = {
  name: "Portfolio List Test User 1",
  email: `portfolio-list-test-1-${timestamp}@example.com`,
  password: "PortfolioTest#2026",
};

const user2 = {
  name: "Portfolio List Test User 2",
  email: `portfolio-list-test-2-${timestamp}@example.com`,
  password: "PortfolioTest#2026",
};

async function apiRequest(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  let body = null;

  try {
    body = await response.json();
  } catch {
    body = null;
  }

  return {
    status: response.status,
    body,
  };
}

async function registerUser(user) {
  const result = await apiRequest("/auth/register", {
    method: "POST",
    body: JSON.stringify({
      name: user.name,
      email: user.email,
      password: user.password,
    }),
  });

  if (result.status !== 200 && result.status !== 201) {
    throw new Error(
      `Registration failed for ${user.email}: ${JSON.stringify(result.body)}`,
    );
  }

  const accessToken = result.body?.data?.accessToken;
  const userId = result.body?.data?.user?.id;

  if (!accessToken || !userId) {
    throw new Error(
      `Registration response missing accessToken/user: ${JSON.stringify(
        result.body,
      )}`,
    );
  }

  return {
    accessToken,
    userId,
  };
}

async function cleanupUser(userId) {
  if (!userId) return;

  await prisma.refreshToken.deleteMany({
    where: { userId },
  });

  await prisma.portfolio.deleteMany({
    where: { userId },
  });

  await prisma.user.delete({
    where: { id: userId },
  });
}

async function main() {
  let user1Id = null;
  let user2Id = null;

  try {
    console.log("Starting portfolio list API test...\n");

    // --------------------------------------------------
    // 1. No authentication
    // --------------------------------------------------

    const noAuthResult = await apiRequest("/portfolios");

    if (noAuthResult.status !== 401) {
      throw new Error(
        `Expected 401 without authentication, got ${noAuthResult.status}: ${JSON.stringify(
          noAuthResult.body,
        )}`,
      );
    }

    console.log("✓ Unauthenticated request returns 401");

    // --------------------------------------------------
    // 2. Invalid authentication
    // --------------------------------------------------

    const invalidTokenResult = await apiRequest("/portfolios", {
      headers: {
        Authorization: "Bearer definitely-invalid-token",
      },
    });

    if (invalidTokenResult.status !== 401) {
      throw new Error(
        `Expected 401 with invalid token, got ${invalidTokenResult.status}: ${JSON.stringify(
          invalidTokenResult.body,
        )}`,
      );
    }

    console.log("✓ Invalid token returns 401");

    // --------------------------------------------------
    // 3. Create test users
    // --------------------------------------------------

    const registeredUser1 = await registerUser(user1);

    user1.accessToken = registeredUser1.accessToken;
    user1Id = registeredUser1.userId;

    console.log("✓ Test user 1 registered");

    const registeredUser2 = await registerUser(user2);

    user2.accessToken = registeredUser2.accessToken;
    user2Id = registeredUser2.userId;

    console.log("✓ Test user 2 registered");

    // --------------------------------------------------
    // 4. Authenticated request for user 1
    // --------------------------------------------------

    const user1Result = await apiRequest("/portfolios", {
      headers: {
        Authorization: `Bearer ${user1.accessToken}`,
      },
    });

    if (user1Result.status !== 200) {
      throw new Error(
        `Expected 200 for authenticated user 1, got ${user1Result.status}: ${JSON.stringify(
          user1Result.body,
        )}`,
      );
    }

    if (user1Result.body?.success !== true) {
      throw new Error(
        `Expected success=true for user 1: ${JSON.stringify(user1Result.body)}`,
      );
    }

    const user1Portfolios = user1Result.body?.data?.portfolios;

    if (!Array.isArray(user1Portfolios)) {
      throw new Error(
        `Expected data.portfolios to be an array: ${JSON.stringify(
          user1Result.body,
        )}`,
      );
    }

    console.log("✓ Authenticated user 1 receives portfolio list");

    // --------------------------------------------------
    // 5. Check user 1 owns every returned portfolio
    // --------------------------------------------------

    for (const portfolio of user1Portfolios) {
      if (portfolio.userId !== user1Id) {
        throw new Error(
          `User 1 received another user's portfolio: ${JSON.stringify(
            portfolio,
          )}`,
        );
      }
    }

    console.log("✓ User 1 only receives their own portfolios");

    // --------------------------------------------------
    // 6. Check Main Portfolio exists
    // --------------------------------------------------

    const mainPortfolio = user1Portfolios.find(
      (portfolio) => portfolio.name === "Main Portfolio",
    );

    if (!mainPortfolio) {
      throw new Error("User 1 does not have a Main Portfolio");
    }

    if (mainPortfolio.isDefault !== true) {
      throw new Error("Main Portfolio is not marked as default");
    }

    if (mainPortfolio.startingBalance !== "10000") {
      throw new Error(
        `Expected startingBalance "10000", got "${mainPortfolio.startingBalance}"`,
      );
    }

    if (mainPortfolio.cashBalance !== "10000") {
      throw new Error(
        `Expected cashBalance "10000", got "${mainPortfolio.cashBalance}"`,
      );
    }

    console.log("✓ Main Portfolio is present and correctly serialized");

    // --------------------------------------------------
    // 7. Authenticated request for user 2
    // --------------------------------------------------

    const user2Result = await apiRequest("/portfolios", {
      headers: {
        Authorization: `Bearer ${user2.accessToken}`,
      },
    });

    if (user2Result.status !== 200) {
      throw new Error(
        `Expected 200 for authenticated user 2, got ${user2Result.status}: ${JSON.stringify(
          user2Result.body,
        )}`,
      );
    }

    const user2Portfolios = user2Result.body?.data?.portfolios;

    if (!Array.isArray(user2Portfolios)) {
      throw new Error("User 2 portfolio response is not an array");
    }

    console.log("✓ Authenticated user 2 receives portfolio list");

    // --------------------------------------------------
    // 8. Verify user isolation
    // --------------------------------------------------

    for (const portfolio of user2Portfolios) {
      if (portfolio.userId !== user2Id) {
        throw new Error(
          `User 2 received another user's portfolio: ${JSON.stringify(
            portfolio,
          )}`,
        );
      }
    }

    const user1PortfolioIds = new Set(
      user1Portfolios.map((portfolio) => portfolio.id),
    );

    for (const portfolio of user2Portfolios) {
      if (user1PortfolioIds.has(portfolio.id)) {
        throw new Error(
          `Portfolio ${portfolio.id} was incorrectly visible to both users`,
        );
      }
    }

    console.log("✓ Portfolio ownership isolation works correctly");

    console.log("\nPORTFOLIO LIST API TEST PASSED");
  } catch (error) {
    console.error("\nPORTFOLIO LIST API TEST FAILED");
    console.error(error.message);

    process.exitCode = 1;
  } finally {
    // --------------------------------------------------
    // Cleanup
    // --------------------------------------------------

    try {
      await cleanupUser(user1Id);
      await cleanupUser(user2Id);
    } catch (cleanupError) {
      console.error(`Cleanup failed: ${cleanupError.message}`);
      process.exitCode = 1;
    }

    await prisma.$disconnect();
  }
}

main();
