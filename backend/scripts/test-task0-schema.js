const prisma = require("../src/config/database");

async function main() {
  console.log("Starting Task 0 schema test...\n");

  const email = `task0-${Date.now()}@stox.test`;

  // ----------------------------------------------------------
  // 1. Create a user
  // ----------------------------------------------------------

  const user = await prisma.user.create({
    data: {
      email,
      name: "Task 0 Test User",
      passwordHash: "TEST_ONLY_HASH",
    },
  });

  console.log("✓ User created:", user.id);

  // ----------------------------------------------------------
  // 2. Create a portfolio belonging to that user
  // ----------------------------------------------------------

  const portfolio = await prisma.portfolio.create({
    data: {
      userId: user.id,
      name: "Task 0 Test Portfolio",
    },
  });

  console.log("✓ Portfolio created:", portfolio.id);

  // ----------------------------------------------------------
  // 3. Create a holding
  // ----------------------------------------------------------

  const holding = await prisma.holding.create({
    data: {
      portfolioId: portfolio.id,
      symbol: "AAPL",
      assetType: "STOCK",
      quantity: "10",
      averageBuyPrice: "200",
      totalInvested: "2000",
    },
  });

  console.log("✓ Holding created:", holding.id);

  // ----------------------------------------------------------
  // 4. Create an order
  // ----------------------------------------------------------

  const order = await prisma.order.create({
    data: {
      portfolioId: portfolio.id,
      symbol: "AAPL",
      assetType: "STOCK",
      side: "BUY",
      type: "MARKET",
      quantity: "5",
    },
  });

  console.log("✓ Order created:", order.id);

  // ----------------------------------------------------------
  // 5. Read the complete relationship tree
  // ----------------------------------------------------------

  const result = await prisma.user.findUnique({
    where: {
      id: user.id,
    },

    include: {
      portfolios: {
        include: {
          holdings: true,
          orders: true,
        },
      },
    },
  });

  console.log("\nRelationship test result:");
  console.dir(result, {
    depth: null,
  });

  // ----------------------------------------------------------
  // 6. Basic assertions
  // ----------------------------------------------------------

  if (!result) {
    throw new Error("User relation query failed");
  }

  if (result.portfolios.length !== 1) {
    throw new Error("Portfolio relation failed");
  }

  if (result.portfolios[0].holdings.length !== 1) {
    throw new Error("Holding relation failed");
  }

  if (result.portfolios[0].orders.length !== 1) {
    throw new Error("Order relation failed");
  }

  console.log("\n✓ All relation checks passed");

  // ----------------------------------------------------------
  // 7. Clean test data
  // ----------------------------------------------------------

  await prisma.order.delete({
    where: {
      id: order.id,
    },
  });

  await prisma.holding.delete({
    where: {
      id: holding.id,
    },
  });

  await prisma.portfolio.delete({
    where: {
      id: portfolio.id,
    },
  });

  await prisma.user.delete({
    where: {
      id: user.id,
    },
  });

  console.log("✓ Test data cleaned up");
  console.log("\nTASK 0 DATABASE TEST PASSED");
}

main()
  .catch((error) => {
    console.error("\nTASK 0 DATABASE TEST FAILED");
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
