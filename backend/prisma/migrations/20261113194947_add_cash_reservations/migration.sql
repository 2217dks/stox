-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "reservedCash" DECIMAL(18,8) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Portfolio" ADD COLUMN     "reservedCash" DECIMAL(18,8) NOT NULL DEFAULT 0;
