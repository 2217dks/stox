const { Prisma } = require("@prisma/client");
const {
  capturePortfolioSnapshot,
  captureAllPortfolioSnapshots,
} = require("../../../src/services/portfolioSnapshotService");

describe("portfolioSnapshotService unit tests", () => {
  const portfolioId = "11111111-1111-4111-8111-111111111111";

  test("captures initial snapshot comparing against startingBalance", async () => {
    const mockClient = {
      portfolio: {
        findUnique: jest.fn().mockImplementation(({ where }) => {
          if (where.id === portfolioId) {
            return Promise.resolve({
              id: portfolioId,
              cashBalance: new Prisma.Decimal("10500"),
              startingBalance: new Prisma.Decimal("10000"),
              isActive: true,
            });
          }
          return Promise.resolve(null);
        }),
      },
      holding: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      performanceSnapshot: {
        findFirst: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockImplementation(({ create }) =>
          Promise.resolve({
            id: "snap-1",
            createdAt: new Date(),
            ...create,
          }),
        ),
      },
    };

    const asOf = new Date("2026-11-10T12:00:00.000Z");
    const result = await capturePortfolioSnapshot(portfolioId, {
      asOf,
      client: mockClient,
    });

    expect(result.portfolioId).toBe(portfolioId);
    expect(result.snapshotDate).toBe("2026-11-10");
    expect(result.totalValue).toBe("10500");
    expect(result.dailyPnl).toBe("500"); // 10500 - 10000
    expect(result.dailyPnlPct).toBe("0.05"); // 500 / 10000
  });

  test("captures subsequent snapshot comparing against previous snapshot totalValue", async () => {
    const mockClient = {
      portfolio: {
        findUnique: jest.fn().mockResolvedValue({
          id: portfolioId,
          cashBalance: new Prisma.Decimal("11000"),
          startingBalance: new Prisma.Decimal("10000"),
          isActive: true,
        }),
      },
      holding: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      performanceSnapshot: {
        findFirst: jest.fn().mockResolvedValue({
          id: "snap-1",
          totalValue: new Prisma.Decimal("10500"),
          snapshotDate: new Date("2026-11-10T00:00:00.000Z"),
        }),
        upsert: jest.fn().mockImplementation(({ create }) =>
          Promise.resolve({
            id: "snap-2",
            createdAt: new Date(),
            ...create,
          }),
        ),
      },
    };

    const asOf = new Date("2026-11-11T12:00:00.000Z");
    const result = await capturePortfolioSnapshot(portfolioId, {
      asOf,
      client: mockClient,
    });

    expect(result.snapshotDate).toBe("2026-11-11");
    expect(result.totalValue).toBe("11000");
    expect(result.dailyPnl).toBe("500"); // 11000 - 10500
    // 500 / 10500 = 0.047619...
    expect(new Prisma.Decimal(result.dailyPnlPct).toDecimalPlaces(4).toString()).toBe("0.0476");
  });

  test("captureAllPortfolioSnapshots iterates over active portfolios and handles errors gracefully", async () => {
    const mockClient = {
      portfolio: {
        findMany: jest.fn().mockResolvedValue([
          { id: "port-1" },
          { id: "port-2" },
        ]),
        findUnique: jest.fn().mockImplementation(({ where }) => {
          if (where.id === "port-1") {
            return Promise.resolve({
              id: "port-1",
              cashBalance: new Prisma.Decimal("10000"),
              startingBalance: new Prisma.Decimal("10000"),
              isActive: true,
            });
          }
          // port-2 will simulate an error during lookup
          throw new Error("Simulated quote failure");
        }),
      },
      holding: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      performanceSnapshot: {
        findFirst: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockImplementation(({ create }) =>
          Promise.resolve({
            id: "snap-1",
            ...create,
          }),
        ),
      },
    };

    const asOf = new Date("2026-11-12T12:00:00.000Z");
    const result = await captureAllPortfolioSnapshots({
      asOf,
      client: mockClient,
    });

    expect(result.snapshotDate).toBe("2026-11-12");
    expect(result.totalPortfolios).toBe(2);
    expect(result.successful).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].portfolioId).toBe("port-2");
  });

  test("captureAllPortfolioSnapshots with targetDate computes EOD asOf timestamp", async () => {
    const mockClient = {
      portfolio: {
        findMany: jest.fn().mockResolvedValue([{ id: "port-1" }]),
        findUnique: jest.fn().mockResolvedValue({
          id: "port-1",
          cashBalance: new Prisma.Decimal("10000"),
          startingBalance: new Prisma.Decimal("10000"),
          isActive: true,
        }),
      },
      holding: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      performanceSnapshot: {
        findFirst: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockImplementation(({ create }) =>
          Promise.resolve({
            id: "snap-1",
            ...create,
          }),
        ),
      },
    };

    const result = await captureAllPortfolioSnapshots({
      targetDate: "2026-11-14",
      client: mockClient,
    });

    expect(result.snapshotDate).toBe("2026-11-14");
    expect(result.asOf).toBe("2026-11-14T23:59:59.999Z");
    expect(result.successful).toBe(1);
    expect(mockClient.performanceSnapshot.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          snapshotDate: new Date("2026-11-14T00:00:00.000Z"),
        }),
      }),
    );
  });
});

