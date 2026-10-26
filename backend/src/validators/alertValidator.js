const { z } = require("zod");

const decimalPrice = z.preprocess(
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
      "Target price must be a valid decimal with at most 8 decimal places.",
    )
    .refine(
      (value) => !/^0+(\.0+)?$/.test(value),
      "Target price must be greater than zero.",
    ),
);

const alertConditionEnum = z.enum([
  "PRICE_ABOVE",
  "PRICE_BELOW",
  "PERCENT_CHANGE_UP",
  "PERCENT_CHANGE_DOWN",
]);

const alertStatusEnum = z.enum([
  "ACTIVE",
  "TRIGGERED",
  "EXPIRED",
  "CANCELLED",
]);

const createAlertSchema = z.object({
  symbol: z
    .string()
    .trim()
    .min(1, "Symbol is required.")
    .max(20, "Symbol is too long.")
    .transform((value) => value.toUpperCase()),

  assetType: z.enum(["STOCK", "CRYPTO", "FOREX"]).optional(),

  condition: alertConditionEnum,

  targetPrice: decimalPrice,

  sendEmail: z.boolean().optional().default(true),

  sendPush: z.boolean().optional().default(false),
});

const updateAlertSchema = z
  .object({
    condition: alertConditionEnum.optional(),

    targetPrice: decimalPrice.optional(),

    status: alertStatusEnum.optional(),

    sendEmail: z.boolean().optional(),

    sendPush: z.boolean().optional(),
  })
  .refine((data) => Object.values(data).some((value) => value !== undefined), {
    message: "At least one alert field must be provided.",
  });

const alertParamsSchema = z.object({
  alertId: z.string().uuid("Invalid alert ID."),
});

const listAlertsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),

  limit: z.coerce.number().int().min(1).max(100).default(20),

  status: alertStatusEnum.optional(),

  symbol: z
    .string()
    .trim()
    .min(1, "Symbol must not be empty.")
    .max(20, "Symbol is too long.")
    .transform((value) => value.toUpperCase())
    .optional(),
});

module.exports = {
  createAlertSchema,
  updateAlertSchema,
  alertParamsSchema,
  listAlertsQuerySchema,
};
