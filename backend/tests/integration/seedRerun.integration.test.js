// Rerun-safety contract for the development seeder (prisma/seed.js).
//
// Review contract: a seed-fixture identity must not depend on mutable
// order state. These tests change a seeded order's status, rerun the
// seeder against the same fixtures, and verify that no duplicate is
// created and user/engine changes are preserved.
//
// Runs hermetically: builds its own labeled portfolio slots (which feed
// the UUIDv5 fixture names), never touches the demo traders' rows.

jest.setTimeout(30000);

const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const seed = require("../../prisma/seed");

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const RUN_LABEL = `seedtest-${Date.now()}`;
const SLOT_LABELS = ["slotA", "slotB", "slotC"].map(
  (slot) => `${RUN_LABEL}-${slot}`,
);

let createdUserIds = [];

async function createPortfolioSlot(label, index) {
  const user = await prisma.user.create({
    data: {
      email: `${label}@seed-fixture.test`,
      name: `Seed Fixture ${index}`,
      passwordHash: "seed-fixture-not-a-real-password",
    },
  });
  createdUserIds.push(user.id);

  const portfolio = await prisma.portfolio.create({
    data: {
      userId: user.id,
      name: `Seed Fixture Portfolio ${index}`,
      startingBalance: "10000",
      cashBalance: "10000",
    },
  });

  return { label, id: portfolio.id };
}

beforeAll(async () => {
  await seed.seedSymbols();
});

afterAll(async () => {
  for (const userId of createdUserIds) {
    await prisma.user
      .delete({ where: { id: userId } })
      .catch(() => {});
  }

  await prisma.$disconnect();
  await seed.disconnect();
});

describe("seed rerun safety", () => {
  test("rerun after a seeded order changed status creates no duplicates and preserves changes", async () => {
    const slots = [];
    for (const [index, label] of SLOT_LABELS.entries()) {
      slots.push(await createPortfolioSlot(label, index));
    }

    const portfolioIds = slots.map((slot) => slot.id);

    // First run creates every fixture.
    const firstRun = await seed.seedOrders(slots);
    expect(firstRun.created).toBe(firstRun.orders.length);

    const countAfterFirstRun = await prisma.order.count({
      where: { portfolioId: { in: portfolioIds } },
    });
    expect(countAfterFirstRun).toBe(firstRun.orders.length);

    // Simulate normal usage: cancel one seeded pending order and execute
    // another (state drift the old status-based matcher could not survive).
    const pendingFixture = firstRun.orders.find(
      (order) => order.status === "PENDING",
    );
    const executedFixture = firstRun.orders.find(
      (order) => order.status === "EXECUTED",
    );

    await prisma.order.update({
      where: { id: pendingFixture.id },
      data: { status: "CANCELLED" },
    });
    await prisma.order.update({
      where: { id: executedFixture.id },
      data: { status: "REJECTED" },
    });

    // Rerun: identity is the fixture key, not the status, so every
    // fixture is found by primary key and nothing new is created.
    const secondRun = await seed.seedOrders(slots);

    expect(secondRun.created).toBe(0);
    expect(secondRun.orders).toHaveLength(firstRun.orders.length);

    const countAfterRerun = await prisma.order.count({
      where: { portfolioId: { in: portfolioIds } },
    });
    expect(countAfterRerun).toBe(countAfterFirstRun);

    // User-facing changes survive the rerun untouched.
    const pendingAfter = secondRun.orders.find(
      (order) => order.id === pendingFixture.id,
    );
    expect(pendingAfter.status).toBe("CANCELLED");

    // Fixture ids are deterministic across runs (same key -> same id).
    expect(secondRun.orders.map((order) => order.id).sort()).toEqual(
      firstRun.orders.map((order) => order.id).sort(),
    );
  });

  test("fixture ids are stable and disjoint from random uuids", () => {
    const idA = seed.fixtureId("trader1", "pending-tsla-buy-limit");
    const idB = seed.fixtureId("trader1", "pending-tsla-buy-limit");
    const idC = seed.fixtureId("trader1", "pending-aapl-sell-stop-loss");

    expect(idA).toBe(idB); // deterministic
    expect(idA).not.toBe(idC); // keyed per fixture
    expect(idA).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    ); // UUIDv5 shape (version nibble 5)
  });
});
