const prisma = require("../src/config/database");

const API_BASE_URL = "http://localhost:8000/api/v1";

const timestamp = Date.now();

const user1 = {
  name: "Market Order API User 1",
  email: `market-order-api-1-${timestamp}@example.com`,
  password: "MarketOrderTest#2026",
};

const user2 = {
  name: "Market Order API User 2",
  email: `market-order-api-2-${timestamp}@example.com`,
  password: "MarketOrderTest#2026",
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

async function cleanupUser(userId) {
  if (!userId) return;

  await prisma.order.deleteMany({
    where: {
      portfolio: {
        userId,
      },
    },
  });

  await prisma.portfolio.deleteMany({
    where: {
      userId,
    },
  });

  await prisma.refreshToken.deleteMany({
    where: {
      userId,
    },
  });

  await prisma.user.delete({
    where: {
      id: userId,
    },
  });
}

async function main() {
  let user1Id = null;
  let user2Id = null;
  let portfolio1 = null;
  let inactivePortfolio = null;

  try {
    console.log("Starting create market order API test...\n");

    // --------------------------------------------------
    // 1. Unauthenticated request
    // --------------------------------------------------

    const noAuthResult = await apiRequest("/orders", {
      method: "POST",
      body: JSON.stringify({
        portfolioId: "00000000-0000-0000-0000-000000000000",
        symbol: "AAPL",
        assetType: "STOCK",
        side: "BUY",
        quantity: "10",
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
    // 2. Register test users
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
        name: "Market Order API Portfolio",
        startingBalance: "10000",
        cashBalance: "10000",
        isDefault: true,
        isActive: true,
      },
    });

    inactivePortfolio = await prisma.portfolio.create({
      data: {
        userId: user1Id,
        name: "Inactive Market Order Portfolio",
        startingBalance: "10000",
        cashBalance: "10000",
        isDefault: false,
        isActive: false,
      },
    });

    console.log("✓ Test portfolios created");

    // --------------------------------------------------
    // 4. Create valid market order
    // --------------------------------------------------

    const createResult = await apiRequest("/orders", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${user1.accessToken}`,
      },
      body: JSON.stringify({
        portfolioId: portfolio1.id,
        symbol: "aapl",
        assetType: "STOCK",
        side: "BUY",
        quantity: "10.5",
      }),
    });

    if (createResult.status !== 201) {
      throw new Error(
        `Expected 201, got ${createResult.status}: ${JSON.stringify(
          createResult.body,
        )}`,
      );
    }

    if (createResult.body?.success !== true) {
      throw new Error(
        `Expected success=true: ${JSON.stringify(createResult.body)}`,
      );
    }

    const order = createResult.body?.data?.order;

    if (!order) {
      throw new Error("Created order missing from response");
    }

    if (order.portfolioId !== portfolio1.id) {
      throw new Error("Order has incorrect portfolioId");
    }

    if (order.symbol !== "AAPL") {
      throw new Error(`Expected AAPL, got ${order.symbol}`);
    }

    if (order.assetType !== "STOCK") {
      throw new Error("Incorrect assetType");
    }

    if (order.side !== "BUY") {
      throw new Error("Incorrect side");
    }

    if (order.type !== "MARKET") {
      throw new Error("Order type is not MARKET");
    }

    if (order.status !== "PENDING") {
      throw new Error(`Expected PENDING, got ${order.status}`);
    }

    if (order.quantity !== "10.5") {
      throw new Error(`Expected quantity "10.5", got "${order.quantity}"`);
    }

    if (order.source !== "MANUAL") {
      throw new Error(`Expected source MANUAL, got ${order.source}`);
    }

    if (order.executedPrice !== null) {
      throw new Error("New market order should not have executedPrice");
    }

    console.log("✓ Valid market order API request succeeds");

    // --------------------------------------------------
    // 5. Verify database persistence
    // --------------------------------------------------

    const savedOrder = await prisma.order.findUnique({
      where: {
        id: order.id,
      },
    });

    if (!savedOrder) {
      throw new Error("Created order was not persisted in database");
    }

    if (savedOrder.status !== "PENDING") {
      throw new Error("Persisted order should be PENDING");
    }

    console.log("✓ Order persisted correctly");

    // --------------------------------------------------
    // 6. Invalid quantity
    // --------------------------------------------------

    const invalidQuantityResult = await apiRequest("/orders", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${user1.accessToken}`,
      },
      body: JSON.stringify({
        portfolioId: portfolio1.id,
        symbol: "MSFT",
        assetType: "STOCK",
        side: "BUY",
        quantity: "0",
      }),
    });

    if (invalidQuantityResult.status !== 400) {
      throw new Error(
        `Expected 400 for invalid quantity, got ${invalidQuantityResult.status}: ${JSON.stringify(
          invalidQuantityResult.body,
        )}`,
      );
    }

    if (invalidQuantityResult.body?.error?.code !== "VALIDATION_ERROR") {
      throw new Error(
        `Expected VALIDATION_ERROR, got ${JSON.stringify(
          invalidQuantityResult.body,
        )}`,
      );
    }

    console.log("✓ Invalid quantity returns 400");

    // --------------------------------------------------
    // 7. Missing fields
    // --------------------------------------------------

    const missingFieldsResult = await apiRequest("/orders", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${user1.accessToken}`,
      },
      body: JSON.stringify({
        portfolioId: portfolio1.id,
      }),
    });

    if (missingFieldsResult.status !== 400) {
      throw new Error(
        `Expected 400 for missing fields, got ${missingFieldsResult.status}: ${JSON.stringify(
          missingFieldsResult.body,
        )}`,
      );
    }

    console.log("✓ Missing required fields return 400");

    // --------------------------------------------------
    // 8. Another user's portfolio
    // --------------------------------------------------

    const ownershipResult = await apiRequest("/orders", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${user2.accessToken}`,
      },
      body: JSON.stringify({
        portfolioId: portfolio1.id,
        symbol: "NVDA",
        assetType: "STOCK",
        side: "BUY",
        quantity: "1",
      }),
    });

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

    console.log("✓ Portfolio ownership is enforced by API");

    // --------------------------------------------------
    // 9. Inactive portfolio
    // --------------------------------------------------

    const inactiveResult = await apiRequest("/orders", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${user1.accessToken}`,
      },
      body: JSON.stringify({
        portfolioId: inactivePortfolio.id,
        symbol: "TSLA",
        assetType: "STOCK",
        side: "BUY",
        quantity: "1",
      }),
    });

    if (inactiveResult.status !== 400) {
      throw new Error(
        `Expected 400 for inactive portfolio, got ${inactiveResult.status}: ${JSON.stringify(
          inactiveResult.body,
        )}`,
      );
    }

    if (inactiveResult.body?.error?.code !== "PORTFOLIO_INACTIVE") {
      throw new Error(
        `Expected PORTFOLIO_INACTIVE, got ${JSON.stringify(
          inactiveResult.body,
        )}`,
      );
    }

    console.log("✓ Inactive portfolios are rejected");

    // --------------------------------------------------
    // 10. Verify cash was NOT modified
    // --------------------------------------------------

    const portfolioAfterOrder = await prisma.portfolio.findUnique({
      where: {
        id: portfolio1.id,
      },
      select: {
        cashBalance: true,
      },
    });

    if (portfolioAfterOrder.cashBalance.toString() !== "10000") {
      throw new Error(
        `Market order creation should not change cash yet. Got ${portfolioAfterOrder.cashBalance}`,
      );
    }

    console.log("✓ Market order creation does not execute the trade");

    console.log("\nCREATE MARKET ORDER API TEST PASSED");
  } catch (error) {
    console.error("\nCREATE MARKET ORDER API TEST FAILED");
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
