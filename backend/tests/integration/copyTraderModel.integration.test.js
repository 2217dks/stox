const prisma = require("../../src/config/database");

const timestamp = Date.now();
let copierId;
let traderId;

beforeAll(async () => {
  const [copier, trader] = await Promise.all([
    prisma.user.create({
      data: {
        email: `copy-model-copier-${timestamp}@example.com`,
        name: "Copy Model Copier",
      },
      select: { id: true },
    }),
    prisma.user.create({
      data: {
        email: `copy-model-trader-${timestamp}@example.com`,
        name: "Copy Model Trader",
      },
      select: { id: true },
    }),
  ]);

  copierId = copier.id;
  traderId = trader.id;
});

afterAll(async () => {
  await prisma.user.deleteMany({
    where: {
      id: { in: [copierId, traderId].filter(Boolean) },
    },
  });

  await prisma.$disconnect();
});

describe("CopyTrader database constraints", () => {
  test("accepts valid allocation and an optional positive trade-size limit", async () => {
    const copyTrader = await prisma.copyTrader.create({
      data: {
        copierId,
        copiedId: traderId,
        allocationPct: "25.50",
        maxTradeSize: "1000.25",
      },
    });

    expect(copyTrader.allocationPct.toString()).toBe("25.5");
    expect(copyTrader.maxTradeSize.toString()).toBe("1000.25");

    await prisma.copyTrader.delete({ where: { id: copyTrader.id } });
  });

  test.each(["0", "100.01"])(
    "rejects allocationPct %s outside the (0, 100] range",
    async (allocationPct) => {
      await expect(
        prisma.copyTrader.create({
          data: {
            copierId,
            copiedId: traderId,
            allocationPct,
          },
        }),
      ).rejects.toThrow();
    },
  );

  test("rejects a user copying themselves", async () => {
    await expect(
      prisma.copyTrader.create({
        data: {
          copierId,
          copiedId: copierId,
        },
      }),
    ).rejects.toThrow();
  });

  test.each(["0", "-1"])(
    "rejects maxTradeSize %s when a limit is provided",
    async (maxTradeSize) => {
      await expect(
        prisma.copyTrader.create({
          data: {
            copierId,
            copiedId: traderId,
            maxTradeSize,
          },
        }),
      ).rejects.toThrow();
    },
  );

  test("accepts a null maxTradeSize", async () => {
    const copyTrader = await prisma.copyTrader.create({
      data: {
        copierId,
        copiedId: traderId,
        allocationPct: "100",
        maxTradeSize: null,
      },
    });

    expect(copyTrader.maxTradeSize).toBeNull();
  });
});
