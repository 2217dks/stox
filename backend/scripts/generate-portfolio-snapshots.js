const prisma = require("../src/config/database");
const {
  captureDailyPortfolioSnapshots,
} = require("../src/workers/portfolioSnapshotWorker");

async function main() {
  const args = process.argv.slice(2);
  let targetDate = null;

  for (const arg of args) {
    if (arg.startsWith("--date=")) {
      targetDate = arg.split("=")[1];
    }
  }

  const result = await captureDailyPortfolioSnapshots({
    targetDate: targetDate || null,
  });

  console.log(`Generated portfolio snapshots for ${result.snapshotDate} (asOf: ${result.asOf}):`);
  console.log(`- Total active portfolios: ${result.totalPortfolios}`);
  console.log(`- Successful: ${result.successful}`);
  console.log(`- Failed: ${result.failed}`);

  if (result.errors && result.errors.length > 0) {
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
