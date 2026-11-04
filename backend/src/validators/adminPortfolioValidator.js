const { z } = require("zod");

const booleanQuery = z.preprocess((value) => {
  if (value === "true") return true;
  if (value === "false") return false;
  return value;
}, z.boolean());

const adminPortfolioListQuerySchema = z.object({
  page: z.coerce.number().int().safe().min(1).max(100_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().min(1).max(100).optional(),
  userId: z.string().uuid().optional(),
  isActive: booleanQuery.optional(),
});

const adminPortfolioParamsSchema = z.object({
  portfolioId: z.string().uuid("Invalid portfolio ID."),
});

module.exports = {
  adminPortfolioListQuerySchema,
  adminPortfolioParamsSchema,
};
