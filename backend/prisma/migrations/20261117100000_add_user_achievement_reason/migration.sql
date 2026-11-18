ALTER TABLE "UserAchievement"
ADD COLUMN "reason" TEXT;

UPDATE "UserAchievement" AS user_achievement
SET "reason" = achievement."description"
FROM "Achievement" AS achievement
WHERE achievement."id" = user_achievement."achievementId";

ALTER TABLE "UserAchievement"
ALTER COLUMN "reason" SET NOT NULL;
