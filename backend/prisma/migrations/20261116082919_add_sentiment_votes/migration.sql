-- CreateEnum
CREATE TYPE "Sentiment" AS ENUM ('BULLISH', 'BEARISH', 'NEUTRAL');

-- CreateTable
CREATE TABLE "SentimentVote" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "sentiment" "Sentiment" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SentimentVote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SentimentVote_symbol_updatedAt_idx" ON "SentimentVote"("symbol", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SentimentVote_userId_symbol_key" ON "SentimentVote"("userId", "symbol");

-- AddForeignKey
ALTER TABLE "SentimentVote" ADD CONSTRAINT "SentimentVote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
