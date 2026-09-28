const { z } = require("zod");
const { validatePasswordStrength } = require("../services/authService");

const registerSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, "Name must be at least 2 characters long.")
      .max(100, "Name must not exceed 100 characters."),

    email: z.string().trim().email("Please provide a valid email address."),

    // Do not trim password.
    // Spaces are technically valid symbols in our password policy.
    password: z.string().min(1, "Password is required."),
  })
  .superRefine((data, ctx) => {
    const result = validatePasswordStrength(data.password);

    if (!result.valid) {
      for (const message of result.errors) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["password"],
          message,
        });
      }
    }
  });

module.exports = {
  registerSchema,
};
