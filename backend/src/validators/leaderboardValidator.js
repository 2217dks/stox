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

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
const dateStringSchema = z
  .string()
  .regex(dateRegex, "Date must be in YYYY-MM-DD format")
  .refine((val) => !isNaN(Date.parse(val)), "Date must be a valid calendar date");

const leaderboardHistoryQuerySchema = z
  .object({
    period: leaderboardPeriodEnum.default("ALL_TIME"),

    date: dateStringSchema.optional(),

    from: dateStringSchema.optional(),

    to: dateStringSchema.optional(),

    page: z.coerce.number().int().min(1).default(1),

    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .refine(
    (data) => !(data.date && (data.from || data.to)),
    {
      message: "Cannot specify both exact date and date range (from/to)",
      path: ["date"],
    },
  )
  .refine(
    (data) => !(data.from && data.to && data.from > data.to),
    {
      message: "from date must be before or equal to to date",
      path: ["from"],
    },
  );

module.exports = {
  leaderboardPeriodEnum,
  leaderboardQuerySchema,
  leaderboardHistoryQuerySchema,
};
