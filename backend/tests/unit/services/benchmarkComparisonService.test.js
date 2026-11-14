const { Prisma } = require("@prisma/client");
const { getBenchmarkComparison } = require("../../../src/services/benchmarkComparisonService");

jest.mock("../../../src/services/portfolioSeriesService", () => ({
  getPortfolioReturnSeries: jest.fn(),
}));

jest.mock("../../../src/services/benchmarkService", () => ({
  getBenchmarkPriceSeries: jest.fn(),
}));

const { getPortfolioReturnSeries } = require("../../../src/services/portfolioSeriesService");
const { getBenchmarkPriceSeries } = require("../../../src/services/benchmarkService");

describe("benchmarkComparisonService unit tests", () => {
  const portfolioId = "11111111-1111-4111-8111-111111111111";

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("aligns only on mutual dates and calculates alpha, beta, and correlation", async () => {
    // Portfolio has: Nov 1, Nov 2, Nov 3, Nov 4 (e.g. crypto trade on weekend)
    getPortfolioReturnSeries.mockResolvedValue({
      portfolioId,
      period: "1M",
      series: [
        {
          date: "2026-11-01",
          totalValue: new Prisma.Decimal("10000"),
          dailyReturn: new Prisma.Decimal("0.01"),
        },
        {
          date: "2026-11-02",
          totalValue: new Prisma.Decimal("10200"),
          dailyReturn: new Prisma.Decimal("0.02"),
        },
        {
          date: "2026-11-03",
          totalValue: new Prisma.Decimal("10100"),
          dailyReturn: new Prisma.Decimal("-0.01"),
        },
        {
          date: "2026-11-04",
          totalValue: new Prisma.Decimal("10300"),
          dailyReturn: new Prisma.Decimal("0.02"),
        },
      ],
      cumulativeReturn: new Prisma.Decimal("0.03"),
    });

    // Benchmark has: Nov 1, Nov 2, Nov 3 (closed Nov 4)
    getBenchmarkPriceSeries.mockResolvedValue({
      benchmark: "SPY",
      period: "1M",
      series: [
        {
          date: "2026-11-01",
          price: new Prisma.Decimal("500"),
          dailyReturn: new Prisma.Decimal("0.005"),
        },
        {
          date: "2026-11-02",
          price: new Prisma.Decimal("510"),
          dailyReturn: new Prisma.Decimal("0.010"),
        },
        {
          date: "2026-11-03",
          price: new Prisma.Decimal("505"),
          dailyReturn: new Prisma.Decimal("-0.005"),
        },
      ],
    });

    const result = await getBenchmarkComparison(portfolioId, {
      symbol: "SPY",
      period: "1M",
      riskFreeRate: 0.02,
    });

    expect(result.portfolioId).toBe(portfolioId);
    expect(result.benchmark).toBe("SPY");
    expect(result.comparison).toHaveLength(3); // Nov 1, 2, 3 only!
    expect(result.comparison[0].date).toBe("2026-11-01");
    expect(result.comparison[2].date).toBe("2026-11-03");

    // Check summary structure
    expect(result.summary).toHaveProperty("portfolioReturn");
    expect(result.summary).toHaveProperty("benchmarkReturn");
    expect(result.summary.beta).not.toBeNull();
    expect(result.summary.correlation).not.toBeNull();
    expect(result.summary.alpha).not.toBeNull();
  });

  test("returns null for statistical metrics when mutual observations < 2", async () => {
    // Only 1 overlapping date
    getPortfolioReturnSeries.mockResolvedValue({
      portfolioId,
      period: "1M",
      series: [
        {
          date: "2026-11-01",
          totalValue: new Prisma.Decimal("10000"),
          dailyReturn: new Prisma.Decimal("0.01"),
        },
      ],
    });

    getBenchmarkPriceSeries.mockResolvedValue({
      benchmark: "SPY",
      period: "1M",
      series: [
        {
          date: "2026-11-01",
          price: new Prisma.Decimal("500"),
          dailyReturn: new Prisma.Decimal("0.005"),
        },
      ],
    });

    const result = await getBenchmarkComparison(portfolioId, {
      symbol: "SPY",
      period: "1M",
    });

    expect(result.comparison).toHaveLength(1);
    expect(result.summary).toEqual({
      portfolioReturn: "0.0000",
      benchmarkReturn: "0.0000",
      alpha: null,
      beta: null,
      correlation: null,
    });
  });
});
