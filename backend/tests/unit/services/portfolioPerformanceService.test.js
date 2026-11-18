const { Prisma } = require("@prisma/client");
const { getPortfolioPerformance } = require("../../../src/services/portfolioPerformanceService");
const { getPortfolioHistoricalState } = require("../../../src/services/portfolioHistoryService");

describe("Portfolio Performance Service (Task 37.2)", () => {
  const userId = "usr-perf-1";
  const portfolioId = "port-perf-1";

  let mockClient;

  beforeEach(() => {
    mockClient = {
      portfolio: {
        findFirst: jest.fn(),
      },
      performanceSnapshot: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
      },
      trade: {
        aggregate: jest.fn(),
        findMany: jest.fn(),
      },
    };
  });

  test("throws 404 when portfolio does not belong to user", async () => {
    mockClient.portfolio.findFirst.mockResolvedValue(null);

    await expect(
      getPortfolioPerformance(userId, portfolioId, { client: mockClient }),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: "PORTFOLIO_NOT_FOUND",
    });
  });

  test("rejects when from date is after to date", async () => {
    mockClient.portfolio.findFirst.mockResolvedValue({
      id: portfolioId,
      name: "Main Portfolio",
      startingBalance: new Prisma.Decimal("10000"),
      cashBalance: new Prisma.Decimal("10000"),
    });

    await expect(
      getPortfolioPerformance(userId, portfolioId, {
        from: "2026-11-20",
        to: "2026-11-10",
        client: mockClient,
      }),
    ).rejects.toMatchObject({
      statusCode: 400,
      code: "INVALID_DATE_RANGE",
    });
  });

  test("calculates performance with prior baseline snapshot and realized trades", async () => {
    mockClient.portfolio.findFirst.mockResolvedValue({
      id: portfolioId,
      name: "Active Growth",
      startingBalance: new Prisma.Decimal("10000.00000000"),
      cashBalance: new Prisma.Decimal("6000.00000000"),
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    });

    // Prior snapshot baseline before startDate
    mockClient.performanceSnapshot.findFirst.mockResolvedValue({
      id: "prior-snap",
      portfolioId,
      snapshotDate: new Date("2026-10-31T00:00:00.000Z"),
      totalValue: new Prisma.Decimal("10000.00000000"),
      cashBalance: new Prisma.Decimal("5000.00000000"),
      holdingsValue: new Prisma.Decimal("5000.00000000"),
    });

    // Snapshots in period
    mockClient.performanceSnapshot.findMany.mockResolvedValue([
      {
        id: "snap-1",
        portfolioId,
        snapshotDate: new Date("2026-11-01T00:00:00.000Z"),
        totalValue: new Prisma.Decimal("10200.00000000"),
        cashBalance: new Prisma.Decimal("5000.00000000"),
        holdingsValue: new Prisma.Decimal("5200.00000000"),
        dailyPnl: new Prisma.Decimal("200.00000000"),
        dailyPnlPct: new Prisma.Decimal("0.0200"),
      },
      {
        id: "snap-2",
        portfolioId,
        snapshotDate: new Date("2026-11-02T00:00:00.000Z"),
        totalValue: new Prisma.Decimal("10500.00000000"),
        cashBalance: new Prisma.Decimal("6000.00000000"),
        holdingsValue: new Prisma.Decimal("4500.00000000"),
        dailyPnl: new Prisma.Decimal("300.00000000"),
        dailyPnlPct: new Prisma.Decimal("0.0294"),
      },
      {
        id: "snap-3",
        portfolioId,
        snapshotDate: new Date("2026-11-03T00:00:00.000Z"),
        totalValue: new Prisma.Decimal("10400.00000000"),
        cashBalance: new Prisma.Decimal("6000.00000000"),
        holdingsValue: new Prisma.Decimal("4400.00000000"),
        dailyPnl: new Prisma.Decimal("-100.00000000"),
        dailyPnlPct: new Prisma.Decimal("-0.0095"),
      },
    ]);

    // Closed trades in period
    mockClient.trade.aggregate.mockResolvedValue({
      _sum: {
        realizedPnl: new Prisma.Decimal("150.00000000"),
        fees: new Prisma.Decimal("4.50000000"),
      },
      _count: {
        id: 2,
      },
    });

    const result = await getPortfolioPerformance(userId, portfolioId, {
      from: "2026-11-01",
      to: "2026-11-03",
      client: mockClient,
    });

    expect(result.portfolioId).toBe(portfolioId);
    expect(result.period).toBe("CUSTOM");
    expect(result.baseline.source).toBe("prior_snapshot");
    expect(result.baseline.totalValue).toBe("10000.00000000");
    expect(result.current.totalValue).toBe("10400.00000000");

    // Net P&L = 10400 - 10000 = 400
    expect(result.performance.startValue).toBe("10000.00000000");
    expect(result.performance.endValue).toBe("10400.00000000");
    expect(result.performance.netPnl).toBe("400.00000000");
    expect(result.performance.returnPct).toBe("4.0000");

    // Realized = 150, Unrealized = 400 - 150 = 250
    expect(result.performance.realizedPnl).toBe("150.00000000");
    expect(result.performance.unrealizedPnl).toBe("250.00000000");
    expect(result.performance.fees).toBe("4.50000000");
    expect(result.performance.tradesCount).toBe(2);

    // Best & worst day
    expect(result.performance.bestDay).toEqual({
      date: "2026-11-02",
      pnl: "300.00000000",
      returnPct: "2.9400",
    });
    expect(result.performance.worstDay).toEqual({
      date: "2026-11-03",
      pnl: "-100.00000000",
      returnPct: "-0.9500",
    });

    expect(result.series).toHaveLength(3);
  });

  test("falls back to portfolio starting balance when no snapshots exist", async () => {
    mockClient.portfolio.findFirst.mockResolvedValue({
      id: portfolioId,
      name: "Empty Portfolio",
      startingBalance: new Prisma.Decimal("5000.00000000"),
      cashBalance: new Prisma.Decimal("5000.00000000"),
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    });

    mockClient.performanceSnapshot.findFirst.mockResolvedValue(null);
    mockClient.performanceSnapshot.findMany.mockResolvedValue([]);
    mockClient.trade.aggregate.mockResolvedValue({
      _sum: { realizedPnl: null, fees: null },
      _count: { id: 0 },
    });

    const result = await getPortfolioPerformance(userId, portfolioId, {
      period: "1M",
      client: mockClient,
    });

    expect(result.baseline.source).toBe("starting_balance");
    expect(result.baseline.totalValue).toBe("5000.00000000");
    expect(result.performance.startValue).toBe("5000.00000000");
    expect(result.performance.endValue).toBe("5000.00000000");
    expect(result.performance.netPnl).toBe("0.00000000");
    expect(result.performance.returnPct).toBe("0.0000");
    expect(result.performance.bestDay).toBeNull();
    expect(result.performance.worstDay).toBeNull();
    expect(result.series).toHaveLength(0);
  });

  test("normalizes date-only 'to' boundary to end of requested UTC day and captures same-day trades and snapshots", async () => {
    mockClient.portfolio.findFirst.mockResolvedValue({
      id: portfolioId,
      name: "Day Boundary Test",
      startingBalance: new Prisma.Decimal("10000.00000000"),
      cashBalance: new Prisma.Decimal("10000.00000000"),
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    });

    mockClient.performanceSnapshot.findFirst.mockResolvedValue({
      id: "baseline-snap",
      snapshotDate: new Date("2026-11-17T23:59:59.000Z"),
      totalValue: new Prisma.Decimal("10000.00000000"),
      cashBalance: new Prisma.Decimal("5000.00000000"),
      holdingsValue: new Prisma.Decimal("5000.00000000"),
    });

    // End-of-day snapshot captured on 2026-11-18
    mockClient.performanceSnapshot.findMany.mockResolvedValue([
      {
        id: "snap-today",
        portfolioId,
        snapshotDate: new Date("2026-11-18T23:59:59.000Z"),
        totalValue: new Prisma.Decimal("10800.00000000"),
        cashBalance: new Prisma.Decimal("4000.00000000"),
        holdingsValue: new Prisma.Decimal("6800.00000000"),
        dailyPnl: new Prisma.Decimal("800.00000000"),
        dailyPnlPct: new Prisma.Decimal("0.0800"),
      },
    ]);

    // Trade executed intraday on 2026-11-18 afternoon (15:45 UTC)
    mockClient.trade.aggregate.mockResolvedValue({
      _sum: {
        realizedPnl: new Prisma.Decimal("300.00000000"),
        fees: new Prisma.Decimal("5.00000000"),
      },
      _count: { id: 1 },
    });

    // Query with date-only string "2026-11-18"
    const result = await getPortfolioPerformance(userId, portfolioId, {
      from: "2026-11-18",
      to: "2026-11-18",
      client: mockClient,
    });

    // Verify snapshot query includes up to 23:59:59.999Z of November 18
    expect(mockClient.performanceSnapshot.findMany).toHaveBeenCalledWith({
      where: {
        portfolioId,
        snapshotDate: {
          gte: new Date("2026-11-18T00:00:00.000Z"),
          lte: new Date("2026-11-18T23:59:59.999Z"),
        },
      },
      orderBy: { snapshotDate: "asc" },
    });

    // Verify trade query also uses the full end-of-day boundary
    expect(mockClient.trade.aggregate).toHaveBeenCalledWith({
      where: {
        portfolioId,
        executedAt: {
          gte: new Date("2026-11-18T00:00:00.000Z"),
          lte: new Date("2026-11-18T23:59:59.999Z"),
        },
      },
      _sum: {
        realizedPnl: true,
        fees: true,
      },
      _count: {
        id: true,
      },
    });

    expect(result.performance.netPnl).toBe("800.00000000");
    expect(result.performance.realizedPnl).toBe("300.00000000");
    expect(result.performance.unrealizedPnl).toBe("500.00000000");
    expect(result.series).toHaveLength(1);
    expect(result.series[0].date).toBe("2026-11-18");
  });

  test("ensures performance and history endpoints use compatible date boundaries for identical from and to inputs", async () => {
    mockClient.portfolio.findFirst.mockResolvedValue({
      id: portfolioId,
      name: "Compatibility Test",
      startingBalance: new Prisma.Decimal("10000"),
      cashBalance: new Prisma.Decimal("10000"),
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    });

    mockClient.performanceSnapshot.findFirst.mockResolvedValue(null);
    mockClient.performanceSnapshot.findMany.mockResolvedValue([]);
    mockClient.trade.aggregate.mockResolvedValue({
      _sum: { realizedPnl: null, fees: null },
      _count: { id: 0 },
    });
    mockClient.trade.findMany.mockResolvedValue([]);

    const from = "2026-11-01";
    const to = "2026-11-15";

    const perfResult = await getPortfolioPerformance(userId, portfolioId, {
      from,
      to,
      client: mockClient,
    });

    const histResult = await getPortfolioHistoricalState(userId, portfolioId, {
      from,
      to,
      client: mockClient,
    });

    // Both endpoints resolve the exact same start date and end date
    expect(perfResult.startDate).toBe("2026-11-01T00:00:00.000Z");
    expect(perfResult.endDate).toBe("2026-11-15T23:59:59.999Z");
    expect(histResult.metadata.requestedRange.from).toBe("2026-11-01");
    expect(histResult.metadata.requestedRange.to).toBe("2026-11-15");
  });

  test("aligns TWR with selected baseline and does not compound first snapshot return when first snapshot is the baseline", async () => {
    mockClient.portfolio.findFirst.mockResolvedValue({
      id: portfolioId,
      name: "TWR Baseline Alignment",
      startingBalance: new Prisma.Decimal("10000.00000000"),
      cashBalance: new Prisma.Decimal("10000.00000000"),
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    });

    // No prior snapshot before requested window
    mockClient.performanceSnapshot.findFirst.mockResolvedValue(null);

    // Snapshots inside period:
    // First snapshot has totalValue = 10,000, and a non-zero dailyPnl = 1000, dailyPnlPct = 0.10 (from before the window)
    // Second snapshot has totalValue = 10,500, dailyPnl = 500, dailyPnlPct = 0.05 (+5%)
    // Third snapshot has totalValue = 11,025, dailyPnl = 525, dailyPnlPct = 0.05 (+5%)
    mockClient.performanceSnapshot.findMany.mockResolvedValue([
      {
        id: "snap-baseline-1",
        portfolioId,
        snapshotDate: new Date("2026-11-01T00:00:00.000Z"),
        totalValue: new Prisma.Decimal("10000.00000000"),
        cashBalance: new Prisma.Decimal("5000.00000000"),
        holdingsValue: new Prisma.Decimal("5000.00000000"),
        dailyPnl: new Prisma.Decimal("1000.00000000"),
        dailyPnlPct: new Prisma.Decimal("0.1000"), // 10% occurred before or on baseline
      },
      {
        id: "snap-baseline-2",
        portfolioId,
        snapshotDate: new Date("2026-11-02T00:00:00.000Z"),
        totalValue: new Prisma.Decimal("10500.00000000"),
        cashBalance: new Prisma.Decimal("5000.00000000"),
        holdingsValue: new Prisma.Decimal("5500.00000000"),
        dailyPnl: new Prisma.Decimal("500.00000000"),
        dailyPnlPct: new Prisma.Decimal("0.0500"), // +5%
      },
      {
        id: "snap-baseline-3",
        portfolioId,
        snapshotDate: new Date("2026-11-03T00:00:00.000Z"),
        totalValue: new Prisma.Decimal("11025.00000000"),
        cashBalance: new Prisma.Decimal("5000.00000000"),
        holdingsValue: new Prisma.Decimal("6025.00000000"),
        dailyPnl: new Prisma.Decimal("525.00000000"),
        dailyPnlPct: new Prisma.Decimal("0.0500"), // +5%
      },
    ]);

    mockClient.trade.aggregate.mockResolvedValue({
      _sum: { realizedPnl: null, fees: null },
      _count: { id: 0 },
    });

    const result = await getPortfolioPerformance(userId, portfolioId, {
      from: "2026-11-01",
      to: "2026-11-03",
      client: mockClient,
    });

    // 1. Verify reported baseline is correct
    expect(result.baseline.source).toBe("period_start_snapshot");
    expect(result.baseline.date).toBe("2026-11-01");
    expect(result.baseline.totalValue).toBe("10000.00000000");

    // 2. Verify returnPct uses that baseline: (11025 - 10000) / 10000 = 10.2500%
    expect(result.performance.startValue).toBe("10000.00000000");
    expect(result.performance.endValue).toBe("11025.00000000");
    expect(result.performance.netPnl).toBe("1025.00000000");
    expect(result.performance.returnPct).toBe("10.2500");

    // 3. Verify timeWeightedReturnPct does not include performance from before baseline:
    // (1 + 0.05) * (1 + 0.05) - 1 = 1.1025 - 1 = 10.2500%
    // (If the first snapshot's 10% was erroneously compounded, it would be 21.2750%)
    expect(result.performance.timeWeightedReturnPct).toBe("10.2500");

    // 4. Verify both returns describe identical period boundaries
    expect(result.performance.returnPct).toBe(result.performance.timeWeightedReturnPct);
  });

  test("returns zero returnPct and timeWeightedReturnPct when single snapshot serves as baseline", async () => {
    mockClient.portfolio.findFirst.mockResolvedValue({
      id: portfolioId,
      name: "Single Snapshot Portfolio",
      startingBalance: new Prisma.Decimal("10000.00000000"),
      cashBalance: new Prisma.Decimal("10000.00000000"),
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    });

    mockClient.performanceSnapshot.findFirst.mockResolvedValue(null);
    mockClient.performanceSnapshot.findMany.mockResolvedValue([
      {
        id: "single-snap",
        portfolioId,
        snapshotDate: new Date("2026-11-01T00:00:00.000Z"),
        totalValue: new Prisma.Decimal("10500.00000000"),
        cashBalance: new Prisma.Decimal("5000.00000000"),
        holdingsValue: new Prisma.Decimal("5500.00000000"),
        dailyPnl: new Prisma.Decimal("500.00000000"),
        dailyPnlPct: new Prisma.Decimal("0.0500"), // non-zero daily return before baseline
      },
    ]);

    mockClient.trade.aggregate.mockResolvedValue({
      _sum: { realizedPnl: null, fees: null },
      _count: { id: 0 },
    });

    const result = await getPortfolioPerformance(userId, portfolioId, {
      from: "2026-11-01",
      to: "2026-11-01",
      client: mockClient,
    });

    expect(result.baseline.source).toBe("period_start_snapshot");
    expect(result.baseline.totalValue).toBe("10500.00000000");
    expect(result.performance.startValue).toBe("10500.00000000");
    expect(result.performance.endValue).toBe("10500.00000000");
    expect(result.performance.returnPct).toBe("0.0000");
    expect(result.performance.timeWeightedReturnPct).toBe("0.0000");
  });
});
