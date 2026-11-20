CREATE TABLE "AdminAccountAction" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AdminAccountAction_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AdminAccountAction_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AdminAccountAction_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "AdminAccountAction_targetId_createdAt_idx" ON "AdminAccountAction"("targetId", "createdAt");
CREATE INDEX "AdminAccountAction_actorId_createdAt_idx" ON "AdminAccountAction"("actorId", "createdAt");
