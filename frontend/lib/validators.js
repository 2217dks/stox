import { z } from "zod";

const decimalString = (label, { decimals = 8, positive = true } = {}) =>
  z
    .string()
    .trim()
    .min(1, `${label} is required.`)
    .regex(
      new RegExp(`^\\d{1,10}(\\.\\d{1,${decimals}})?$`),
      `${label} must be a positive number with at most ${decimals} decimal places.`,
    )
    .refine((value) => !positive || Number(value) > 0, `${label} must be greater than zero.`);

export const loginSchema = z.object({
  email: z.string().trim().email("Enter a valid email address."),
  password: z.string().min(1, "Password is required."),
});

export const registerSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, "Name must be at least 2 characters.")
      .max(100, "Name must not exceed 100 characters."),
    email: z
      .string()
      .trim()
      .email("Enter a valid email address.")
      .max(254, "Email is too long."),
    password: z
      .string()
      .min(6, "Password must be at least 6 characters."),
    confirmPassword: z.string().min(1, "Confirm your password."),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"],
  })
  .superRefine((data, ctx) => {
    const password = data.password;
    if (!/[a-z]/.test(password)) {
      ctx.addIssue({
        code: "custom",
        path: ["password"],
        message: "Add at least one lowercase letter.",
      });
    }
    if (!/[A-Z]/.test(password)) {
      ctx.addIssue({
        code: "custom",
        path: ["password"],
        message: "Add at least one uppercase letter.",
      });
    }
    if (!/[0-9]/.test(password)) {
      ctx.addIssue({
        code: "custom",
        path: ["password"],
        message: "Add at least one number.",
      });
    }
    if (!/[^A-Za-z0-9\s]/.test(password)) {
      ctx.addIssue({
        code: "custom",
        path: ["password"],
        message: "Add at least one symbol.",
      });
    }
  });

export const profileSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Name must be at least 2 characters.")
    .max(100, "Name must not exceed 100 characters."),
  avatarUrl: z
    .union([z.string().trim().url("Enter a valid image URL.").max(500), z.literal("")])
    .optional(),
});

export const portfolioSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Portfolio name is required.")
    .max(100, "Name must not exceed 100 characters."),
  description: z
    .string()
    .trim()
    .max(500, "Description must not exceed 500 characters.")
    .optional(),
});

export const orderSchema = z
  .object({
    portfolioId: z.string().uuid("Choose a portfolio."),
    symbol: z
      .string()
      .trim()
      .min(1, "Symbol is required.")
      .max(20, "Symbol is too long.")
      .transform((value) => value.toUpperCase()),
    assetType: z.enum(["STOCK", "CRYPTO", "FOREX"]),
    side: z.enum(["BUY", "SELL"]),
    type: z.enum(["MARKET", "LIMIT", "STOP_LOSS", "TAKE_PROFIT"]),
    quantity: decimalString("Quantity"),
    limitPrice: z.string().optional(),
    stopPrice: z.string().optional(),
    expiresAt: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.type === "LIMIT") {
      const parsed = decimalString("Limit price").safeParse(data.limitPrice);
      if (!parsed.success) {
        ctx.addIssue({
          code: "custom",
          path: ["limitPrice"],
          message: parsed.error.issues[0].message,
        });
      }
    }

    if (data.type === "STOP_LOSS" || data.type === "TAKE_PROFIT") {
      const parsed = decimalString("Stop price").safeParse(data.stopPrice);
      if (!parsed.success) {
        ctx.addIssue({
          code: "custom",
          path: ["stopPrice"],
          message: parsed.error.issues[0].message,
        });
      }
    }

    if (data.expiresAt) {
      const timestamp = Date.parse(data.expiresAt);
      if (Number.isNaN(timestamp)) {
        ctx.addIssue({
          code: "custom",
          path: ["expiresAt"],
          message: "Enter a valid date and time.",
        });
      } else if (timestamp <= Date.now()) {
        ctx.addIssue({
          code: "custom",
          path: ["expiresAt"],
          message: "Expiry must be in the future.",
        });
      }
    }
  });

export const alertSchema = z.object({
  symbol: z
    .string()
    .trim()
    .min(1, "Symbol is required.")
    .max(20, "Symbol is too long.")
    .transform((value) => value.toUpperCase()),
  assetType: z.enum(["STOCK", "CRYPTO", "FOREX"]).optional(),
  condition: z.enum([
    "PRICE_ABOVE",
    "PRICE_BELOW",
    "PERCENT_CHANGE_UP",
    "PERCENT_CHANGE_DOWN",
  ]),
  targetPrice: decimalString("Target price"),
  sendEmail: z.boolean().optional(),
  sendPush: z.boolean().optional(),
});

export const copyTradeSchema = z.object({
  traderId: z.string().uuid("Choose a trader."),
  allocationPct: z
    .string()
    .trim()
    .regex(/^\d{1,3}(\.\d{1,2})?$/, "Use up to 2 decimal places.")
    .refine(
      (value) => Number(value) > 0 && Number(value) <= 100,
      "Allocation must be between 0 and 100.",
    ),
  maxTradeSize: z
    .string()
    .trim()
    .regex(/^\d{1,10}(\.\d{1,8})?$/, "Enter a valid amount.")
    .optional()
    .or(z.literal("")),
  copyPortfolioId: z.string().uuid().optional().or(z.literal("")),
  isActive: z.boolean().optional(),
});

export const postSchema = z.object({
  content: z
    .string()
    .trim()
    .min(1, "Write something first.")
    .max(2000, "Posts are limited to 2,000 characters."),
  symbol: z
    .string()
    .trim()
    .max(20, "Symbol is too long.")
    .optional()
    .transform((value) => (value ? value.toUpperCase() : undefined)),
});

export const leagueSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(3, "Name must be at least 3 characters.")
      .max(100, "Name must not exceed 100 characters."),
    description: z
      .string()
      .trim()
      .max(500, "Description must not exceed 500 characters.")
      .optional(),
    startingBalance: z
      .string()
      .trim()
      .regex(/^\d+(\.\d{1,8})?$/, "Enter a valid starting balance."),
    startDate: z.string().min(1, "Choose a start date."),
    endDate: z.string().min(1, "Choose an end date."),
    maxParticipants: z
      .string()
      .trim()
      .regex(/^\d+$/, "Enter a whole number.")
      .optional()
      .or(z.literal("")),
  })
  .refine(
    (data) => new Date(data.endDate) > new Date(data.startDate),
    { message: "End date must be after the start date.", path: ["endDate"] },
  );

export const preferencesSchema = z.object({
  emailNotifications: z.boolean(),
  pushNotifications: z.boolean(),
});
