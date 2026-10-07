const { z } = require("zod");

const booleanQuery = z.preprocess((value) => {
  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  return value;
}, z.boolean());

const adminUserListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),

  limit: z.coerce.number().int().min(1).max(100).default(20),

  search: z.string().trim().min(1, "Search must not be empty.").optional(),

  role: z.enum(["TRADER", "MODERATOR", "ADMIN"]).optional(),

  isSuspended: booleanQuery.optional(),

  isVerified: booleanQuery.optional(),
});

module.exports = {
  adminUserListQuerySchema,
};
