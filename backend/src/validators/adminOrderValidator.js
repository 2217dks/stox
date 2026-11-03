const { z } = require("zod");

const {
  statusFilter,
  symbolField,
  sideEnum,
  orderTypeEnum,
  dateBoundSchema,
} = require("./orderValidator");

// Administrative order listing reuses the user-facing order filter contract
// (docs/API.md) so both views stay consistent, and adds `userId` so an
// administrator can narrow the cross-user view to the orders of one owner.
// Unknown query keys are stripped by Zod rather than rejected, matching the
// existing order list endpoint.
const adminOrderListQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    status: statusFilter,
    symbol: symbolField.optional(),
    side: sideEnum.optional(),
    type: orderTypeEnum.optional(),
    portfolioId: z.string().uuid("Invalid portfolio ID.").optional(),
    userId: z.string().uuid("Invalid user ID.").optional(),
    from: dateBoundSchema(0).optional(),
    to: dateBoundSchema(1).optional(),
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
  adminOrderListQuerySchema,
};
