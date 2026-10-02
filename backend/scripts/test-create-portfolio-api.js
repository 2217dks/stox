const prisma = require("../src/config/database");

const API_BASE_URL = "http://localhost:8000/api/v1";

const timestamp = Date.now();

const testUser = {
  name: "Create Portfolio Test User",
  email: `create-portfolio-test-${timestamp}@example.com`,
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
  let userId = null;

  try {
    console.log("Starting create portfolio API test...\n");

    // --------------------------------------------------
    // 1. Unauthenticated request
    // --------------------------------------------------

    const noAuthResult = await apiRequest("/portfolios", {
      method: "POST",
      body: JSON.stringify({
        name: "Should Fail",
      }),
    });

    if (noAuthResult.status !== 401) {
      throw new Error(
        `Expected 401 without authentication, got ${noAuthResult.status}: ${JSON.stringify(
          noAuthResult.body,
        )}`,
      );
    }

    console.log("✓ Unauthenticated request returns 401");

    // --------------------------------------------------
    // 2. Register temporary test user
    // --------------------------------------------------

    const registerResult = await apiRequest("/auth/register", {
      method: "POST",
      body: JSON.stringify(testUser),
    });

    if (registerResult.status !== 200 && registerResult.status !== 201) {
      throw new Error(
        `Registration failed: ${JSON.stringify(registerResult.body)}`,
      );
    }

    const accessToken = registerResult.body?.data?.accessToken;
    userId = registerResult.body?.data?.user?.id;

    if (!accessToken || !userId) {
      throw new Error(
        `Registration response missing access token or user ID: ${JSON.stringify(
          registerResult.body,
        )}`,
      );
    }

    console.log("✓ Temporary test user registered");

    // --------------------------------------------------
    // 3. Create portfolio
    // --------------------------------------------------

    const createResult = await apiRequest("/portfolios", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        name: "Long Term Portfolio",
        description: "Test portfolio created through API",
      }),
    });

    if (createResult.status !== 201) {
      throw new Error(
        `Expected 201 when creating portfolio, got ${createResult.status}: ${JSON.stringify(
          createResult.body,
        )}`,
      );
    }

    if (createResult.body?.success !== true) {
      throw new Error(
        `Expected success=true: ${JSON.stringify(createResult.body)}`,
      );
    }

    const portfolio = createResult.body?.data?.portfolio;

    if (!portfolio) {
      throw new Error("Created portfolio missing from response");
    }

    console.log("✓ Portfolio created successfully");

    // --------------------------------------------------
    // 4. Verify returned portfolio
    // --------------------------------------------------

    if (portfolio.userId !== userId) {
      throw new Error(
        `Portfolio belongs to wrong user: expected ${userId}, got ${portfolio.userId}`,
      );
    }

    if (portfolio.name !== "Long Term Portfolio") {
      throw new Error(`Unexpected portfolio name: ${portfolio.name}`);
    }

    if (portfolio.description !== "Test portfolio created through API") {
      throw new Error(
        `Unexpected portfolio description: ${portfolio.description}`,
      );
    }

    if (portfolio.startingBalance !== "10000") {
      throw new Error(
        `Expected startingBalance "10000", got "${portfolio.startingBalance}"`,
      );
    }

    if (portfolio.cashBalance !== "10000") {
      throw new Error(
        `Expected cashBalance "10000", got "${portfolio.cashBalance}"`,
      );
    }

    if (portfolio.isDefault !== false) {
      throw new Error("New portfolio should not be marked as default");
    }

    if (portfolio.isActive !== true) {
      throw new Error("New portfolio should be active");
    }

    console.log("✓ Created portfolio fields are correct");

    // --------------------------------------------------
    // 5. Verify persistence through database
    // --------------------------------------------------

    const savedPortfolio = await prisma.portfolio.findUnique({
      where: {
        id: portfolio.id,
      },
    });

    if (!savedPortfolio) {
      throw new Error("Created portfolio was not found in the database");
    }

    if (savedPortfolio.userId !== userId) {
      throw new Error("Persisted portfolio belongs to the wrong user");
    }

    console.log("✓ Portfolio persisted correctly in database");

    // --------------------------------------------------
    // 6. Duplicate portfolio name
    // --------------------------------------------------

    const duplicateResult = await apiRequest("/portfolios", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        name: "Long Term Portfolio",
        description: "Duplicate should fail",
      }),
    });

    if (duplicateResult.status !== 409) {
      throw new Error(
        `Expected 409 for duplicate portfolio name, got ${duplicateResult.status}: ${JSON.stringify(
          duplicateResult.body,
        )}`,
      );
    }
    if (duplicateResult.body?.error?.code !== "PORTFOLIO_NAME_EXISTS") {
      throw new Error(
        `Expected PORTFOLIO_NAME_EXISTS, got ${JSON.stringify(
          duplicateResult.body,
        )}`,
      );
    }

    console.log("✓ Duplicate portfolio name returns 409");

    // --------------------------------------------------
    // 7. Missing portfolio name
    // --------------------------------------------------

    const missingNameResult = await apiRequest("/portfolios", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        description: "Missing name",
      }),
    });

    if (missingNameResult.status !== 400) {
      throw new Error(
        `Expected 400 for missing name, got ${missingNameResult.status}: ${JSON.stringify(
          missingNameResult.body,
        )}`,
      );
    }

    if (missingNameResult.body?.error?.code !== "PORTFOLIO_NAME_REQUIRED") {
      throw new Error(
        `Expected PORTFOLIO_NAME_REQUIRED, got ${JSON.stringify(
          missingNameResult.body,
        )}`,
      );
    }

    console.log("✓ Missing portfolio name returns 400");

    // --------------------------------------------------
    // 8. Verify created portfolio appears in list API
    // --------------------------------------------------

    const listResult = await apiRequest("/portfolios", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (listResult.status !== 200) {
      throw new Error(
        `Expected 200 when listing portfolios, got ${listResult.status}: ${JSON.stringify(
          listResult.body,
        )}`,
      );
    }

    const portfolios = listResult.body?.data?.portfolios;

    const foundPortfolio = portfolios?.find((item) => item.id === portfolio.id);

    if (!foundPortfolio) {
      throw new Error(
        "Created portfolio was not returned by portfolio list API",
      );
    }

    console.log("✓ Created portfolio appears in portfolio list");

    console.log("\nCREATE PORTFOLIO API TEST PASSED");
  } catch (error) {
    console.error("\nCREATE PORTFOLIO API TEST FAILED");
    console.error(error.message);

    process.exitCode = 1;
  } finally {
    try {
      await cleanupUser(userId);
    } catch (cleanupError) {
      console.error(`Cleanup failed: ${cleanupError.message}`);
      process.exitCode = 1;
    }

    await prisma.$disconnect();
  }
}

main();
