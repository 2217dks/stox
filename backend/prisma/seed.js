require("dotenv").config();

const bcrypt = require("bcryptjs");
const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
});

const prisma = new PrismaClient({
  adapter,
});

const DEMO_PASSWORD = "Password1!";
const BCRYPT_SALT_ROUNDS = Number.parseInt(
  process.env.BCRYPT_SALT_ROUNDS || "10",
  10,
);

function addDays(days) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

async function seedUsers() {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, BCRYPT_SALT_ROUNDS);

  const admin = await prisma.user.upsert({
    where: { email: "admin@stox.com" },
    update: {},
    create: {
      email: "admin@stox.com",
      name: "Admin",
      passwordHash,
      role: "ADMIN",
      isVerified: true,
    },
  });

  const users = [];
  for (let i = 1; i <= 3; i++) {
    const user = await prisma.user.upsert({
      where: { email: `trader${i}@stox.com` },
      update: {},
      create: {
        email: `trader${i}@stox.com`,
        name: `Trader ${i}`,
        passwordHash,
        role: "TRADER",
        isVerified: true,
      },
    });
    users.push(user);
  }

  return { admin, users };
}

async function seedPortfolios(users) {
  const portfolios = [];

  for (const user of users) {
    const portfolio = await prisma.portfolio.upsert({
      where: {
        userId_name: {
          userId: user.id,
          name: "Main Portfolio",
        },
      },
      update: {},
      create: {
        userId: user.id,
        name: "Main Portfolio",
        description: "Default development portfolio",
        startingBalance: "10000",
        cashBalance: "10000",
        isDefault: true,
        isActive: true,
      },
    });
    portfolios.push(portfolio);
  }

  return portfolios;
}

async function seedOrders(portfolios) {
  const [first, second, third] = portfolios;

  const executedOrders = [
    {
      portfolioId: first.id,
      symbol: "AAPL",
      assetType: "STOCK",
      side: "BUY",
      type: "MARKET",
      status: "EXECUTED",
      quantity: "10",
      executedPrice: "175.50",
      executedAt: addDays(-7),
      notes: "Seeded market buy",
    },
    {
      portfolioId: first.id,
      symbol: "MSFT",
      assetType: "STOCK",
      side: "BUY",
      type: "MARKET",
      status: "EXECUTED",
      quantity: "5",
      executedPrice: "410.20",
      executedAt: addDays(-5),
      notes: "Seeded market buy",
    },
    {
      portfolioId: first.id,
      symbol: "AAPL",
      assetType: "STOCK",
      side: "SELL",
      type: "MARKET",
      status: "EXECUTED",
      quantity: "4",
      executedPrice: "182.00",
      executedAt: addDays(-2),
      notes: "Seeded profitable sell",
    },
    {
      portfolioId: second.id,
      symbol: "BTCUSDT",
      assetType: "CRYPTO",
      side: "BUY",
      type: "LIMIT",
      status: "EXECUTED",
      quantity: "0.5",
      limitPrice: "60000",
      executedPrice: "59850.00",
      executedAt: addDays(-3),
      notes: "Seeded limit fill",
    },
  ];

  const pendingOrders = [
    {
      portfolioId: first.id,
      symbol: "TSLA",
      assetType: "STOCK",
      side: "BUY",
      type: "LIMIT",
      status: "PENDING",
      quantity: "8",
      limitPrice: "215.00",
      expiresAt: addDays(30),
      notes: "Seeded pending limit buy",
    },
    {
      portfolioId: first.id,
      symbol: "AAPL",
      assetType: "STOCK",
      side: "SELL",
      type: "STOP_LOSS",
      status: "PENDING",
      quantity: "6",
      stopPrice: "160.00",
      expiresAt: addDays(30),
      notes: "Seeded pending stop loss",
    },
    {
      portfolioId: third.id,
      symbol: "ETHUSDT",
      assetType: "CRYPTO",
      side: "BUY",
      type: "LIMIT",
      status: "PENDING",
      quantity: "2",
      limitPrice: "2200.00",
      expiresAt: addDays(14),
      notes: "Seeded pending crypto limit",
    },
  ];

  const orders = [];
  for (const data of executedOrders) {
    const order = await prisma.order.create({ data });
    orders.push(order);
  }

  for (const data of pendingOrders) {
    const order = await prisma.order.create({ data });
    orders.push(order);
  }

  return orders;
}

async function seedTrades(executedOrders) {
  const trades = [];

  for (const order of executedOrders) {
    const quantity = Number(order.quantity);
    const price = Number(order.executedPrice);
    const totalValue = quantity * price;

    let realizedPnl = null;
    let realizedPnlPct = null;

    // SELL trades realize P&L against an assumed average buy price.
    if (order.side === "SELL") {
      const averageBuyPrice = order.symbol === "AAPL" ? 175.5 : null;

      if (averageBuyPrice !== null) {
        realizedPnl = (price - averageBuyPrice) * quantity;
        realizedPnlPct = ((price - averageBuyPrice) / averageBuyPrice) * 100;
      }
    }

    const trade = await prisma.trade.create({
      data: {
        portfolioId: order.portfolioId,
        orderId: order.id,
        symbol: order.symbol,
        assetType: order.assetType,
        side: order.side,
        quantity: order.quantity,
        price: order.executedPrice,
        totalValue: totalValue.toFixed(8),
        fees: "0",
        realizedPnl:
          realizedPnl === null ? null : realizedPnl.toFixed(8),
        realizedPnlPct:
          realizedPnlPct === null ? null : realizedPnlPct.toFixed(8),
        executedAt: order.executedAt,
      },
    });

    trades.push(trade);
  }

  return trades;
}

async function main() {
  console.log("Seeding stox development data...");

  const { admin, users } = await seedUsers();
  console.log(`Users: admin ${admin.email} + ${users.length} traders`);

  const portfolios = await seedPortfolios(users);
  console.log(`Portfolios: ${portfolios.length}`);

  const orders = await seedOrders(portfolios);
  const executedOrders = orders.filter((order) => order.status === "EXECUTED");
  console.log(
    `Orders: ${orders.length} (${executedOrders.length} executed, ${orders.length - executedOrders.length} pending)`,
  );

  const trades = await seedTrades(executedOrders);
  console.log(`Trades: ${trades.length}`);

  console.log("Seed complete. Demo password:", DEMO_PASSWORD);
}

main()
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
