const { z } = require("zod");

const tradeIdParamSchema = z.object({
  id: z.string().uuid("Invalid trade ID."),
});

module.exports = {
  tradeIdParamSchema,
};
