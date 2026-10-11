const { z } = require("zod");
const { sideEnum, symbolField, dateBoundSchema } = require("./orderValidator");
const { TRADE_SORT_FIELDS } = require("../services/tradeService");

const tradeIdParamSchema = z.object({
  id: z.string().uuid("Invalid trade ID."),
});

// Allowlisted sort field + direction; both optional, defaulting to the
// service's pinned executedAt desc. The enum is derived from the service's
// TRADE_SORT_FIELDS so the two can never drift.
const sortFieldEnum = z.enum(TRADE_SORT_FIELDS);
const orderEnum = z.enum(["asc", "desc"]);

// Filter contract mirrors GET /orders (docs/API.md conventions) minus
// status/type: every trade is an executed order, so those dimensions do
// not exist. The date window applies to executedAt.
const listTradesQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    symbol: symbolField.optional(),
    side: sideEnum.optional(),
    portfolioId: z.string().uuid("Invalid portfolio ID.").optional(),
    from: dateBoundSchema(0).optional(),
    to: dateBoundSchema(1).optional(),
    sort: sortFieldEnum.optional(),
    order: orderEnum.optional(),
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
  tradeIdParamSchema,
  listTradesQuerySchema,
};
