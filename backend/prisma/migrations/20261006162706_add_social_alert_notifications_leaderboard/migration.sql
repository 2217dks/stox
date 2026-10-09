-- CreateEnum
CREATE TYPE "AlertCondition" AS ENUM ('PRICE_ABOVE', 'PRICE_BELOW', 'PERCENT_CHANGE_UP', 'PERCENT_CHANGE_DOWN');

-- CreateEnum
CREATE TYPE "AlertStatus" AS ENUM ('ACTIVE', 'TRIGGERED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('ORDER_EXECUTED', 'PRICE_ALERT', 'ACHIEVEMENT_UNLOCKED', 'COPY_TRADE_EXECUTED', 'LEAGUE_UPDATE', 'NEW_FOLLOWER', 'SYSTEM');

-- CreateEnum
CREATE TYPE "LeaderboardScope" AS ENUM ('GLOBAL', 'FRIENDS');

-- CreateEnum
CREATE TYPE "LeaderboardPeriod" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY', 'ALL_TIME');

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "data" JSONB,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Follow" (
    "id" TEXT NOT NULL,
    "followerId" TEXT NOT NULL,
    "followingId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Follow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Alert" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "symbolId" TEXT NOT NULL,
    "condition" "AlertCondition" NOT NULL,
    "targetPrice" DECIMAL(18,8) NOT NULL,
    "status" "AlertStatus" NOT NULL DEFAULT 'ACTIVE',
    "sendEmail" BOOLEAN NOT NULL DEFAULT true,
    "sendPush" BOOLEAN NOT NULL DEFAULT false,
    "triggeredAt" TIMESTAMP(3),
    "message" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaderboardEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "scope" "LeaderboardScope" NOT NULL,
    "period" "LeaderboardPeriod" NOT NULL,
    "rank" INTEGER NOT NULL,
    "totalValue" DECIMAL(18,8) NOT NULL,
    "returnPct" DECIMAL(10,4) NOT NULL,
    "snapshotDate" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeaderboardEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Post" (
    "id" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "symbol" TEXT,
    "metadata" JSONB,
    "isHidden" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Post_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Notification_userId_isRead_idx" ON "Notification"("userId", "isRead");

-- CreateIndex
CREATE INDEX "Notification_createdAt_idx" ON "Notification"("createdAt");

-- CreateIndex
CREATE INDEX "Follow_followerId_idx" ON "Follow"("followerId");

-- CreateIndex
CREATE INDEX "Follow_followingId_idx" ON "Follow"("followingId");

-- CreateIndex
CREATE UNIQUE INDEX "Follow_followerId_followingId_key" ON "Follow"("followerId", "followingId");

-- CreateIndex
CREATE INDEX "Alert_userId_status_idx" ON "Alert"("userId", "status");

-- CreateIndex
CREATE INDEX "Alert_status_symbolId_idx"
ON "Alert"("status", "symbolId");

CREATE INDEX "Alert_symbolId_idx"
ON "Alert"("symbolId");

-- CreateIndex
CREATE INDEX "LeaderboardEntry_scope_period_snapshotDate_rank_idx" ON "LeaderboardEntry"("scope", "period", "snapshotDate", "rank");

-- CreateIndex
CREATE UNIQUE INDEX "LeaderboardEntry_scope_period_snapshotDate_userId_key" ON "LeaderboardEntry"("scope", "period", "snapshotDate", "userId");

-- CreateIndex
CREATE INDEX "Post_authorId_createdAt_idx" ON "Post"("authorId", "createdAt");

-- CreateIndex
CREATE INDEX "Post_createdAt_idx" ON "Post"("createdAt");

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Follow" ADD CONSTRAINT "Follow_followerId_fkey" FOREIGN KEY ("followerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Follow" ADD CONSTRAINT "Follow_followingId_fkey" FOREIGN KEY ("followingId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaderboardEntry" ADD CONSTRAINT "LeaderboardEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Post" ADD CONSTRAINT "Post_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Alert"
ADD CONSTRAINT "Alert_symbolId_fkey"
FOREIGN KEY ("symbolId")
REFERENCES "Symbol"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;
