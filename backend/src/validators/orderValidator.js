const { z } = require("zod");

const decimalQuantity = z.preprocess(
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
      /^\d+(\.\d{1,8})?$/,
      "Quantity must be a valid decimal with at most 8 decimal places.",
    )
    .refine(
      (value) => !/^0+(\.0+)?$/.test(value),
      "Quantity must be greater than zero.",
    ),
);

const createMarketOrderSchema = z.object({
  portfolioId: z.string().uuid("Invalid portfolio ID."),

  symbol: z
    .string()
    .trim()
    .min(1, "Symbol is required.")
    .max(20, "Symbol is too long.")
    .transform((value) => value.toUpperCase()),

  assetType: z.enum(["STOCK", "CRYPTO", "FOREX"]),

  side: z.enum(["BUY", "SELL"]),

  quantity: decimalQuantity,
});

module.exports = {
  createMarketOrderSchema,
};
