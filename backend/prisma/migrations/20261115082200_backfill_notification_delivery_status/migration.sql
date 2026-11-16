-- Existing notifications predate outbound delivery. Mark them as processed so
-- the pending-notification scan does not email or push historical rows. This
-- migration ships in the same PR as the delivery columns and the worker, so it
-- runs before the new worker is deployed.
UPDATE "Notification"
SET "deliveryStatus" = 'SKIPPED',
    "deliveredAt" = NOW()
WHERE "deliveryStatus" = 'PENDING'
  AND "deliveryAttempts" = 0;
