-- AlterTable
ALTER TABLE "Alert" ADD COLUMN     "lastEvaluatedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "deliveryStartedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Alert_status_lastEvaluatedAt_idx" ON "Alert"("status", "lastEvaluatedAt");
