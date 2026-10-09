require("dotenv").config();

const bcrypt = require("bcryptjs");
const crypto = require("crypto");
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

// ============================================================
// SEED FIXTURE IDENTITY (UUIDv5, deterministic)
//
// Every seeded order carries a PRIMARY KEY derived from a stable
// fixture name via UUIDv5 (RFC 4122 name-based, SHA-1): the same
// name always produces the same id, on every machine, on every run.
//
// This makes the seeder idempotent by identity, not by guessing:
// - Re-runs find their fixtures by primary key and never duplicate,
//   no matter how the order's mutable fields (status, prices,
//   timestamps) have changed since — cancelling a seeded order does
//   NOT cause a duplicate on the next run.
// - Application-created orders can never collide with fixtures:
//   the app's creation path never supplies an id, so user rows are
//   always random UUIDv4, while fixture rows are namespaced UUIDv5.
//
// SEED_NAMESPACE is arbitrary but MUST stay fixed: changing it (or
// any fixture name) changes every fixture id, and existing dev
// databases would seed a fresh copy alongside the old rows.
// ============================================================

const SEED_NAMESPACE = "9f8e7d6c-5a4b-3c2d-1e0f-1a2b3c4d5e6f";

function uuidv5(name, namespace) {
  const namespaceBytes = Buffer.from(namespace.replace(/-/g, ""), "hex");
  const hash = crypto
    .createHash("sha1")
    .update(namespaceBytes)
    .update(Buffer.from(name, "utf8"))
    .digest();

  hash[6] = (hash[6] & 0x0f) | 0x50; // version 5
  hash[8] = (hash[8] & 0x3f) | 0x80; // RFC 4122 variant

  const hex = hash.subarray(0, 16).toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

function fixtureId(label, key) {
  return uuidv5(`${label}:${key}`, SEED_NAMESPACE);
}

function addDays(days) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

// ============================================================
// SYMBOL CATALOG (schema: Symbol model)
// ============================================================

const SYMBOL_CATALOG = [
  {
    symbol: "AAPL",
    name: "Apple Inc.",
    assetType: "STOCK",
    exchange: "NASDAQ",
    sector: "Technology",
    industry: "Consumer Electronics",
  },
  {
    symbol: "MSFT",
    name: "Microsoft Corporation",
    assetType: "STOCK",
    exchange: "NASDAQ",
    sector: "Technology",
    industry: "Software",
  },
  {
    symbol: "TSLA",
    name: "Tesla, Inc.",
    assetType: "STOCK",
    exchange: "NASDAQ",
    sector: "Consumer Discretionary",
    industry: "Automobile Manufacturers",
  },
  {
    symbol: "NVDA",
    name: "NVIDIA Corporation",
    assetType: "STOCK",
    exchange: "NASDAQ",
    sector: "Technology",
    industry: "Semiconductors",
  },
  {
    symbol: "AMD",
    name: "Advanced Micro Devices, Inc.",
    assetType: "STOCK",
    exchange: "NASDAQ",
    sector: "Technology",
    industry: "Semiconductors",
  },
  {
    symbol: "BTCUSDT",
    name: "Bitcoin / TetherUS",
    assetType: "CRYPTO",
    exchange: "BINANCE",
  },
  {
    symbol: "ETHUSDT",
    name: "Ethereum / TetherUS",
    assetType: "CRYPTO",
    exchange: "BINANCE",
  },
  {
    symbol: "SOLUSDT",
    name: "Solana / TetherUS",
    assetType: "CRYPTO",
    exchange: "BINANCE",
  },
  {
    symbol: "DOGEUSDT",
    name: "Dogecoin / TetherUS",
    assetType: "CRYPTO",
    exchange: "BINANCE",
  },
];

async function seedSymbols() {
  for (const data of SYMBOL_CATALOG) {
    await prisma.symbol.upsert({
      where: { symbol: data.symbol },
      update: {},
      create: data,
    });
  }

  return SYMBOL_CATALOG.length;
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

// ============================================================
// ORDERS — one spec per fixture, covering every status and type.
// Each spec names its fixture (`key`); the primary key is derived
// from `${portfolioLabel}:${key}` so identity never depends on
// mutable order state.
// ============================================================

function buildOrderSpecs(portfolioSlots) {
  const [first, second, third] = portfolioSlots;

  function spec(slot, key, data) {
    return { id: fixtureId(slot.label, key), ...data };
  }

  return [
    // ---- EXECUTED ----
    spec(first, "executed-aapl-buy-market", {
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
    }),
    spec(first, "executed-msft-buy-market", {
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
    }),
    spec(first, "executed-aapl-sell-market", {
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
    }),
    spec(second, "executed-btcusdt-buy-limit", {
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
    }),
    spec(second, "executed-nvda-buy-market", {
      portfolioId: second.id,
      symbol: "NVDA",
      assetType: "STOCK",
      side: "BUY",
      type: "MARKET",
      status: "EXECUTED",
      quantity: "3",
      executedPrice: "132.40",
      executedAt: addDays(-4),
      notes: "Seeded market buy",
    }),
    spec(third, "executed-solusdt-sell-market", {
      portfolioId: third.id,
      symbol: "SOLUSDT",
      assetType: "CRYPTO",
      side: "SELL",
      type: "MARKET",
      status: "EXECUTED",
      quantity: "5",
      executedPrice: "148.25",
      executedAt: addDays(-1),
      notes: "Seeded market sell",
    }),

    // ---- PENDING ----
    spec(first, "pending-tsla-buy-limit", {
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
    }),
    spec(first, "pending-aapl-sell-stop-loss", {
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
    }),
    spec(first, "pending-nvda-buy-take-profit", {
      portfolioId: first.id,
      symbol: "NVDA",
      assetType: "STOCK",
      side: "BUY",
      type: "TAKE_PROFIT",
      status: "PENDING",
      quantity: "2",
      stopPrice: "98.00",
      expiresAt: addDays(30),
      notes: "Seeded pending take profit",
    }),
    spec(second, "pending-btcusdt-sell-take-profit", {
      portfolioId: second.id,
      symbol: "BTCUSDT",
      assetType: "CRYPTO",
      side: "SELL",
      type: "TAKE_PROFIT",
      status: "PENDING",
      quantity: "0.2",
      stopPrice: "72000.00",
      expiresAt: addDays(21),
      notes: "Seeded pending crypto take profit",
    }),
    spec(third, "pending-ethusdt-buy-limit", {
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
    }),
    spec(third, "pending-solusdt-buy-stop-loss", {
      portfolioId: third.id,
      symbol: "SOLUSDT",
      assetType: "CRYPTO",
      side: "BUY",
      type: "STOP_LOSS",
      status: "PENDING",
      quantity: "5",
      stopPrice: "120.00",
      expiresAt: addDays(14),
      notes: "Seeded pending crypto stop loss",
    }),

    // ---- CANCELLED ----
    spec(first, "cancelled-amd-buy-market", {
      portfolioId: first.id,
      symbol: "AMD",
      assetType: "STOCK",
      side: "BUY",
      type: "MARKET",
      status: "CANCELLED",
      quantity: "4",
      notes: "Seeded cancelled market buy",
    }),
    spec(third, "cancelled-dogeusdt-buy-limit", {
      portfolioId: third.id,
      symbol: "DOGEUSDT",
      assetType: "CRYPTO",
      side: "BUY",
      type: "LIMIT",
      status: "CANCELLED",
      quantity: "1000",
      limitPrice: "0.12",
      notes: "Seeded cancelled limit buy",
    }),

    // ---- EXPIRED ----
    spec(second, "expired-tsla-buy-limit", {
      portfolioId: second.id,
      symbol: "TSLA",
      assetType: "STOCK",
      side: "BUY",
      type: "LIMIT",
      status: "EXPIRED",
      quantity: "2",
      limitPrice: "180.00",
      expiresAt: addDays(-1),
      notes: "Seeded expired limit buy",
    }),
    spec(third, "expired-msft-sell-stop-loss", {
      portfolioId: third.id,
      symbol: "MSFT",
      assetType: "STOCK",
      side: "SELL",
      type: "STOP_LOSS",
      status: "EXPIRED",
      quantity: "3",
      stopPrice: "380.00",
      expiresAt: addDays(-2),
      notes: "Seeded expired stop loss",
    }),

    // ---- REJECTED ----
    spec(third, "rejected-nvda-buy-market", {
      portfolioId: third.id,
      symbol: "NVDA",
      assetType: "STOCK",
      side: "BUY",
      type: "MARKET",
      status: "REJECTED",
      quantity: "1000",
      notes: "Seeded rejected order (insufficient balance)",
    }),
  ];
}

// A fixture exists if and only if its derived primary key exists.
// Existing fixtures are left completely untouched — the seeder never
// overwrites state that users (or the trading engine) have changed.
async function seedOrder(spec) {
  const existing = await prisma.order.findUnique({
    where: { id: spec.id },
  });

  if (existing) {
    return { order: existing, created: false };
  }

  const order = await prisma.order.create({ data: spec });
  return { order, created: true };
}

async function seedOrders(portfolioSlots) {
  const specs = buildOrderSpecs(portfolioSlots);

  const orders = [];
  const executedOrders = [];
  let created = 0;

  for (const spec of specs) {
    const { order, created: wasCreated } = await seedOrder(spec);
    orders.push(order);

    if (wasCreated) {
      created += 1;
    }

    if (order.status === "EXECUTED") {
      executedOrders.push(order);
    }
  }

  return { orders, executedOrders, created };
}

// Trades hang off executed orders one-to-one (Trade.orderId is unique),
// so both sides are repaired independently: a re-run fills in any trade
// that is missing without duplicating existing ones.
async function seedTrades(executedOrders) {
  const trades = [];

  for (const order of executedOrders) {
    const existing = await prisma.trade.findUnique({
      where: { orderId: order.id },
    });

    if (existing) {
      trades.push(existing);
      continue;
    }

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

  const symbolCount = await seedSymbols();
  console.log(`Symbols: ${symbolCount} catalog entries`);

  const { admin, users } = await seedUsers();
  console.log(`Users: admin ${admin.email} + ${users.length} traders`);

  const portfolios = await seedPortfolios(users);
  console.log(`Portfolios: ${portfolios.length}`);

  const portfolioSlots = portfolios.map((portfolio, index) => ({
    label: `trader${index + 1}`,
    id: portfolio.id,
  }));

  const { orders, executedOrders, created } = await seedOrders(
    portfolioSlots,
  );
  const statusCounts = orders.reduce((counts, order) => {
    counts[order.status] = (counts[order.status] || 0) + 1;
    return counts;
  }, {});
  const statusSummary = Object.entries(statusCounts)
    .map(([status, count]) => `${status}: ${count}`)
    .join(", ");
  console.log(
    `Orders: ${orders.length} total (${created} newly created) — ${statusSummary}`,
  );

  const trades = await seedTrades(executedOrders);
  console.log(`Trades: ${trades.length}`);

  console.log("Seed complete. Demo password:", DEMO_PASSWORD);
  console.log(
    "Try it: login as trader1@stox.com / Password1! then GET /api/v1/orders?status=PENDING",
  );
}

module.exports = {
  SEED_NAMESPACE,
  uuidv5,
  fixtureId,
  seedSymbols,
  seedUsers,
  seedPortfolios,
  buildOrderSpecs,
  seedOrders,
  seedTrades,
  // Test entry points import this module's functions; this lets them
  // release the module's own Prisma connection pool.
  disconnect: () => prisma.$disconnect(),
};

if (require.main === module) {
  main()
    .catch((error) => {
      console.error("Seed failed:", error);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
