const { z } = require("zod");

// Shared decimal-string rule for quantity and price fields.
//
// Storage contract: Prisma Decimal @db.Decimal(18, 8) — 18 significant
// digits with exactly 8 after the decimal point, i.e. at most 10 integer
// digits. Validation must reject anything the column cannot represent so
// the API answers 400 VALIDATION_ERROR instead of leaking a Postgres
// "numeric field overflow" as a 500.
const decimalString = z.preprocess(
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
      "Must be a valid decimal with at most 10 integer digits and at most 8 decimal places.",
    )
    .refine(
      (value) => !/^0+(\.0+)?$/.test(value),
      "Must be greater than zero.",
    ),
);

const assetTypeEnum = z.enum(["STOCK", "CRYPTO", "FOREX"]);
const sideEnum = z.enum(["BUY", "SELL"]);
const orderTypeEnum = z.enum(["MARKET", "LIMIT", "STOP_LOSS", "TAKE_PROFIT"]);
const orderStatusEnum = z.enum([
  "PENDING",
  "EXECUTED",
  "CANCELLED",
  "EXPIRED",
  "REJECTED",
]);

const symbolField = z
  .string()
  .trim()
  .min(1, "Symbol is required.")
  .max(20, "Symbol is too long.")
  .transform((value) => value.toUpperCase());

// Type-conditional pricing contract (docs/API.md):
// - MARKET      -> no limitPrice, no stopPrice
// - LIMIT       -> limitPrice required, stopPrice forbidden
// - STOP_LOSS   -> stopPrice required,  limitPrice forbidden
// - TAKE_PROFIT -> stopPrice required,  limitPrice forbidden
function refineOrderPricing(data, ctx) {
  const { type, limitPrice, stopPrice } = data;

  if (type === "MARKET") {
    if (limitPrice !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["limitPrice"],
        message: "Market orders cannot have a limit price.",
      });
    }

    if (stopPrice !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["stopPrice"],
        message: "Market orders cannot have a stop price.",
      });
    }

    return;
  }

  if (type === "LIMIT") {
    if (limitPrice === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["limitPrice"],
        message: "Limit orders require a limit price.",
      });
    }

    if (stopPrice !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["stopPrice"],
        message: "Limit orders cannot have a stop price.",
      });
    }

    return;
  }

  // STOP_LOSS and TAKE_PROFIT
  if (stopPrice === undefined) {
    ctx.addIssue({
      code: "custom",
      path: ["stopPrice"],
      message: `${type} orders require a stop price.`,
    });
  }

  if (limitPrice !== undefined) {
    ctx.addIssue({
      code: "custom",
      path: ["limitPrice"],
      message: `${type} orders cannot have a limit price.`,
    });
  }
}

// Legacy strict market-order schema, kept for backward compatibility.
const createMarketOrderSchema = z.object({
  portfolioId: z.string().uuid("Invalid portfolio ID."),
  symbol: symbolField,
  assetType: assetTypeEnum,
  side: sideEnum,
  quantity: decimalString,
});

// Full order-creation schema: type defaults to MARKET so existing clients
// that omit it keep working.
const createOrderSchema = z
  .object({
    portfolioId: z.string().uuid("Invalid portfolio ID."),
    symbol: symbolField,
    assetType: assetTypeEnum,
    side: sideEnum,
    type: orderTypeEnum.default("MARKET"),
    quantity: decimalString,
    limitPrice: decimalString.optional(),
    stopPrice: decimalString.optional(),
  })
  .superRefine(refineOrderPricing);

// status accepts a single value or a comma-separated list; segments are
// trimmed, uppercased, validated against the enum, and deduplicated.
const statusFilter = z
  .preprocess((value) => {
    if (typeof value === "string") {
      return value.split(",");
    }

    if (Array.isArray(value)) {
      return value.flatMap((item) => String(item).split(","));
    }

    return value;
  },
  z
    .array(
      z
        .string()
        .trim()
        .transform((value) => value.toUpperCase())
        .pipe(orderStatusEnum),
    )
    .transform((statuses) => [...new Set(statuses)]))
  .optional();

const orderIdParamSchema = z.object({
  id: z.string().uuid("Invalid order ID."),
});

// ============================================================
// Date-range contract (UTC, half-open window)
//
// `from` is inclusive, `to` is exclusive: the window is [from, to).
//
// Accepted bound formats:
// - "YYYY-MM-DD"                -> date-only; denotes midnight UTC of
//                                  that date. A date-only `to` therefore
//                                  normalizes to midnight of the
//                                  FOLLOWING day so the entire selected
//                                  day is covered. This keeps
//                                  comparisons independent of timestamp
//                                  precision — no "last instant of the
//                                  day" arithmetic.
// - ISO datetime WITH an explicit UTC offset ("...Z", "...±HH:MM",
//   "...±HHMM")                 -> used as the exact instant.
// - ISO datetime WITHOUT offset -> rejected. JavaScript would interpret
//                                  it as the server's local time, making
//                                  results depend on deployment
//                                  timezone; every instant must name its
//                                  offset explicitly.
// ============================================================

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const UTC_OFFSET_PATTERN = /(?:Z|[+-]\d{2}:?\d{2})$/i;

// Parses a date-only string as midnight UTC, shifted by `dayOffset` days.
// Returns an Invalid Date for impossible calendar dates (2026-02-30,
// 2026-13-45) so the schema reports a validation issue instead of
// silently normalizing them.
function parseDateOnlyUtc(value, dayOffset) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + dayOffset));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day + dayOffset
  ) {
    return new Date(NaN);
  }

  return date;
}

function dateBoundSchema(dayOffset) {
  return z
    .string()
    .transform((value) => value.trim())
    .refine(
      (value) => DATE_ONLY_PATTERN.test(value) || UTC_OFFSET_PATTERN.test(value),
      "Must be a date (YYYY-MM-DD) or an ISO datetime with an explicit UTC offset (Z or ±HH:MM).",
    )
    .transform((value) =>
      DATE_ONLY_PATTERN.test(value)
        ? parseDateOnlyUtc(value, dayOffset)
        : value,
    )
    .pipe(z.coerce.date());
}

const listOrdersQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    status: statusFilter,
    symbol: symbolField.optional(),
    side: sideEnum.optional(),
    type: orderTypeEnum.optional(),
    portfolioId: z.string().uuid("Invalid portfolio ID.").optional(),
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
  createMarketOrderSchema,
  createOrderSchema,
  listOrdersQuerySchema,
  orderIdParamSchema,
};
