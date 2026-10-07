const prisma = require("../src/config/database");
const portfolioService = require("../src/services/portfolioService");

const timestamp = Date.now();

async function main() {
  let user1 = null;
  let user2 = null;
  let portfolio1 = null;
  let portfolio2 = null;

  try {
    console.log("Starting cash balance service test...\n");

    // --------------------------------------------------
    // Create test users
    // --------------------------------------------------

    user1 = await prisma.user.create({
      data: {
        email: `cash-balance-service-1-${timestamp}@example.com`,
        name: "Cash Balance Test User 1",
        passwordHash: "test-hash",
      },
    });

    user2 = await prisma.user.create({
      data: {
        email: `cash-balance-service-2-${timestamp}@example.com`,
        name: "Cash Balance Test User 2",
        passwordHash: "test-hash",
      },
    });

    // --------------------------------------------------
    // Create test portfolios
    // --------------------------------------------------

    portfolio1 = await prisma.portfolio.create({
      data: {
        userId: user1.id,
        name: "Cash Balance Test Portfolio",
        startingBalance: "10000",
        cashBalance: "7350.50000000",
        isDefault: true,
      },
    });

    portfolio2 = await prisma.portfolio.create({
      data: {
        userId: user2.id,
        name: "Other User Portfolio",
        startingBalance: "10000",
        cashBalance: "5000",
        isDefault: true,
      },
    });

    // --------------------------------------------------
    // Get cash balance
    // --------------------------------------------------

    const result = await portfolioService.getPortfolioCashBalance(
      user1.id,
      portfolio1.id,
    );

    if (!result) {
      throw new Error("Expected a cash balance result");
    }

    if (result.portfolioId !== portfolio1.id) {
      throw new Error(
        `Expected portfolioId ${portfolio1.id}, got ${result.portfolioId}`,
      );
    }

    if (result.cashBalance !== "7350.5") {
      throw new Error(
        `Expected cashBalance "7350.5", got "${result.cashBalance}"`,
      );
    }

    console.log("✓ Cash balance returned correctly");

    // --------------------------------------------------
    // Verify ownership isolation
    // --------------------------------------------------

    try {
      await portfolioService.getPortfolioCashBalance(user2.id, portfolio1.id);

      throw new Error("User 2 should not access user 1's portfolio");
    } catch (error) {
      if (error.code !== "PORTFOLIO_NOT_FOUND") {
        throw error;
      }
    }

    console.log("✓ Portfolio ownership is enforced");

    // --------------------------------------------------
    // Verify another portfolio has its own balance
    // --------------------------------------------------

    const otherResult = await portfolioService.getPortfolioCashBalance(
      user2.id,
      portfolio2.id,
    );

    if (otherResult.cashBalance !== "5000") {
      throw new Error(
        `Expected user 2 cash balance "5000", got "${otherResult.cashBalance}"`,
      );
    }

    console.log("✓ Each portfolio returns its own cash balance");

    // --------------------------------------------------
    // Verify nonexistent portfolio
    // --------------------------------------------------

    try {
      await portfolioService.getPortfolioCashBalance(
        user1.id,
        "00000000-0000-0000-0000-000000000000",
      );

      throw new Error("Expected nonexistent portfolio to throw");
    } catch (error) {
      if (error.code !== "PORTFOLIO_NOT_FOUND") {
        throw error;
      }
    }

    console.log("✓ Nonexistent portfolio returns PORTFOLIO_NOT_FOUND");

    console.log("\nCASH BALANCE SERVICE TEST PASSED");
  } catch (error) {
    console.error("\nCASH BALANCE SERVICE TEST FAILED");
    console.error(error.message);

    process.exitCode = 1;
  } finally {
    if (portfolio1) {
      await prisma.portfolio.delete({
        where: { id: portfolio1.id },
      });
    }

    if (portfolio2) {
      await prisma.portfolio.delete({
        where: { id: portfolio2.id },
      });
    }

    if (user1) {
      await prisma.user.delete({
        where: { id: user1.id },
      });
    }

    if (user2) {
      await prisma.user.delete({
        where: { id: user2.id },
      });
    }

    await prisma.$disconnect();
  }
}

main();
