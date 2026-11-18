const { Prisma } = require("@prisma/client");
const { getPortfolioHistoricalState } = require("../../../src/services/portfolioHistoryService");

describe("Portfolio Historical State Service (Task 37.3)", () => {
  const userId = "usr-hist-1";
  const portfolioId = "port-hist-1";

  let mockClient;

  beforeEach(() => {
    mockClient = {
      portfolio: {
        findFirst: jest.fn(),
      },
      performanceSnapshot: {
        findMany: jest.fn(),
      },
      trade: {
        findMany: jest.fn(),
      },
    };
  });

  test("throws 404 when portfolio is not owned by user", async () => {
    mockClient.portfolio.findFirst.mockResolvedValue(null);

    await expect(
      getPortfolioHistoricalState(userId, portfolioId, { client: mockClient }),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: "PORTFOLIO_NOT_FOUND",
    });
  });

  test("throws 400 when from date is after to date", async () => {
    mockClient.portfolio.findFirst.mockResolvedValue({
      id: portfolioId,
      name: "My Portfolio",
    });

    await expect(
      getPortfolioHistoricalState(userId, portfolioId, {
        from: "2026-11-20",
        to: "2026-11-10",
        client: mockClient,
      }),
    ).rejects.toMatchObject({
      statusCode: 400,
      code: "INVALID_DATE_RANGE",
    });
  });

  test("throws 400 when date range exceeds 365 days", async () => {
    mockClient.portfolio.findFirst.mockResolvedValue({
      id: portfolioId,
      name: "My Portfolio",
    });

    await expect(
      getPortfolioHistoricalState(userId, portfolioId, {
        from: "2024-01-01",
        to: "2026-01-01",
        client: mockClient,
      }),
    ).rejects.toMatchObject({
      statusCode: 400,
      code: "DATE_RANGE_TOO_LARGE",
    });
  });

  test("returns chronological historical state, trade metrics, and accurate gap tracking", async () => {
    mockClient.portfolio.findFirst.mockResolvedValue({
      id: portfolioId,
      name: "Long Term Growth",
    });

    // Request from 2026-11-01 to 2026-11-05 (5 days)
    // Snapshots exist for Nov 1, Nov 2, and Nov 5 (Nov 3 and 4 are missing)
    mockClient.performanceSnapshot.findMany.mockResolvedValue([
      {
        id: "snap-1",
        portfolioId,
        snapshotDate: new Date("2026-11-01T00:00:00.000Z"),
        totalValue: new Prisma.Decimal("10000.00000000"),
        cashBalance: new Prisma.Decimal("5000.00000000"),
        holdingsValue: new Prisma.Decimal("5000.00000000"),
        dailyPnl: new Prisma.Decimal("0.00000000"),
        dailyPnlPct: new Prisma.Decimal("0.0000"),
      },
      {
        id: "snap-2",
        portfolioId,
        snapshotDate: new Date("2026-11-02T00:00:00.000Z"),
        totalValue: new Prisma.Decimal("10200.00000000"),
        cashBalance: new Prisma.Decimal("4500.00000000"),
        holdingsValue: new Prisma.Decimal("5700.00000000"),
        dailyPnl: new Prisma.Decimal("200.00000000"),
        dailyPnlPct: new Prisma.Decimal("0.0200"),
      },
      {
        id: "snap-5",
        portfolioId,
        snapshotDate: new Date("2026-11-05T00:00:00.000Z"),
        totalValue: new Prisma.Decimal("10500.00000000"),
        cashBalance: new Prisma.Decimal("4500.00000000"),
        holdingsValue: new Prisma.Decimal("6000.00000000"),
        dailyPnl: new Prisma.Decimal("300.00000000"),
        dailyPnlPct: new Prisma.Decimal("0.0294"),
      },
    ]);

    // Trade activity
    mockClient.trade.findMany.mockResolvedValue([
      {
        executedAt: new Date("2026-11-02T14:30:00.000Z"),
        totalValue: new Prisma.Decimal("500.00000000"),
      },
      {
        executedAt: new Date("2026-11-02T15:00:00.000Z"),
        totalValue: new Prisma.Decimal("250.00000000"),
      },
    ]);

    const result = await getPortfolioHistoricalState(userId, portfolioId, {
      from: "2026-11-01",
      to: "2026-11-05",
      client: mockClient,
    });

    expect(result.portfolioId).toBe(portfolioId);
    expect(result.metadata.totalDays).toBe(5);
    expect(result.metadata.recordedDays).toBe(3);
    expect(result.metadata.missingDays).toBe(2);
    expect(result.metadata.hasGaps).toBe(true);

    // Gaps should indicate Nov 3 to Nov 4
    expect(result.metadata.gaps).toEqual([
      {
        from: "2026-11-03",
        to: "2026-11-04",
        missingDays: 2,
      },
    ]);

    // History contains only the 3 recorded days
    expect(result.history).toHaveLength(3);

    // Day 1
    expect(result.history[0].date).toBe("2026-11-01");
    expect(result.history[0].totalValue).toBe("10000.00000000");
    expect(result.history[0].tradesCount).toBe(0);
    expect(result.history[0].tradeVolume).toBe("0.00000000");

    // Day 2
    expect(result.history[1].date).toBe("2026-11-02");
    expect(result.history[1].dailyPnl).toBe("200.00000000");
    expect(result.history[1].dailyPnlPct).toBe("2.0000");
    expect(result.history[1].tradesCount).toBe(2);
    expect(result.history[1].tradeVolume).toBe("750.00000000");

    // Day 5
    expect(result.history[2].date).toBe("2026-11-05");
    expect(result.history[2].totalValue).toBe("10500.00000000");
  });

  test("validates historical gap metadata against unique snapshot dates when duplicate-date records exist", async () => {
    mockClient.portfolio.findFirst.mockResolvedValue({
      id: portfolioId,
      name: "Deduplication Test",
    });

    // 4 snapshots returned, but two share the same date (2026-11-02)
    // Range is 2026-11-01 to 2026-11-04 (4 calendar days)
    // Distinct recorded dates are Nov 1, Nov 2, Nov 4 (Nov 3 missing)
    mockClient.performanceSnapshot.findMany.mockResolvedValue([
      {
        id: "snap-1",
        portfolioId,
        snapshotDate: new Date("2026-11-01T00:00:00.000Z"),
        totalValue: new Prisma.Decimal("10000.00000000"),
        cashBalance: new Prisma.Decimal("5000.00000000"),
        holdingsValue: new Prisma.Decimal("5000.00000000"),
        dailyPnl: new Prisma.Decimal("0.00000000"),
        dailyPnlPct: new Prisma.Decimal("0.0000"),
      },
      {
        id: "snap-2-first",
        portfolioId,
        snapshotDate: new Date("2026-11-02T00:00:00.000Z"),
        totalValue: new Prisma.Decimal("10100.00000000"),
        cashBalance: new Prisma.Decimal("5000.00000000"),
        holdingsValue: new Prisma.Decimal("5100.00000000"),
        dailyPnl: new Prisma.Decimal("100.00000000"),
        dailyPnlPct: new Prisma.Decimal("0.0100"),
      },
      {
        id: "snap-2-second",
        portfolioId,
        snapshotDate: new Date("2026-11-02T00:00:00.000Z"),
        totalValue: new Prisma.Decimal("10200.00000000"),
        cashBalance: new Prisma.Decimal("5000.00000000"),
        holdingsValue: new Prisma.Decimal("5200.00000000"),
        dailyPnl: new Prisma.Decimal("200.00000000"),
        dailyPnlPct: new Prisma.Decimal("0.0200"),
      },
      {
        id: "snap-4",
        portfolioId,
        snapshotDate: new Date("2026-11-04T00:00:00.000Z"),
        totalValue: new Prisma.Decimal("10300.00000000"),
        cashBalance: new Prisma.Decimal("5000.00000000"),
        holdingsValue: new Prisma.Decimal("5300.00000000"),
        dailyPnl: new Prisma.Decimal("100.00000000"),
        dailyPnlPct: new Prisma.Decimal("0.0098"),
      },
    ]);

    mockClient.trade.findMany.mockResolvedValue([]);

    const result = await getPortfolioHistoricalState(userId, portfolioId, {
      from: "2026-11-01",
      to: "2026-11-04",
      client: mockClient,
    });

    // Metadata must be based on DISTINCT recorded dates (3), not raw snapshot row count (4)
    expect(result.metadata.totalDays).toBe(4);
    expect(result.metadata.recordedDays).toBe(3);
    expect(result.metadata.missingDays).toBe(1); // 4 total - 3 unique = 1 missing (Nov 3)
    expect(result.metadata.hasGaps).toBe(true);
    expect(result.metadata.gaps).toEqual([
      {
        from: "2026-11-03",
        to: "2026-11-03",
        missingDays: 1,
      },
    ]);
    expect(result.history).toHaveLength(3);
    expect(result.history.map((h) => h.date)).toEqual(["2026-11-01", "2026-11-02", "2026-11-04"]);
  });

  test("accurately tracks boundary gaps at the start and end of requested date window", async () => {
    mockClient.portfolio.findFirst.mockResolvedValue({
      id: portfolioId,
      name: "Boundary Gap Test",
    });

    // Request from 2026-11-01 to 2026-11-05 (5 days)
    // Only 2026-11-03 has a recorded snapshot
    mockClient.performanceSnapshot.findMany.mockResolvedValue([
      {
        id: "snap-mid",
        portfolioId,
        snapshotDate: new Date("2026-11-03T00:00:00.000Z"),
        totalValue: new Prisma.Decimal("10000.00000000"),
        cashBalance: new Prisma.Decimal("5000.00000000"),
        holdingsValue: new Prisma.Decimal("5000.00000000"),
        dailyPnl: new Prisma.Decimal("0.00000000"),
        dailyPnlPct: new Prisma.Decimal("0.0000"),
      },
    ]);

    mockClient.trade.findMany.mockResolvedValue([]);

    const result = await getPortfolioHistoricalState(userId, portfolioId, {
      from: "2026-11-01",
      to: "2026-11-05",
      client: mockClient,
    });

    expect(result.metadata.totalDays).toBe(5);
    expect(result.metadata.recordedDays).toBe(1);
    expect(result.metadata.missingDays).toBe(4);
    expect(result.metadata.hasGaps).toBe(true);

    // Gaps must include start boundary (Nov 1-2) and end boundary (Nov 4-5)
    expect(result.metadata.gaps).toEqual([
      {
        from: "2026-11-01",
        to: "2026-11-02",
        missingDays: 2,
      },
      {
        from: "2026-11-04",
        to: "2026-11-05",
        missingDays: 2,
      },
    ]);
  });
});
