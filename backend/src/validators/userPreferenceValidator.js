const { z } = require("zod");

// Both notification switches are optional so a caller can PATCH either field on
// its own. `.strict()` rejects unknown keys instead of silently dropping them,
// which keeps the preference surface locked to only the editable fields.
const updatePreferencesSchema = z
  .object({
    emailNotifications: z.boolean().optional(),

    pushNotifications: z.boolean().optional(),
  })
  .strict()
  .refine((data) => Object.values(data).some((value) => value !== undefined), {
    message: "At least one preference field must be provided.",
  });

module.exports = {
  updatePreferencesSchema,
};
