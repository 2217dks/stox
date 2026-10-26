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

module.exports = {
  portfolioIdParamsSchema,
  updatePortfolioSchema,
};
