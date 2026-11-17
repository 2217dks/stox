ALTER TABLE "Notification"
ADD COLUMN "eventKey" TEXT;

CREATE UNIQUE INDEX "Notification_eventKey_key"
ON "Notification"("eventKey");
