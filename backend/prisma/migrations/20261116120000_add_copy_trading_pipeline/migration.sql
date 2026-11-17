-- Copy-trading pipeline: destination portfolio, durable fan-out audit rows,
-- and indexes for the new expiry/copy-trade/delivery scans.

-- CreateEnum
CREATE TYPE "CopyExecutionStatus" AS ENUM ('PENDING', 'PLACED', 'FAILED', 'SKIPPED');

-- DropIndex
DROP INDEX "CopyTrader_copiedId_idx";

-- DropIndex
DROP INDEX "CopyTrader_copierId_idx";

-- AlterTable
ALTER TABLE "CopyTrader" ADD COLUMN     "copyPortfolioId" TEXT;

-- Backfill existing relationships with the copier's default active portfolio,
-- then fall back to the oldest active portfolio. New rows are always written
-- with an explicit destination by the copy-trading service.
UPDATE "CopyTrader" AS ct
SET "copyPortfolioId" = p."id"
FROM "Portfolio" AS p
WHERE p."userId" = ct."copierId"
  AND p."isDefault" = true
  AND p."isActive" = true
  AND ct."copyPortfolioId" IS NULL;

UPDATE "CopyTrader" AS ct
SET "copyPortfolioId" = p."id"
FROM (
  SELECT DISTINCT ON ("userId") "id", "userId"
  FROM "Portfolio"
  WHERE "isActive" = true
  ORDER BY "userId", "createdAt" ASC
) AS p
WHERE p."userId" = ct."copierId"
  AND ct."copyPortfolioId" IS NULL;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "copyTradeExecutionId" TEXT;

-- CreateTable
CREATE TABLE "CopyTradeExecution" (
    "id" TEXT NOT NULL,
    "sourceTradeId" TEXT NOT NULL,
    "copierId" TEXT NOT NULL,
    "copyTraderId" TEXT,
    "status" "CopyExecutionStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "failureCode" TEXT,
    "failureMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CopyTradeExecution_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CopyTradeExecution_copierId_createdAt_idx" ON "CopyTradeExecution"("copierId", "createdAt");

-- CreateIndex
CREATE INDEX "CopyTradeExecution_status_createdAt_idx" ON "CopyTradeExecution"("status", "createdAt");

-- CreateIndex
CREATE INDEX "CopyTradeExecution_copyTraderId_idx" ON "CopyTradeExecution"("copyTraderId");

-- CreateIndex
CREATE UNIQUE INDEX "CopyTradeExecution_sourceTradeId_copierId_key" ON "CopyTradeExecution"("sourceTradeId", "copierId");

-- CreateIndex
CREATE INDEX "CopyTrader_copierId_isActive_idx" ON "CopyTrader"("copierId", "isActive");

-- CreateIndex
CREATE INDEX "CopyTrader_copiedId_isActive_idx" ON "CopyTrader"("copiedId", "isActive");

-- CreateIndex
CREATE INDEX "CopyTrader_copyPortfolioId_idx" ON "CopyTrader"("copyPortfolioId");

-- CreateIndex
CREATE INDEX "Notification_deliveryStatus_createdAt_idx" ON "Notification"("deliveryStatus", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Order_copyTradeExecutionId_key" ON "Order"("copyTradeExecutionId");

-- CreateIndex
CREATE INDEX "Order_status_expiresAt_idx" ON "Order"("status", "expiresAt");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_copyTradeExecutionId_fkey" FOREIGN KEY ("copyTradeExecutionId") REFERENCES "CopyTradeExecution"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CopyTrader" ADD CONSTRAINT "CopyTrader_copyPortfolioId_fkey" FOREIGN KEY ("copyPortfolioId") REFERENCES "Portfolio"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CopyTradeExecution" ADD CONSTRAINT "CopyTradeExecution_sourceTradeId_fkey" FOREIGN KEY ("sourceTradeId") REFERENCES "Trade"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CopyTradeExecution" ADD CONSTRAINT "CopyTradeExecution_copierId_fkey" FOREIGN KEY ("copierId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CopyTradeExecution" ADD CONSTRAINT "CopyTradeExecution_copyTraderId_fkey" FOREIGN KEY ("copyTraderId") REFERENCES "CopyTrader"("id") ON DELETE SET NULL ON UPDATE CASCADE;
