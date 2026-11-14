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

module.exports = {
  portfolioIdParamsSchema,
  updatePortfolioSchema,
  pnlHeatmapQuerySchema,
  benchmarkQuerySchema,
  riskMetricsQuerySchema,
  benchmarkComparisonQuerySchema,
};
