jest.mock("../../../src/services/portfolioSeriesService", () => ({
  getPortfolioReturnSeries: jest.fn(),
}));

const {
  getPortfolioReturnSeries,
} = require("../../../src/services/portfolioSeriesService");
const { getPortfolioRiskMetrics } = require("../../../src/services/riskMetricsService");

describe("getPortfolioRiskMetrics annualization", () => {
  test("uses 365 observations per year for calendar-daily snapshots", async () => {
    getPortfolioReturnSeries.mockResolvedValue({
      period: "1M",
      series: [
        { date: "2026-11-01", totalValue: "10000", dailyReturn: "0.01" },
        { date: "2026-11-02", totalValue: "10100", dailyReturn: "-0.01" },
      ],
    });

    const result = await getPortfolioRiskMetrics("portfolio-1", {});

    // sample stddev 0.0141421 * sqrt(365) = 0.2702
    expect(result.metrics.annualizedVolatility).toBe("0.2702");
  });
});
