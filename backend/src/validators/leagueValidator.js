const { z } = require("zod");

const createLeagueSchema = z
  .object({
    name: z.string().trim().min(3, "Name must be at least 3 characters").max(100),
    description: z.string().trim().max(500).optional(),
    // A league balance funds a real, persistent portfolio. Without a ceiling a
    // single user could mint an arbitrary balance and outrank every honest
    // portfolio. 1,000,000 keeps custom league formats possible.
    startingBalance: z
      .number()
      .positive()
      .max(1_000_000, "startingBalance must not exceed 1000000.")
      .default(10000),
    startDate: z.string().datetime({ message: "Invalid start date format." }),
    endDate: z.string().datetime({ message: "Invalid end date format." }),
    maxParticipants: z.number().int().positive().optional(),
  })
  .refine(
    (data) => new Date(data.endDate) > new Date(data.startDate),
    { message: "endDate must be after startDate.", path: ["endDate"] },
  );

const listLeaguesQuerySchema = z.object({
  status: z.enum(["UPCOMING", "ACTIVE", "COMPLETED", "CANCELLED"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const joinLeagueSchema = z.object({
  portfolioId: z.string().uuid().optional(),
});

module.exports = {
  createLeagueSchema,
  listLeaguesQuerySchema,
  joinLeagueSchema,
};

