const prisma = require("../src/config/database");

const API_BASE_URL = "http://localhost:8000/api/v1";

const timestamp = Date.now();

const user1 = {
  name: "Cash Balance API User 1",
  email: `cash-balance-api-1-${timestamp}@example.com`,
  password: "CashBalanceTest#2026",
};

const user2 = {
  name: "Cash Balance API User 2",
  email: `cash-balance-api-2-${timestamp}@example.com`,
  password: "CashBalanceTest#2026",
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

async function registerUser(user) {
  const result = await apiRequest("/auth/register", {
    method: "POST",
    body: JSON.stringify(user),
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

async function main() {
  let user1Id = null;
  let user2Id = null;
  let portfolio1 = null;
  let portfolio2 = null;

  try {
    console.log("Starting cash balance API test...\n");

    // --------------------------------------------------
    // 1. Unauthenticated request
    // --------------------------------------------------

    const noAuthResult = await apiRequest(
      "/portfolios/00000000-0000-0000-0000-000000000000/cash-balance",
    );

    if (noAuthResult.status !== 401) {
      throw new Error(
        `Expected 401 without authentication, got ${noAuthResult.status}: ${JSON.stringify(
          noAuthResult.body,
        )}`,
      );
    }

    console.log("✓ Unauthenticated request returns 401");

    // --------------------------------------------------
    // 2. Register users
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
    // 3. Create portfolios
    // --------------------------------------------------

    portfolio1 = await prisma.portfolio.create({
      data: {
        userId: user1Id,
        name: "Cash Balance API Portfolio",
        startingBalance: "10000",
        cashBalance: "7350.50000000",
        isDefault: true,
        isActive: true,
      },
    });

    portfolio2 = await prisma.portfolio.create({
      data: {
        userId: user2Id,
        name: "Other User Portfolio",
        startingBalance: "10000",
        cashBalance: "5000",
        isDefault: true,
        isActive: true,
      },
    });

    console.log("✓ Test portfolios created");

    // --------------------------------------------------
    // 4. Authenticated request
    // --------------------------------------------------

    const result = await apiRequest(
      `/portfolios/${portfolio1.id}/cash-balance`,
      {
        headers: {
          Authorization: `Bearer ${user1.accessToken}`,
        },
      },
    );

    if (result.status !== 200) {
      throw new Error(
        `Expected 200, got ${result.status}: ${JSON.stringify(result.body)}`,
      );
    }

    if (result.body?.success !== true) {
      throw new Error(`Expected success=true: ${JSON.stringify(result.body)}`);
    }

    if (result.body?.data?.portfolioId !== portfolio1.id) {
      throw new Error("Response contains incorrect portfolioId");
    }

    if (result.body?.data?.cashBalance !== "7350.5") {
      throw new Error(
        `Expected cashBalance "7350.5", got "${result.body?.data?.cashBalance}"`,
      );
    }

    console.log("✓ Authenticated cash balance request works");

    // --------------------------------------------------
    // 5. User isolation
    // --------------------------------------------------

    const ownershipResult = await apiRequest(
      `/portfolios/${portfolio1.id}/cash-balance`,
      {
        headers: {
          Authorization: `Bearer ${user2.accessToken}`,
        },
      },
    );

    if (ownershipResult.status !== 404) {
      throw new Error(
        `Expected 404 for another user's portfolio, got ${ownershipResult.status}: ${JSON.stringify(
          ownershipResult.body,
        )}`,
      );
    }

    if (ownershipResult.body?.error?.code !== "PORTFOLIO_NOT_FOUND") {
      throw new Error(
        `Expected PORTFOLIO_NOT_FOUND, got ${JSON.stringify(
          ownershipResult.body,
        )}`,
      );
    }

    console.log("✓ Portfolio ownership isolation works");

    // --------------------------------------------------
    // 6. Nonexistent portfolio
    // --------------------------------------------------

    const missingResult = await apiRequest(
      "/portfolios/00000000-0000-0000-0000-000000000000/cash-balance",
      {
        headers: {
          Authorization: `Bearer ${user1.accessToken}`,
        },
      },
    );

    if (missingResult.status !== 404) {
      throw new Error(
        `Expected 404 for nonexistent portfolio, got ${missingResult.status}: ${JSON.stringify(
          missingResult.body,
        )}`,
      );
    }

    if (missingResult.body?.error?.code !== "PORTFOLIO_NOT_FOUND") {
      throw new Error(
        `Expected PORTFOLIO_NOT_FOUND, got ${JSON.stringify(
          missingResult.body,
        )}`,
      );
    }

    console.log("✓ Nonexistent portfolio returns 404");

    // --------------------------------------------------
    // 7. Second user's portfolio
    // --------------------------------------------------

    const user2Result = await apiRequest(
      `/portfolios/${portfolio2.id}/cash-balance`,
      {
        headers: {
          Authorization: `Bearer ${user2.accessToken}`,
        },
      },
    );

    if (user2Result.status !== 200) {
      throw new Error(
        `Expected 200 for user 2 portfolio, got ${user2Result.status}: ${JSON.stringify(
          user2Result.body,
        )}`,
      );
    }

    if (user2Result.body?.data?.cashBalance !== "5000") {
      throw new Error(
        `Expected user 2 cash balance "5000", got "${user2Result.body?.data?.cashBalance}"`,
      );
    }

    console.log("✓ Each user receives their own portfolio balance");

    console.log("\nCASH BALANCE API TEST PASSED");
  } catch (error) {
    console.error("\nCASH BALANCE API TEST FAILED");
    console.error(error.message);

    process.exitCode = 1;
  } finally {
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
