const { z } = require("zod");

const publicUserParamsSchema = z.object({
  id: z.string().uuid("Invalid user ID."),
});

module.exports = {
  publicUserParamsSchema,
};
