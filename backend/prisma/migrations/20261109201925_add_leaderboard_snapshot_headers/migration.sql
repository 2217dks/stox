-- CreateTable
CREATE TABLE "LeaderboardSnapshot" (
    "id" TEXT NOT NULL,
    "scope" "LeaderboardScope" NOT NULL,
    "period" "LeaderboardPeriod" NOT NULL,
    "snapshotDate" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeaderboardSnapshot_pkey" PRIMARY KEY ("id")
);

-- Backfill one snapshot header for every existing leaderboard period/date.
INSERT INTO "LeaderboardSnapshot" (
    "id",
    "scope",
    "period",
    "snapshotDate"
)
SELECT
    gen_random_uuid()::text,
    "scope",
    "period",
    "snapshotDate"
FROM "LeaderboardEntry"
GROUP BY "scope", "period", "snapshotDate";

-- Add the relation column as nullable initially.
ALTER TABLE "LeaderboardEntry"
ADD COLUMN "snapshotId" TEXT;

-- Associate existing entries with their corresponding snapshot.
UPDATE "LeaderboardEntry" AS entry
SET "snapshotId" = snapshot."id"
FROM "LeaderboardSnapshot" AS snapshot
WHERE entry."scope" = snapshot."scope"
  AND entry."period" = snapshot."period"
  AND entry."snapshotDate" = snapshot."snapshotDate";

-- Every existing entry must now have a snapshot.
ALTER TABLE "LeaderboardEntry"
ALTER COLUMN "snapshotId" SET NOT NULL;

-- Create indexes.
CREATE INDEX "LeaderboardSnapshot_scope_period_snapshotDate_idx"
ON "LeaderboardSnapshot"("scope", "period", "snapshotDate");

CREATE UNIQUE INDEX "LeaderboardSnapshot_scope_period_snapshotDate_key"
ON "LeaderboardSnapshot"("scope", "period", "snapshotDate");

CREATE INDEX "LeaderboardEntry_snapshotId_idx"
ON "LeaderboardEntry"("snapshotId");

-- CreateForeignKey
ALTER TABLE "LeaderboardEntry"
ADD CONSTRAINT "LeaderboardEntry_snapshotId_fkey"
FOREIGN KEY ("snapshotId")
REFERENCES "LeaderboardSnapshot"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;