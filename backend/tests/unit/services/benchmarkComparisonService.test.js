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

  test("calculates deterministic beta = 2.00 and correlation = 1.00 for perfectly 2x-correlated series", async () => {
    getPortfolioReturnSeries.mockResolvedValue({
      portfolioId,
      period: "1M",
      series: [
        { date: "2026-11-01", totalValue: "10000", dailyReturn: "0.02" },
        { date: "2026-11-02", totalValue: "10400", dailyReturn: "0.04" },
        { date: "2026-11-03", totalValue: "10200", dailyReturn: "-0.02" },
      ],
    });

    getBenchmarkPriceSeries.mockResolvedValue({
      benchmark: "SPY",
      period: "1M",
      series: [
        { date: "2026-11-01", price: "100", dailyReturn: "0.01" },
        { date: "2026-11-02", price: "102", dailyReturn: "0.02" },
        { date: "2026-11-03", price: "100", dailyReturn: "-0.01" },
      ],
    });

    const result = await getBenchmarkComparison(portfolioId, {
      symbol: "SPY",
      period: "1M",
      riskFreeRate: 0.02,
    });

    expect(result.summary.beta).toBe("2.00");
    expect(result.summary.correlation).toBe("1.00");
  });

  test("returns null for beta, alpha, and correlation if benchmark has zero variance", async () => {
    getPortfolioReturnSeries.mockResolvedValue({
      portfolioId,
      period: "1M",
      series: [
        { date: "2026-11-01", totalValue: "10000", dailyReturn: "0.01" },
        { date: "2026-11-02", totalValue: "10200", dailyReturn: "0.02" },
      ],
    });

    // Benchmark flat at 100 with 0 return each day (zero variance)
    getBenchmarkPriceSeries.mockResolvedValue({
      benchmark: "SPY",
      period: "1M",
      series: [
        { date: "2026-11-01", price: "100", dailyReturn: "0" },
        { date: "2026-11-02", price: "100", dailyReturn: "0" },
      ],
    });

    const result = await getBenchmarkComparison(portfolioId, {
      symbol: "SPY",
      period: "1M",
    });

    expect(result.summary.beta).toBeNull();
    expect(result.summary.alpha).toBeNull();
    expect(result.summary.correlation).toBeNull();
  });

  test("first observation with no prior return is represented as null and excluded from statistics", async () => {
    getPortfolioReturnSeries.mockResolvedValue({
      portfolioId,
      period: "1M",
      series: [
        { date: "2026-11-01", totalValue: "10000", dailyReturn: null }, // no prior close for portfolio
        { date: "2026-11-02", totalValue: "10400", dailyReturn: "0.04" },
        { date: "2026-11-03", totalValue: "10200", dailyReturn: "-0.02" },
      ],
    });

    getBenchmarkPriceSeries.mockResolvedValue({
      benchmark: "SPY",
      period: "1M",
      series: [
        { date: "2026-11-01", price: "100", dailyReturn: null }, // no prior close for benchmark
        { date: "2026-11-02", price: "102", dailyReturn: "0.02" },
        { date: "2026-11-03", price: "100", dailyReturn: "-0.01" },
      ],
    });

    const result = await getBenchmarkComparison(portfolioId, {
      symbol: "SPY",
      period: "1M",
    });

    // First observation return explicitly null, not "0.0000"
    expect(result.comparison[0].portfolioReturn).toBeNull();
    expect(result.comparison[0].benchmarkReturn).toBeNull();

    // Nov 2 and Nov 3 have valid returns
    expect(result.comparison[1].portfolioReturn).toBe("0.0400");
    expect(result.comparison[1].benchmarkReturn).toBe("0.0200");
    expect(result.comparison[2].portfolioReturn).toBe("-0.0200");
    expect(result.comparison[2].benchmarkReturn).toBe("-0.0100");

    // Statistics calculated over Nov 2 and Nov 3 only (2x slope)
    expect(result.summary.beta).toBe("2.00");
    expect(result.summary.correlation).toBe("1.00");
  });

  test("returns null for beta, alpha, correlation when mutual pairs with both returns defined < 2", async () => {
    // 2 mutual dates, but date 1 has null return on benchmark
    getPortfolioReturnSeries.mockResolvedValue({
      portfolioId,
      period: "1M",
      series: [
        { date: "2026-11-01", totalValue: "10000", dailyReturn: "0.01" },
        { date: "2026-11-02", totalValue: "10200", dailyReturn: "0.02" },
      ],
    });

    getBenchmarkPriceSeries.mockResolvedValue({
      benchmark: "SPY",
      period: "1M",
      series: [
        { date: "2026-11-01", price: "100", dailyReturn: null }, // missing/initial return
        { date: "2026-11-02", price: "102", dailyReturn: "0.02" },
      ],
    });

    const result = await getBenchmarkComparison(portfolioId, {
      symbol: "SPY",
      period: "1M",
    });

    expect(result.comparison).toHaveLength(2);
    expect(result.comparison[0].benchmarkReturn).toBeNull();
    expect(result.comparison[0].portfolioReturn).toBe("0.0100");

    // Only 1 date (Nov 2) has both returns defined -> statistics cannot be computed
    expect(result.summary.beta).toBeNull();
    expect(result.summary.alpha).toBeNull();
    expect(result.summary.correlation).toBeNull();

    // Cumulative return over the 2 dates is still preserved
    expect(result.summary.portfolioReturn).toBe("0.0200");
    expect(result.summary.benchmarkReturn).toBe("0.0200");
  });

  test("excludes observations with gaps where either portfolio or benchmark return is undefined", async () => {
    getPortfolioReturnSeries.mockResolvedValue({
      portfolioId,
      period: "1M",
      series: [
        { date: "2026-11-01", totalValue: "10000", dailyReturn: "0.02" },
        { date: "2026-11-02", totalValue: "10100", dailyReturn: "0.01" },
        { date: "2026-11-03", totalValue: "10300", dailyReturn: null },   // portfolio return gap
        { date: "2026-11-04", totalValue: "10500", dailyReturn: "0.04" },
      ],
    });

    getBenchmarkPriceSeries.mockResolvedValue({
      benchmark: "SPY",
      period: "1M",
      series: [
        { date: "2026-11-01", price: "100", dailyReturn: "0.01" },
        { date: "2026-11-02", price: "101", dailyReturn: null },   // benchmark return gap
        { date: "2026-11-03", price: "102", dailyReturn: "0.01" },
        { date: "2026-11-04", price: "104", dailyReturn: "0.02" },
      ],
    });

    const result = await getBenchmarkComparison(portfolioId, {
      symbol: "SPY",
      period: "1M",
    });

    expect(result.comparison).toHaveLength(4);
    expect(result.comparison[1].benchmarkReturn).toBeNull();
    expect(result.comparison[2].portfolioReturn).toBeNull();

    // Aligned dates with both defined: Nov 1 (P=0.02, B=0.01) and Nov 4 (P=0.04, B=0.02)
    // Beta = 2.00, Correlation = 1.00
    expect(result.summary.beta).toBe("2.00");
    expect(result.summary.correlation).toBe("1.00");
  });
});
