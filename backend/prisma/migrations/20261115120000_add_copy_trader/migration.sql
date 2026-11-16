-- CreateTable
CREATE TABLE "CopyTrader" (
    "id" TEXT NOT NULL,
    "copierId" TEXT NOT NULL,
    "copiedId" TEXT NOT NULL,
    "allocationPct" DECIMAL(5,2) NOT NULL DEFAULT 100,
    "maxTradeSize" DECIMAL(18,8),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CopyTrader_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CopyTrader_allocationPct_check" CHECK ("allocationPct" > 0 AND "allocationPct" <= 100),
    CONSTRAINT "CopyTrader_copierId_copiedId_check" CHECK ("copierId" <> "copiedId"),
    CONSTRAINT "CopyTrader_maxTradeSize_check" CHECK ("maxTradeSize" IS NULL OR "maxTradeSize" > 0)
);

-- CreateIndex
CREATE UNIQUE INDEX "CopyTrader_copierId_copiedId_key" ON "CopyTrader"("copierId", "copiedId");

-- CreateIndex
CREATE INDEX "CopyTrader_copierId_idx" ON "CopyTrader"("copierId");

-- CreateIndex
CREATE INDEX "CopyTrader_copiedId_idx" ON "CopyTrader"("copiedId");

-- AddForeignKey
ALTER TABLE "CopyTrader" ADD CONSTRAINT "CopyTrader_copierId_fkey" FOREIGN KEY ("copierId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CopyTrader" ADD CONSTRAINT "CopyTrader_copiedId_fkey" FOREIGN KEY ("copiedId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
