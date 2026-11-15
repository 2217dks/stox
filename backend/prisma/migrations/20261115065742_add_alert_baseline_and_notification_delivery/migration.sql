-- CreateEnum
CREATE TYPE "NotificationDeliveryStatus" AS ENUM ('PENDING', 'SENDING', 'DELIVERED', 'SKIPPED', 'FAILED');

-- AlterTable
ALTER TABLE "Alert" ADD COLUMN     "baselineAt" TIMESTAMP(3),
ADD COLUMN     "baselinePrice" DECIMAL(18,8);

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "deliveredAt" TIMESTAMP(3),
ADD COLUMN     "deliveryChannels" JSONB,
ADD COLUMN     "deliveryStatus" "NotificationDeliveryStatus" NOT NULL DEFAULT 'PENDING';
