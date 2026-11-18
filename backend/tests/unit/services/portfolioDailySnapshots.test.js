const { Prisma } = require("@prisma/client");
const { getPortfolioDailySnapshots } = require("../../../src/services/portfolioSnapshotService");

describe("Daily Portfolio Snapshots Service", () => {
  const userId = "user-123";
  const portfolioId = "portfolio-456";

  let mockClient;

  beforeEach(() => {
    mockClient = {
      portfolio: {
        findFirst: jest.fn(),
      },
      performanceSnapshot: {
        findMany: jest.fn(),
      },
    };
  });

  test("throws 404 when portfolio does not belong to user", async () => {
    mockClient.portfolio.findFirst.mockResolvedValue(null);

    await expect(
      getPortfolioDailySnapshots(userId, portfolioId, { client: mockClient }),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: "PORTFOLIO_NOT_FOUND",
    });
  });

  test("returns chronological snapshots with exact decimal strings and counts", async () => {
    mockClient.portfolio.findFirst.mockResolvedValue({
      id: portfolioId,
      name: "Growth Portfolio",
      currency: "USD",
      isActive: true,
    });

    const mockSnapshots = [
      {
        id: "snap-1",
        portfolioId,
        snapshotDate: new Date("2026-11-01T00:00:00.000Z"),
        totalValue: new Prisma.Decimal("10000.00000000"),
        cashBalance: new Prisma.Decimal("5000.00000000"),
        holdingsValue: new Prisma.Decimal("5000.00000000"),
        dailyPnl: new Prisma.Decimal("0.00000000"),
        dailyPnlPct: new Prisma.Decimal("0.0000"),
        createdAt: new Date("2026-11-01T23:59:59.000Z"),
      },
      {
        id: "snap-2",
        portfolioId,
        snapshotDate: new Date("2026-11-02T00:00:00.000Z"),
        totalValue: new Prisma.Decimal("10250.00000000"),
        cashBalance: new Prisma.Decimal("5000.00000000"),
        holdingsValue: new Prisma.Decimal("5250.00000000"),
        dailyPnl: new Prisma.Decimal("250.00000000"),
        dailyPnlPct: new Prisma.Decimal("0.0250"),
        createdAt: new Date("2026-11-02T23:59:59.000Z"),
      },
    ];

    mockClient.performanceSnapshot.findMany.mockResolvedValue(mockSnapshots);

    const result = await getPortfolioDailySnapshots(userId, portfolioId, {
      from: "2026-11-01",
      to: "2026-11-05",
      limit: 50,
      client: mockClient,
    });

    expect(result.portfolioId).toBe(portfolioId);
    expect(result.count).toBe(2);
    expect(result.from).toBe("2026-11-01");
    expect(result.to).toBe("2026-11-05");
    expect(result.snapshots).toHaveLength(2);
    expect(result.snapshots[0].totalValue).toBe("10000");
    expect(result.snapshots[1].dailyPnl).toBe("250");
    expect(result.snapshots[1].dailyPnlPct).toBe("0.025");
    expect(mockClient.performanceSnapshot.findMany).toHaveBeenCalledWith({
      where: {
        portfolioId,
        snapshotDate: {
          gte: expect.any(Date),
          lte: expect.any(Date),
        },
      },
      orderBy: { snapshotDate: "asc" },
      take: 50,
    });
  });

  test("does not invent values for missing dates and returns actual recorded rows", async () => {
    mockClient.portfolio.findFirst.mockResolvedValue({
      id: portfolioId,
      name: "Growth Portfolio",
      currency: "USD",
      isActive: true,
    });

    mockClient.performanceSnapshot.findMany.mockResolvedValue([]);

    const result = await getPortfolioDailySnapshots(userId, portfolioId, {
      client: mockClient,
    });

    expect(result.count).toBe(0);
    expect(result.snapshots).toEqual([]);
  });
});
