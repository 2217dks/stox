const { z } = require("zod");
const { sideEnum, symbolField, dateBoundSchema } = require("./orderValidator");

const publicUserParamsSchema = z.object({
  id: z.string().uuid("Invalid user ID."),
});

const tradeStatisticsQuerySchema = z
  .object({
    portfolioId: z.string().uuid("Invalid portfolio ID.").optional(),
    symbol: symbolField.optional(),
    side: sideEnum.optional(),
    from: dateBoundSchema(0).optional(),
    to: dateBoundSchema(1).optional(),
    includeMonthly: z
      .preprocess((val) => {
        if (typeof val === "string") {
          return val.toLowerCase() === "true";
        }
        return Boolean(val);
      }, z.boolean())
      .optional(),
  })
  .superRefine((query, ctx) => {
    if (query.from && query.to && query.from >= query.to) {
      ctx.addIssue({
        code: "custom",
        path: ["to"],
        message: "'to' must be later than 'from'.",
      });
    }
  });

module.exports = {
  publicUserParamsSchema,
  tradeStatisticsQuerySchema,
};
