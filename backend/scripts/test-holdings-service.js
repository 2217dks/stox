const prisma = require("../src/config/database");
const portfolioService = require("../src/services/portfolioService");

const timestamp = Date.now();

async function main() {
  let user1 = null;
  let user2 = null;
  let portfolio1 = null;
  let portfolio2 = null;

  try {
    console.log("Starting holdings service test...\n");

    // Create two test users
    user1 = await prisma.user.create({
      data: {
        email: `holdings-service-1-${timestamp}@example.com`,
        name: "Holdings Test User 1",
        passwordHash: "test-hash",
      },
    });

    user2 = await prisma.user.create({
      data: {
        email: `holdings-service-2-${timestamp}@example.com`,
        name: "Holdings Test User 2",
        passwordHash: "test-hash",
      },
    });

    // Create portfolios
    portfolio1 = await prisma.portfolio.create({
      data: {
        userId: user1.id,
        name: "Holdings Test Portfolio",
        startingBalance: "10000",
        cashBalance: "10000",
        isDefault: true,
      },
    });

    portfolio2 = await prisma.portfolio.create({
      data: {
        userId: user2.id,
        name: "Other User Portfolio",
        startingBalance: "10000",
        cashBalance: "10000",
        isDefault: true,
      },
    });

    // Add holdings to user 1
    await prisma.holding.createMany({
      data: [
        {
          portfolioId: portfolio1.id,
          symbol: "AAPL",
          assetType: "STOCK",
          quantity: "10",
          averageBuyPrice: "175.50000000",
          totalInvested: "1755.00000000",
          isShort: false,
        },
        {
          portfolioId: portfolio1.id,
          symbol: "BTCUSDT",
          assetType: "CRYPTO",
          quantity: "0.50000000",
          averageBuyPrice: "59850.00000000",
          totalInvested: "29925.00000000",
          isShort: false,
        },
      ],
    });

    // --------------------------------------------------
    // List holdings
    // --------------------------------------------------

    const holdings = await portfolioService.listPortfolioHoldings(
      user1.id,
      portfolio1.id,
    );

    if (!Array.isArray(holdings)) {
      throw new Error("Expected holdings to be an array");
    }

    if (holdings.length !== 2) {
      throw new Error(`Expected 2 holdings, got ${holdings.length}`);
    }

    console.log("✓ Holdings returned successfully");

    // --------------------------------------------------
    // Verify ordering
    // --------------------------------------------------

    if (holdings[0].symbol !== "AAPL") {
      throw new Error(`Expected AAPL first, got ${holdings[0].symbol}`);
    }

    console.log("✓ Holdings are sorted by symbol");

    // --------------------------------------------------
    // Verify Decimal serialization
    // --------------------------------------------------

    const aapl = holdings.find((holding) => holding.symbol === "AAPL");

    if (aapl.quantity !== "10") {
      throw new Error(`Expected AAPL quantity "10", got "${aapl.quantity}"`);
    }

    if (aapl.averageBuyPrice !== "175.5") {
      throw new Error(
        `Expected AAPL averageBuyPrice "175.5", got "${aapl.averageBuyPrice}"`,
      );
    }

    if (aapl.totalInvested !== "1755") {
      throw new Error(
        `Expected AAPL totalInvested "1755", got "${aapl.totalInvested}"`,
      );
    }

    console.log("✓ Financial Decimal values are serialized safely");

    // --------------------------------------------------
    // Verify ownership isolation
    // --------------------------------------------------

    try {
      await portfolioService.listPortfolioHoldings(user2.id, portfolio1.id);

      throw new Error("User 2 should not access user 1's portfolio");
    } catch (error) {
      if (error.code !== "PORTFOLIO_NOT_FOUND") {
        throw error;
      }
    }

    console.log("✓ Portfolio ownership is enforced");

    // --------------------------------------------------
    // Verify empty portfolio
    // --------------------------------------------------

    const emptyHoldings = await portfolioService.listPortfolioHoldings(
      user2.id,
      portfolio2.id,
    );

    if (!Array.isArray(emptyHoldings)) {
      throw new Error("Expected empty holdings array");
    }

    if (emptyHoldings.length !== 0) {
      throw new Error(
        `Expected empty holdings array, got ${emptyHoldings.length}`,
      );
    }

    console.log("✓ Empty portfolios return an empty array");

    console.log("\nHOLDINGS SERVICE TEST PASSED");
  } catch (error) {
    console.error("\nHOLDINGS SERVICE TEST FAILED");
    console.error(error.message);

    process.exitCode = 1;
  } finally {
    if (portfolio1) {
      await prisma.holding.deleteMany({
        where: { portfolioId: portfolio1.id },
      });
    }

    if (portfolio2) {
      await prisma.holding.deleteMany({
        where: { portfolioId: portfolio2.id },
      });
    }

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
