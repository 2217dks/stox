const prisma = require("../src/config/database");
const {
  captureDailyPortfolioSnapshots,
} = require("../src/workers/portfolioSnapshotWorker");

async function main() {
  const result = await captureDailyPortfolioSnapshots();

  console.log(`Generated portfolio snapshots for ${result.snapshotDate}:`);
  console.log(`- Total active portfolios: ${result.totalPortfolios}`);
  console.log(`- Successful: ${result.successful}`);
  console.log(`- Failed: ${result.failed}`);

  if (result.errors.length > 0) {
    console.warn("Errors encountered during snapshot generation:");
    for (const err of result.errors) {
      console.warn(`  - Portfolio ${err.portfolioId}: ${err.error}`);
    }
  }
}

main()
  .catch((error) => {
    console.error("Failed to generate portfolio snapshots:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
