-- Durable marker for the copy-trade fan-out pass. A trade without a marker is
-- picked up by the periodic scan, which recovers a fan-out enqueue lost during
-- a Redis outage.
ALTER TABLE "Trade" ADD COLUMN     "copyFanOutAt" TIMESTAMP(3);

CREATE INDEX "Trade_copyFanOutAt_executedAt_idx" ON "Trade"("copyFanOutAt", "executedAt");
