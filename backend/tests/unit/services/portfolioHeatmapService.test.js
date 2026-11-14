const { Prisma } = require("@prisma/client");
const { getPortfolioPnlHeatmap } = require("../../../src/services/portfolioHeatmapService");

jest.mock("../../../src/services/portfolioSeriesService", () => ({
  getPortfolioReturnSeries: jest.fn(),
}));

const { getPortfolioReturnSeries } = require("../../../src/services/portfolioSeriesService");

describe("portfolioHeatmapService unit tests", () => {
  const portfolioId = "11111111-1111-4111-8111-111111111111";

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("aggregates win, loss, and flat days and computes total PnL", async () => {
    getPortfolioReturnSeries.mockResolvedValue({
      portfolioId,
      period: "1M",
      series: [
        {
          date: "2026-11-01",
          dailyPnl: new Prisma.Decimal("150.5"),
          dailyReturn: new Prisma.Decimal("0.01505"),
          totalValue: new Prisma.Decimal("10150.5"),
        },
        {
          date: "2026-11-02",
          dailyPnl: new Prisma.Decimal("-50.25"),
          dailyReturn: new Prisma.Decimal("-0.00495"),
          totalValue: new Prisma.Decimal("10100.25"),
        },
        {
          date: "2026-11-03",
          dailyPnl: new Prisma.Decimal("0"),
          dailyReturn: new Prisma.Decimal("0"),
          totalValue: new Prisma.Decimal("10100.25"),
        },
      ],
      cumulativeReturn: new Prisma.Decimal("0.010025"),
    });

    const result = await getPortfolioPnlHeatmap(portfolioId, { period: "1M" });

    expect(result.portfolioId).toBe(portfolioId);
    expect(result.period).toBe("1M");
    expect(result.heatmap).toHaveLength(3);

    expect(result.heatmap[0]).toEqual({
      date: "2026-11-01",
      pnl: "150.50000000",
      pnlPercent: "0.0151",
      totalValue: "10150.50000000",
    });

    expect(result.heatmap[1]).toEqual({
      date: "2026-11-02",
      pnl: "-50.25000000",
      pnlPercent: "-0.0050",
      totalValue: "10100.25000000",
    });

    expect(result.heatmap[2]).toEqual({
      date: "2026-11-03",
      pnl: "0.00000000",
      pnlPercent: "0.0000",
      totalValue: "10100.25000000",
    });

    expect(result.summary).toEqual({
      totalPnl: "100.25000000",
      winDays: 1,
      lossDays: 1,
      flatDays: 1,
    });
  });

  test("handles empty series without errors", async () => {
    getPortfolioReturnSeries.mockResolvedValue({
      portfolioId,
      period: "1Y",
      series: [],
      cumulativeReturn: new Prisma.Decimal(0),
    });

    const result = await getPortfolioPnlHeatmap(portfolioId, { period: "1Y" });

    expect(result.heatmap).toEqual([]);
    expect(result.summary).toEqual({
      totalPnl: "0.00000000",
      winDays: 0,
      lossDays: 0,
      flatDays: 0,
    });
  });
});

