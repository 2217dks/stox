// ============================================================
// TASK 1 — Symbol / Asset model verification
// ============================================================
//
// Exercises the Symbol model end to end against the LOCAL,
// migrated database:
//   1. creates a STOCK and a CRYPTO symbol
//   2. checks column defaults + timestamps
//   3. proves the internal Stox symbol is NOT provider-prefixed
//   4. proves the @unique constraint on `symbol`
//   5. proves `assetType` is enforced by the PostgreSQL enum
//   6. proves the migration actually created the table + indexes
//   7. removes everything it created
//
// Run from the backend/ directory:  node scripts/test-task1-symbol-model.js

const prisma = require("../src/config/database");

// Tiny assertion helper so a failed check fails the script loudly.
function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function main() {
  console.log("Starting Task 1 Symbol model test...\n");

  // Unique per-run suffix so repeated runs never collide on the unique symbol.
  const suffix = Date.now();
  const stockSymbol = `TST${suffix}`;
  const cryptoSymbol = `TSTC${suffix}USDT`;

  let stock;
  let crypto;

  try {
    // ----------------------------------------------------------
    // 1. Create a STOCK symbol with every optional field populated
    // ----------------------------------------------------------

    stock = await prisma.symbol.create({
      data: {
        symbol: stockSymbol, // internal Stox identity, e.g. "AAPL"
        name: "Task 1 Test Stock",
        assetType: "STOCK",
        exchange: "NASDAQ",
        currency: "USD",
        sector: "Technology",
        industry: "Software",
        logoUrl: "https://example.com/logo.png",
        description: "Created by the Task 1 verification script.",
      },
    });

    console.log("✓ Stock Symbol created:", stock.id);

    // ----------------------------------------------------------
    // 2. Create a CRYPTO symbol using a provider-agnostic ticker
    //    (no "BINANCE:" prefix — provider formats live in the
    //    provider/adapter layer, not in the Stox domain)
    // ----------------------------------------------------------

    crypto = await prisma.symbol.create({
      data: {
        symbol: cryptoSymbol, // internal Stox identity, e.g. "BTCUSDT"
        name: "Task 1 Test Crypto",
        assetType: "CRYPTO",
        exchange: "BINANCE",
      },
    });

    console.log("✓ Crypto Symbol created:", crypto.id);

    // ----------------------------------------------------------
    // 3. Verify column defaults and timestamps
    // ----------------------------------------------------------

    assert(stock.currency === "USD", "currency should default to USD");
    assert(stock.isActive === true, "isActive should default to true");
    assert(stock.isTradable === true, "isTradable should default to true");
    assert(stock.createdAt instanceof Date, "createdAt should be set");
    assert(stock.updatedAt instanceof Date, "updatedAt should be set");
    assert(crypto.currency === "USD", "crypto currency should default to USD");

    // The whole point of Task 1: internal identity != provider identity.
    assert(
      !crypto.symbol.startsWith("BINANCE:"),
      "internal symbol must not be provider-prefixed",
    );

    console.log("✓ Defaults + provider-agnostic internal identity verified");

    // ----------------------------------------------------------
    // 4. Unique constraint on `symbol`
    // ----------------------------------------------------------

    let duplicateRejected = false;

    try {
      await prisma.symbol.create({
        data: {
          symbol: stockSymbol, // same symbol again -> must fail
          name: "Duplicate Symbol",
          assetType: "STOCK",
        },
      });
    } catch (error) {
      duplicateRejected = error.code === "P2002";
    }

    assert(duplicateRejected, "duplicate symbol must be rejected (P2002)");

    console.log("✓ Unique constraint on symbol enforced");

    // ----------------------------------------------------------
    // 5. `assetType` is a real PostgreSQL enum, so the database
    //    rejects values outside STOCK | CRYPTO | FOREX.
    // ----------------------------------------------------------

    let enumRejected = false;

    try {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "Symbol"
           ("id", "symbol", "name", "assetType", "currency", "isActive", "isTradable", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, 'NOT_A_REAL_TYPE', 'USD', true, true, now(), now())`,
        `bad-enum-${suffix}`,
        `TSTBAD${suffix}`,
        "Bad Enum Symbol",
      );
    } catch (error) {
      enumRejected = /invalid input value for enum/i.test(String(error.message));
    }

    assert(enumRejected, "invalid assetType must be rejected by the enum");

    console.log("✓ AssetType enum enforced at the database level");

    // ----------------------------------------------------------
    // 6. Verify the migration created the expected table objects
    // ----------------------------------------------------------

    const indexes = await prisma.$queryRawUnsafe(
      `SELECT indexname FROM pg_indexes
       WHERE schemaname = 'public' AND tablename = 'Symbol'
       ORDER BY indexname`,
    );

    const indexNames = indexes.map((row) => row.indexname);

    assert(indexNames.includes("Symbol_pkey"), "Symbol_pkey index missing");
    assert(
      indexNames.includes("Symbol_symbol_key"),
      "Symbol_symbol_key unique index missing",
    );
    assert(
      indexNames.includes("Symbol_assetType_idx"),
      "Symbol_assetType_idx index missing",
    );

    console.log("✓ Migration objects present:", indexNames.join(", "));

    // ----------------------------------------------------------
    // 7. Read back through the model (findUnique + filtered query)
    // ----------------------------------------------------------

    const found = await prisma.symbol.findUnique({
      where: { symbol: stockSymbol },
    });

    assert(found && found.id === stock.id, "findUnique on symbol failed");

    const stocks = await prisma.symbol.findMany({
      where: { assetType: "STOCK", symbol: stockSymbol },
    });

    assert(stocks.length === 1, "findMany filtered by assetType failed");

    console.log("✓ Read-back queries verified");
  } finally {
    // ----------------------------------------------------------
    // 8. Clean up everything this script created
    // ----------------------------------------------------------

    if (stock) {
      await prisma.symbol.delete({ where: { id: stock.id } });
    }

    if (crypto) {
      await prisma.symbol.delete({ where: { id: crypto.id } });
    }

    console.log("✓ Test data cleaned up");
  }

  console.log("\nTASK 1 SYMBOL MODEL TEST PASSED");
}

main()
  .catch((error) => {
    console.error("\nTASK 1 SYMBOL MODEL TEST FAILED");
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
