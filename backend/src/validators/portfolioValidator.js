const { z } = require("zod");

// Path parameter used by GET / PATCH / DELETE /portfolios/:portfolioId.
const portfolioIdParamsSchema = z.object({
  portfolioId: z.string().uuid("Invalid portfolio ID."),
});

// PATCH /portfolios/:portfolioId
//
// Only user-editable fields are accepted. Unknown keys (userId, startingBalance,
// cashBalance, isDefault, isActive, ...) are stripped by Zod, so they can never
// reach the service. `isActive` is controlled exclusively by the DELETE endpoint.
const updatePortfolioSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Portfolio name is required.")
      .max(100, "Portfolio name must not exceed 100 characters.")
      .optional(),

    description: z
      .union([
        z.string().trim().max(500, "Description must not exceed 500 characters."),
        z.null(),
      ])
      .optional(),
  })
  .refine(
    (data) => data.name !== undefined || data.description !== undefined,
    {
      message: "At least one field (name or description) must be provided.",
    },
  );

const periodSchema = z
  .string()
  .trim()
  .toUpperCase()
  .pipe(z.enum(["1W", "1M", "3M", "6M", "1Y", "YTD", "ALL"]))
  .default("1M");

const benchmarkSymbolSchema = z
  .string()
  .trim()
  .toUpperCase()
  .min(1)
  .max(30)
  .regex(/^[A-Z0-9][A-Z0-9._:/-]*$/, "A valid market symbol is required.")
  .default("SPY");

const riskFreeRateSchema = z.preprocess((val) => {
  if (val === undefined || val === null || val === "") return 0.02;
  const num = Number(val);
  return Number.isFinite(num) ? num : val;
}, z.number().min(0, "Risk-free rate must be non-negative.").max(1, "Risk-free rate must not exceed 1.0 (100%).").default(0.02));

const { dateBoundSchema } = require("./orderValidator");

const YEAR_MONTH_PATTERN = /^\d{4}-\d{2}$/;
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const UTC_OFFSET_PATTERN = /(?:Z|[+-]\d{2}:?\d{2})$/i;

function parseYearMonthUtc(value, isUpper) {
  const [year, month] = value.split("-").map(Number);
  if (month < 1 || month > 12) {
    return new Date(NaN);
  }
  if (!isUpper) {
    return new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
  }
  return new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
}

function parseDateOnlyUtc(value, isUpper) {
  const [year, month, day] = value.split("-").map(Number);
  const original = new Date(Date.UTC(year, month - 1, day));
  if (
    original.getUTCFullYear() !== year ||
    original.getUTCMonth() !== month - 1 ||
    original.getUTCDate() !== day
  ) {
    return new Date(NaN);
  }
  if (isUpper) {
    return new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999));
  }
  return new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
}

function monthlyDateBoundSchema(isUpper = false) {
  return z
    .string()
    .transform((value) => value.trim())
    .refine(
      (value) =>
        YEAR_MONTH_PATTERN.test(value) ||
        DATE_ONLY_PATTERN.test(value) ||
        UTC_OFFSET_PATTERN.test(value),
      "Must be a month (YYYY-MM), a date (YYYY-MM-DD), or an ISO datetime with an explicit UTC offset (Z or ±HH:MM).",
    )
    .transform((value) => {
      if (YEAR_MONTH_PATTERN.test(value)) {
        return parseYearMonthUtc(value, isUpper);
      }
      if (DATE_ONLY_PATTERN.test(value)) {
        return parseDateOnlyUtc(value, isUpper);
      }
      return value;
    })
    .pipe(z.coerce.date());
}

const yearSchema = z.preprocess((val) => {
  if (val === undefined || val === null || val === "") return undefined;
  const num = parseInt(val, 10);
  return Number.isInteger(num) ? num : val;
}, z.number().int().min(1970).max(2100).optional());

const pnlHeatmapQuerySchema = z.object({
  period: periodSchema,
  year: yearSchema,
});

const benchmarkQuerySchema = z.object({
  symbol: benchmarkSymbolSchema,
  period: periodSchema,
});

const riskMetricsQuerySchema = z.object({
  period: periodSchema,
  riskFreeRate: riskFreeRateSchema,
});

const benchmarkComparisonQuerySchema = z.object({
  symbol: benchmarkSymbolSchema,
  period: periodSchema,
  riskFreeRate: riskFreeRateSchema,
});

const monthlyPerformanceQuerySchema = z
  .object({
    year: yearSchema,
    from: monthlyDateBoundSchema(false).optional(),
    to: monthlyDateBoundSchema(true).optional(),
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
  portfolioIdParamsSchema,
  updatePortfolioSchema,
  pnlHeatmapQuerySchema,
  benchmarkQuerySchema,
  riskMetricsQuerySchema,
  benchmarkComparisonQuerySchema,
  monthlyPerformanceQuerySchema,
  monthlyDateBoundSchema,
};
