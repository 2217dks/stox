const prisma = require("../src/config/database");

const {
  listUserPortfolios,
  getPortfolioById,
  createPortfolio,
} = require("../src/services/portfolioService");

async function main() {
  const email = `portfolio-service-test-${Date.now()}@stox.local`;

  console.log("Preparing portfolio service test user...\n");

  // ========================================================
  // 1. CREATE TEST USER
  // ========================================================

  const user = await prisma.user.create({
    data: {
      email,
      name: "Portfolio Service Test User",
    },
  });

  console.log("✓ Test user created");

  // ========================================================
  // 2. CREATE INITIAL PORTFOLIO
  // ========================================================

  const mainPortfolio = await prisma.portfolio.create({
    data: {
      userId: user.id,
      name: "Main Portfolio",
      startingBalance: 10000,
      cashBalance: 10000,
      isDefault: true,
      isActive: true,
    },
  });

  console.log("✓ Initial portfolio created");

  // ========================================================
  // 3. LIST PORTFOLIOS
  // ========================================================

  console.log("\nTesting listUserPortfolios...");

  const portfolios = await listUserPortfolios(user.id);

  if (portfolios.length !== 1) {
    throw new Error("Expected one portfolio.");
  }

  if (portfolios[0].name !== "Main Portfolio") {
    throw new Error("Incorrect portfolio returned.");
  }

  if (portfolios[0].startingBalance !== "10000") {
    throw new Error("Incorrect starting balance.");
  }

  if (portfolios[0].cashBalance !== "10000") {
    throw new Error("Incorrect cash balance.");
  }

  if (!portfolios[0].isDefault) {
    throw new Error("Main portfolio should be default.");
  }

  console.log("✓ Portfolio list works");

  // ========================================================
  // 4. CREATE SECOND PORTFOLIO
  // ========================================================

  console.log("\nTesting createPortfolio...");

  const secondPortfolio = await createPortfolio(user.id, {
    name: "Momentum Strategy",
    description: "Short-term momentum strategy",
  });

  if (secondPortfolio.name !== "Momentum Strategy") {
    throw new Error("Created portfolio has incorrect name.");
  }

  if (secondPortfolio.description !== "Short-term momentum strategy") {
    throw new Error("Created portfolio has incorrect description.");
  }

  if (secondPortfolio.startingBalance !== "10000") {
    throw new Error("Created portfolio has incorrect starting balance.");
  }

  if (secondPortfolio.cashBalance !== "10000") {
    throw new Error("Created portfolio has incorrect cash balance.");
  }

  if (secondPortfolio.isDefault) {
    throw new Error("New portfolio should not be default.");
  }

  console.log("✓ Portfolio creation works");

  // ========================================================
  // 5. LIST AGAIN
  // ========================================================

  const updatedList = await listUserPortfolios(user.id);

  if (updatedList.length !== 2) {
    throw new Error("Expected two portfolios after creation.");
  }

  if (updatedList[0].name !== "Main Portfolio") {
    throw new Error("Default portfolio was not listed first.");
  }

  console.log("✓ Portfolio ordering works");

  // ========================================================
  // 6. GET BY ID
  // ========================================================

  console.log("\nTesting getPortfolioById...");

  const fetchedPortfolio = await getPortfolioById(user.id, secondPortfolio.id);

  if (fetchedPortfolio.id !== secondPortfolio.id) {
    throw new Error("getPortfolioById returned wrong portfolio.");
  }

  console.log("✓ Portfolio lookup works");

  // ========================================================
  // 7. OWNERSHIP CHECK
  // ========================================================

  console.log("\nTesting portfolio ownership...");

  const otherUser = await prisma.user.create({
    data: {
      email: `portfolio-other-user-${Date.now()}@stox.local`,
      name: "Other Test User",
    },
  });

  try {
    await getPortfolioById(otherUser.id, secondPortfolio.id);

    throw new Error("User was able to access another user's portfolio.");
  } catch (error) {
    if (error.code !== "PORTFOLIO_NOT_FOUND") {
      throw error;
    }
  }

  console.log("✓ Portfolio ownership enforced");

  // ========================================================
  // 8. DUPLICATE NAME
  // ========================================================

  console.log("\nTesting duplicate portfolio name...");

  try {
    await createPortfolio(user.id, {
      name: "Momentum Strategy",
    });

    throw new Error("Duplicate portfolio name was accepted.");
  } catch (error) {
    if (error.code !== "PORTFOLIO_NAME_EXISTS") {
      throw error;
    }
  }

  console.log("✓ Duplicate portfolio names rejected");

  // ========================================================
  // 9. SUSPENDED USER
  // ========================================================

  console.log("\nTesting suspended user...");

  await prisma.user.update({
    where: {
      id: user.id,
    },
    data: {
      isSuspended: true,
    },
  });

  try {
    await listUserPortfolios(user.id);

    throw new Error("Suspended user could access portfolios.");
  } catch (error) {
    if (error.code !== "ACCOUNT_SUSPENDED") {
      throw error;
    }
  }

  console.log("✓ Suspended user rejected");

  // ========================================================
  // 10. CLEANUP
  // ========================================================

  await prisma.user.delete({
    where: {
      id: otherUser.id,
    },
  });

  await prisma.user.delete({
    where: {
      id: user.id,
    },
  });

  console.log("✓ Test data cleaned up");

  console.log("\nPORTFOLIO SERVICE TEST PASSED");
}

main()
  .catch((error) => {
    console.error("\nPORTFOLIO SERVICE TEST FAILED");
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
