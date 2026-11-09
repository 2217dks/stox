const prisma = require("../src/config/database");
const {
  generateLeaderboardSnapshots,
} = require("../src/services/leaderboardService");

async function main() {
  const result = await generateLeaderboardSnapshots();

  console.log(
    `Generated leaderboard snapshots for ${result.snapshotDate.toISOString().slice(0, 10)}:`,
  );

  for (const leaderboard of result.leaderboards) {
    console.log(`- ${leaderboard.period}: ${leaderboard.entries} entries`);
  }
}

main()
  .catch((error) => {
    console.error("Failed to generate leaderboard snapshots:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
