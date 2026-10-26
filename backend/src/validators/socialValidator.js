const { z } = require("zod");

const followParamsSchema = z.object({
  userId: z.string().uuid("Invalid user ID."),
});

const feedQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),

  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const createPostSchema = z.object({
  content: z
    .string()
    .trim()
    .min(1, "Post content is required.")
    .max(2000, "Post content is too long."),

  symbol: z
    .string()
    .trim()
    .min(1, "Symbol must not be empty.")
    .max(20, "Symbol is too long.")
    .transform((value) => value.toUpperCase())
    .optional(),

  metadata: z.record(z.string(), z.unknown()).optional(),
});

module.exports = {
  followParamsSchema,
  feedQuerySchema,
  createPostSchema,
};
