const { Prisma } = require("@prisma/client");
const { getPortfolioDashboard } = require("../../../src/services/dashboardService");
const { getPortfolioAggregatePnl } = require("../../../src/services/portfolioPnlAggregateService");
const { findLatestSnapshot } = require("../../../src/services/portfolioSnapshotRepository");

jest.mock("../../../src/services/portfolioPnlAggregateService", () => ({
  getPortfolioAggregatePnl: jest.fn(),
}));
jest.mock("../../../src/services/portfolioSnapshotRepository", () => ({
  findLatestSnapshot: jest.fn(),
}));

describe("Portfolio Dashboard Summary Service", () => {
  const userId = "user-123";
  const portfolioId = "portfolio-456";

  let mockClient;

  beforeEach(() => {
    jest.clearAllMocks();
    mockClient = {
      portfolio: {
        findFirst: jest.fn(),
      },
      trade: {
        findMany: jest.fn(),
      },
      order: {
        findMany: jest.fn(),
        count: jest.fn(),
      },
    };
  });

  test("throws 404 when portfolio does not belong to user", async () => {
    mockClient.portfolio.findFirst.mockResolvedValue(null);

    await expect(
      getPortfolioDashboard(userId, portfolioId, { client: mockClient }),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: "PORTFOLIO_NOT_FOUND",
    });
  });

  test("aggregates portfolio, performance, positions, and recent activity into unified dashboard DTO", async () => {
    mockClient.portfolio.findFirst.mockResolvedValue({
      id: portfolioId,
      name: "Default Portfolio",
      description: "My trading portfolio",
      currency: "USD",
      isDefault: true,
      createdAt: new Date("2026-10-01T00:00:00.000Z"),
    });

    getPortfolioAggregatePnl.mockResolvedValue({
      startingBalance: "10000.00000000",
      cashBalance: "5000.00000000",
      openHoldingsValue: "5500.00000000",
      openHoldingsCostBasis: "5000.00000000",
      totalPortfolioValue: "10500.00000000",
      netPnl: "500.00000000",
      netPnlPct: "5.0000",
      accountPnl: "500.00000000",
      accountPnlPct: "5.0000",
      realized: {
        pnl: "200.00000000",
        pnlPct: "10.0000",
        winRate: 0.8,
        winningTrades: 4,
        losingTrades: 1,
        tradeCount: 5,
      },
      unrealized: {
        pnl: "300.00000000",
        pnlPct: "6.0000",
        positionCount: 2,
        isStale: false,
        freshness: "FRESH",
        positions: [
          { symbol: "NVDA", marketValue: "2000.00000000", unrealizedPnl: "100.00000000" },
          { symbol: "AAPL", marketValue: "3500.00000000", unrealizedPnl: "200.00000000" },
        ],
      },
    });

    findLatestSnapshot.mockResolvedValue({
      dailyPnl: new Prisma.Decimal("120.00000000"),
      dailyPnlPct: new Prisma.Decimal("0.0115"),
      snapshotDate: new Date("2026-11-17T00:00:00.000Z"),
    });

    mockClient.trade.findMany.mockResolvedValue([
      {
        id: "tr-1",
        orderId: "ord-1",
        symbol: "AAPL",
        side: "BUY",
        quantity: new Prisma.Decimal("10.00000000"),
        price: new Prisma.Decimal("150.00000000"),
        totalValue: new Prisma.Decimal("1500.00000000"),
        fees: new Prisma.Decimal("0.00000000"),
        realizedPnl: null,
        realizedPnlPct: null,
        executedAt: new Date("2026-11-17T12:00:00.000Z"),
      },
    ]);

    mockClient.order.findMany.mockResolvedValue([
      {
        id: "ord-pending-1",
        symbol: "TSLA",
        assetType: "STOCK",
        side: "BUY",
        type: "LIMIT",
        status: "PENDING",
        quantity: new Prisma.Decimal("5.00000000"),
        limitPrice: new Prisma.Decimal("200.00000000"),
        stopPrice: null,
        executedPrice: null,
        executedAt: null,
        createdAt: new Date("2026-11-18T08:00:00.000Z"),
      },
    ]);

    mockClient.order.count.mockResolvedValue(1);

    const result = await getPortfolioDashboard(userId, portfolioId, {
      client: mockClient,
      asOf: new Date("2026-11-18T10:00:00.000Z"),
    });

    // Check Portfolio Metadata
    expect(result.portfolio.name).toBe("Default Portfolio");
    expect(result.portfolio.cashBalance).toBe("5000.00000000");
    expect(result.portfolio.totalValue).toBe("10500.00000000");

    // Check Performance Metrics
    expect(result.performance.totalPnl).toBe("500.00000000");
    expect(result.performance.dailyPnl).toBe("120");
    expect(result.performance.dailyReturnPct).toBe("0.0115");
    expect(result.performance.lastSnapshotDate).toBe("2026-11-17");
    expect(result.performance.winRate).toBe(0.8);

    // Check Positions Summary & Top Positions sorted by market value
    expect(result.positionsSummary.openPositionsCount).toBe(2);
    expect(result.positionsSummary.isStale).toBe(false);
    expect(result.positionsSummary.topPositions[0].symbol).toBe("AAPL"); // 3500 > 2000
    expect(result.positionsSummary.topPositions[1].symbol).toBe("NVDA");

    // Check Recent Activity
    expect(result.recentActivity.pendingOrdersCount).toBe(1);
    expect(result.recentActivity.recentOrders).toHaveLength(1);
    expect(result.recentActivity.recentTrades).toHaveLength(1);
  });
});
