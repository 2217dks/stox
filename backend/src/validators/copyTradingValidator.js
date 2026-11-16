const { z } = require("zod");

// Decimal(5,2): three integer digits and two decimal places, with the
// additional business constraint 0 < allocationPct <= 100. The database has
// the same CHECK constraint; the validator keeps the HTTP error a clean 400
// instead of leaking a Postgres constraint violation as a 500.
const allocationPctSchema = z.preprocess(
  (value) => {
    if (typeof value === "number") {
      return String(value);
    }

    if (typeof value === "string") {
      return value.trim();
    }

    return value;
  },
  z
    .string()
    .regex(
      /^\d{1,3}(\.\d{1,2})?$/,
      "allocationPct must be a decimal with at most 2 decimal places.",
    )
    .refine((value) => {
      const number = Number(value);
      return number > 0 && number <= 100;
    }, "allocationPct must be greater than 0 and at most 100."),
);

// Decimal(18,8): ten integer digits and eight decimal places.
const maxTradeSizeSchema = z.preprocess(
  (value) => {
    if (typeof value === "number") {
      return String(value);
    }

    if (typeof value === "string") {
      return value.trim();
    }

    return value;
  },
  z
    .string()
    .regex(
      /^\d{1,10}(\.\d{1,8})?$/,
      "maxTradeSize must be a valid decimal with at most 8 decimal places.",
    )
    .refine(
      (value) => !/^0+(\.0+)?$/.test(value),
      "maxTradeSize must be greater than zero.",
    ),
);

const booleanQuerySchema = z.preprocess(
  (value) => {
    if (value === "true") {
      return true;
    }

    if (value === "false") {
      return false;
    }

    return value;
  },
  z.boolean(),
);

const createCopyTraderSchema = z.object({
  traderId: z.string().uuid("Invalid trader ID."),
  allocationPct: allocationPctSchema.optional().default("100"),
  maxTradeSize: maxTradeSizeSchema.optional().nullable().default(null),
  copyPortfolioId: z.string().uuid("Invalid portfolio ID.").optional().nullable(),
  isActive: z.boolean().optional().default(true),
});

const updateCopyTraderSchema = z
  .strictObject({
    allocationPct: allocationPctSchema.optional(),
    maxTradeSize: z
      .union([maxTradeSizeSchema, z.null()])
      .optional(),
    copyPortfolioId: z
      .union([z.string().uuid("Invalid portfolio ID."), z.null()])
      .optional(),
    isActive: z.boolean().optional(),
  })
  .refine((data) => Object.values(data).some((value) => value !== undefined), {
    message: "At least one copy-trading field must be provided.",
  });

const copyTraderIdParamSchema = z.object({
  id: z.string().uuid("Invalid copy-trading relationship ID."),
});

const listCopyTradersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  isActive: booleanQuerySchema.optional(),
});

module.exports = {
  createCopyTraderSchema,
  updateCopyTraderSchema,
  copyTraderIdParamSchema,
  listCopyTradersQuerySchema,
};
