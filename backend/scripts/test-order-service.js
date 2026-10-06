const prisma = require("../src/config/database");
const orderService = require("../src/services/orderService");

const timestamp = Date.now();

async function main() {
  let user1 = null;
  let user2 = null;
  let portfolio1 = null;
  let inactivePortfolio = null;

  try {
    console.log("Starting order service test...\n");

    // --------------------------------------------------
    // Create users
    // --------------------------------------------------

    user1 = await prisma.user.create({
      data: {
        email: `order-service-1-${timestamp}@example.com`,
        name: "Order Test User 1",
        passwordHash: "test-hash",
      },
    });

    user2 = await prisma.user.create({
      data: {
        email: `order-service-2-${timestamp}@example.com`,
        name: "Order Test User 2",
        passwordHash: "test-hash",
      },
    });

    // --------------------------------------------------
    // Create portfolios
    // --------------------------------------------------

    portfolio1 = await prisma.portfolio.create({
      data: {
        userId: user1.id,
        name: "Order Test Portfolio",
        startingBalance: "10000",
        cashBalance: "10000",
        isDefault: true,
        isActive: true,
      },
    });

    inactivePortfolio = await prisma.portfolio.create({
      data: {
        userId: user1.id,
        name: "Inactive Portfolio",
        startingBalance: "10000",
        cashBalance: "10000",
        isDefault: false,
        isActive: false,
      },
    });

    // --------------------------------------------------
    // Create market order
    // --------------------------------------------------

    const order = await orderService.createMarketOrder({
      userId: user1.id,
      portfolioId: portfolio1.id,
      symbol: "aapl",
      assetType: "STOCK",
      side: "BUY",
      quantity: "10.50000000",
    });

    if (!order) {
      throw new Error("Expected order to be returned");
    }

    if (order.portfolioId !== portfolio1.id) {
      throw new Error("Order has incorrect portfolioId");
    }

    if (order.symbol !== "AAPL") {
      throw new Error(`Expected normalized symbol AAPL, got ${order.symbol}`);
    }

    if (order.assetType !== "STOCK") {
      throw new Error("Incorrect asset type");
    }

    if (order.side !== "BUY") {
      throw new Error("Incorrect order side");
    }

    if (order.type !== "MARKET") {
      throw new Error("Order type should be MARKET");
    }

    if (order.status !== "PENDING") {
      throw new Error("New market order should be PENDING");
    }

    if (order.quantity !== "10.5") {
      throw new Error(`Expected quantity "10.5", got "${order.quantity}"`);
    }

    if (order.source !== "MANUAL") {
      throw new Error("Expected source MANUAL");
    }

    if (order.executedPrice !== null) {
      throw new Error("New market order should not have an executed price");
    }

    console.log("✓ Market order created correctly");

    // --------------------------------------------------
    // Verify database persistence
    // --------------------------------------------------

    const savedOrder = await prisma.order.findUnique({
      where: {
        id: order.id,
      },
    });

    if (!savedOrder) {
      throw new Error("Order was not persisted");
    }

    if (savedOrder.status !== "PENDING") {
      throw new Error("Persisted order should have PENDING status");
    }

    console.log("✓ Order persisted correctly");

    // --------------------------------------------------
    // Ownership check
    // --------------------------------------------------

    try {
      await orderService.createMarketOrder({
        userId: user2.id,
        portfolioId: portfolio1.id,
        symbol: "MSFT",
        assetType: "STOCK",
        side: "BUY",
        quantity: "5",
      });

      throw new Error(
        "User 2 should not create an order in user 1's portfolio",
      );
    } catch (error) {
      if (error.code !== "PORTFOLIO_NOT_FOUND") {
        throw error;
      }
    }

    console.log("✓ Portfolio ownership is enforced");

    // --------------------------------------------------
    // Inactive portfolio check
    // --------------------------------------------------

    try {
      await orderService.createMarketOrder({
        userId: user1.id,
        portfolioId: inactivePortfolio.id,
        symbol: "TSLA",
        assetType: "STOCK",
        side: "BUY",
        quantity: "1",
      });

      throw new Error("Inactive portfolio should reject new orders");
    } catch (error) {
      if (error.code !== "PORTFOLIO_INACTIVE") {
        throw error;
      }
    }

    console.log("✓ Inactive portfolios are rejected");

    // --------------------------------------------------
    // Suspended user check
    // --------------------------------------------------

    await prisma.user.update({
      where: {
        id: user1.id,
      },
      data: {
        isSuspended: true,
      },
    });

    try {
      await orderService.createMarketOrder({
        userId: user1.id,
        portfolioId: portfolio1.id,
        symbol: "NVDA",
        assetType: "STOCK",
        side: "BUY",
        quantity: "1",
      });

      throw new Error("Suspended user should not create orders");
    } catch (error) {
      if (error.code !== "ACCOUNT_SUSPENDED") {
        throw error;
      }
    }

    console.log("✓ Suspended users are rejected");

    console.log("\nORDER SERVICE TEST PASSED");
  } catch (error) {
    console.error("\nORDER SERVICE TEST FAILED");
    console.error(error.message);

    process.exitCode = 1;
  } finally {
    if (portfolio1) {
      await prisma.order.deleteMany({
        where: {
          portfolioId: portfolio1.id,
        },
      });
    }

    if (inactivePortfolio) {
      await prisma.order.deleteMany({
        where: {
          portfolioId: inactivePortfolio.id,
        },
      });
    }

    if (portfolio1) {
      await prisma.portfolio.delete({
        where: {
          id: portfolio1.id,
        },
      });
    }

    if (inactivePortfolio) {
      await prisma.portfolio.delete({
        where: {
          id: inactivePortfolio.id,
        },
      });
    }

    if (user1) {
      await prisma.user.delete({
        where: {
          id: user1.id,
        },
      });
    }

    if (user2) {
      await prisma.user.delete({
        where: {
          id: user2.id,
        },
      });
    }

    await prisma.$disconnect();
  }
}

main();
