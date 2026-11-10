-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "executionAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lastExecutionAttemptAt" TIMESTAMP(3);
