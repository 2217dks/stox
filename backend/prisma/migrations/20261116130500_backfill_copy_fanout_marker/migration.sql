-- Existing trades predate the copy-trade fan-out. Mark them as already
-- processed so the recovery scan does not replay historical trades to
-- current followers.
UPDATE "Trade"
SET "copyFanOutAt" = CURRENT_TIMESTAMP
WHERE "copyFanOutAt" IS NULL;
