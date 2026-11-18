const { getPortfolioAggregatePnl } = require("../../../src/services/portfolioPnlAggregateService");
const realizedPnlService = require("../../../src/services/realizedPnlService");
const unrealizedPnlService = require("../../../src/services/unrealizedPnlService");

jest.mock("../../../src/services/realizedPnlService", () => ({
  getPortfolioRealizedPnl: jest.fn(),
}));
jest.mock("../../../src/services/unrealizedPnlService", () => ({
  getPortfolioUnrealizedPnl: jest.fn(),
}));

describe("Portfolio Aggregate P&L Service", () => {
  const userId = "user-123";
  const portfolioId = "portfolio-456";

  let mockClient;

  beforeEach(() => {
    jest.clearAllMocks();
    mockClient = {
      portfolio: {
        findFirst: jest.fn(),
      },
    };
  });

  test("throws 404 when portfolio does not belong to user", async () => {
    mockClient.portfolio.findFirst.mockResolvedValue(null);

    await expect(
      getPortfolioAggregatePnl(userId, portfolioId, { client: mockClient }),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: "PORTFOLIO_NOT_FOUND",
    });
  });

  test("aggregates realized and unrealized P&L without double counting fees or positions", async () => {
    mockClient.portfolio.findFirst.mockResolvedValue({
      id: portfolioId,
      name: "Main Portfolio",
      currency: "USD",
      startingBalance: "10000.00000000",
      cashBalance: "4000.00000000",
      isActive: true,
    });

    realizedPnlService.getPortfolioRealizedPnl.mockResolvedValue({
      portfolioId,
      period: "1M",
      startDate: "2026-10-18T00:00:00.000Z",
      endDate: "2026-11-18T00:00:00.000Z",
      realizedPnl: "200.00000000",
      realizedPnlPct: "10.0000",
      totalProceeds: "2200.00000000",
      totalCostBasis: "1995.00000000",
      totalFees: "5.00000000",
      tradeCount: 2,
      winningTrades: 2,
      losingTrades: 0,
      breakevenTrades: 0,
      winRate: 1.0,
      bySymbol: [],
    });

    unrealizedPnlService.getPortfolioUnrealizedPnl.mockResolvedValue({
      portfolioId,
      totalInvested: "6000.00000000",
      marketValue: "6300.00000000",
      unrealizedPnl: "300.00000000",
      unrealizedPnlPct: "5.0000",
      isStale: false,
      freshness: "FRESH",
      positionCount: 1,
      positions: [
        {
          symbol: "AAPL",
          quantity: "20.00000000",
          marketValue: "6300.00000000",
          unrealizedPnl: "300.00000000",
          isStale: false,
          freshness: "FRESH",
        },
      ],
    });

    const result = await getPortfolioAggregatePnl(userId, portfolioId, {
      period: "1M",
      client: mockClient,
      asOf: new Date("2026-11-18T10:00:00.000Z"),
    });

    expect(result.portfolioId).toBe(portfolioId);
    expect(result.startingBalance).toBe("10000.00000000");
    expect(result.cashBalance).toBe("4000.00000000");
    expect(result.openHoldingsValue).toBe("6300.00000000");
    // total portfolio value = cash (4000) + open holdings (6300) = 10300
    expect(result.totalPortfolioValue).toBe("10300.00000000");

    // net P&L = realized (200) + unrealized (300) = 500
    expect(result.netPnl).toBe("500.00000000");
    // total deployed capital = openHoldingsCostBasis (6000) + realizedCostBasis (1995) = 7995
    // netPnlPct = 500 / 7995 * 100 = 6.2539%
    expect(result.netPnlPct).toBe("6.2539");

    // account P&L against starting balance (10300 - 10000 = 300)
    expect(result.accountPnl).toBe("300.00000000");
    expect(result.accountPnlPct).toBe("3.0000");

    expect(result.realized.pnl).toBe("200.00000000");
    expect(result.realized.fees).toBe("5.00000000");
    expect(result.unrealized.pnl).toBe("300.00000000");
    expect(result.reconciliation.isReconciled).toBe(true);
    expect(result.reconciliation.openPositionsCount).toBe(1);
    expect(result.reconciliation.closedTradesCount).toBe(2);
  });
});
