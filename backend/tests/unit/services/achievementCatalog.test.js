jest.mock("../../../src/config/database", () => ({
  achievement: { upsert: jest.fn() },
}));

const prisma = require("../../../src/config/database");
const {
  CATALOG,
  ensureCatalog,
} = require("../../../src/services/achievementService");

describe("achievement catalog seeding", () => {
  test("upserts the catalog once per process", async () => {
    prisma.achievement.upsert.mockResolvedValue({});

    await ensureCatalog();
    await ensureCatalog();

    expect(prisma.achievement.upsert).toHaveBeenCalledTimes(CATALOG.length);
  });
});
