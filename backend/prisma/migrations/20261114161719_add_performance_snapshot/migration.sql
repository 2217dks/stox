-- CreateTable
CREATE TABLE "PerformanceSnapshot" (
    "id" TEXT NOT NULL,
    "portfolioId" TEXT NOT NULL,
    "totalValue" DECIMAL(18,8) NOT NULL,
    "cashBalance" DECIMAL(18,8) NOT NULL,
    "holdingsValue" DECIMAL(18,8) NOT NULL,
    "dailyPnl" DECIMAL(18,8) NOT NULL,
    "dailyPnlPct" DECIMAL(10,4) NOT NULL,
    "snapshotDate" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PerformanceSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PerformanceSnapshot_portfolioId_idx" ON "PerformanceSnapshot"("portfolioId");

-- CreateIndex
CREATE INDEX "PerformanceSnapshot_snapshotDate_idx" ON "PerformanceSnapshot"("snapshotDate");

-- CreateIndex
CREATE UNIQUE INDEX "PerformanceSnapshot_portfolioId_snapshotDate_key" ON "PerformanceSnapshot"("portfolioId", "snapshotDate");

-- AddForeignKey
ALTER TABLE "PerformanceSnapshot" ADD CONSTRAINT "PerformanceSnapshot_portfolioId_fkey" FOREIGN KEY ("portfolioId") REFERENCES "Portfolio"("id") ON DELETE CASCADE ON UPDATE CASCADE;
