const { z } = require("zod");

const leaderboardPeriodEnum = z.enum([
  "DAILY",
  "WEEKLY",
  "MONTHLY",
  "ALL_TIME",
]);

const leaderboardQuerySchema = z.object({
  period: leaderboardPeriodEnum.default("ALL_TIME"),

  page: z.coerce.number().int().min(1).default(1),

  limit: z.coerce.number().int().min(1).max(100).default(20),
});

module.exports = {
  leaderboardQuerySchema,
};
