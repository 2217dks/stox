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

const notificationParamsSchema = z.object({
  notificationId: z.string().uuid("Invalid notification ID."),
});

const listNotificationsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),

  limit: z.coerce.number().int().min(1).max(100).default(20),

  isRead: booleanQuery.optional(),
});

module.exports = {
  notificationParamsSchema,
  listNotificationsQuerySchema,
};
