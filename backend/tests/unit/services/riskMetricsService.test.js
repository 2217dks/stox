const { Prisma } = require("@prisma/client");
const {
  extractNumbers,
  calculateMean,
  calculateSampleStdDev,
  calculateVolatility,
  calculateDrawdown,
  calculateSharpeRatio,
  calculatePortfolioRiskMetrics,
} = require("../../../src/services/riskMetricsService");

describe("riskMetricsService - Volatility calculation", () => {
  test("extractNumbers parses numbers, strings, and Prisma.Decimals", () => {
    const mixed = [1, "2.5", new Prisma.Decimal("3.75"), null, undefined, NaN, "invalid"];
    const extracted = extractNumbers(mixed);
    expect(extracted).toEqual([1, 2.5, 3.75]);
  });

  test("calculateMean returns sample mean or null for empty array", () => {
    expect(calculateMean([])).toBeNull();
    expect(calculateMean([10, 20, 30])).toBe(20);
  });

  test("calculateSampleStdDev requires at least 2 observations", () => {
    expect(calculateSampleStdDev([])).toBeNull();
    expect(calculateSampleStdDev([0.05])).toBeNull();
  });

  test("calculateSampleStdDev returns 0 for zero-variance series", () => {
    expect(calculateSampleStdDev([0.02, 0.02, 0.02])).toBe(0);
  });

  test("calculateVolatility returns null if observations < 2", () => {
    expect(calculateVolatility([])).toBeNull();
    expect(calculateVolatility([0.01])).toBeNull();
  });

  test("calculateVolatility returns 0.0000 for zero-variance series", () => {
    expect(calculateVolatility([0.01, 0.01, 0.01])).toBe("0.0000");
  });

  test("calculateVolatility accurately calculates annualized volatility on deterministic data", () => {
    // 5 daily returns: [0.01, -0.02, 0.015, -0.005, 0.03]
    // Hand calculation:
    // mean = 0.006
    // sum squared diff = 0.00147
    // sample variance = 0.00147 / 4 = 0.0003675
    // daily std dev = sqrt(0.0003675) ~= 0.0191702895
    // annualized (F=252) = daily std dev * sqrt(252) ~= 0.3043189 -> "0.3043"
    const returns = [
      new Prisma.Decimal("0.01"),
      new Prisma.Decimal("-0.02"),
      new Prisma.Decimal("0.015"),
      new Prisma.Decimal("-0.005"),
      new Prisma.Decimal("0.03"),
    ];

    const result = calculateVolatility(returns, { annualizationFactor: 252 });
    expect(result).toBe("0.3043");
  });

  describe("Drawdown calculation", () => {
    test("returns nulls for empty or invalid series", () => {
      expect(calculateDrawdown([])).toEqual({
        maxDrawdown: null,
        currentDrawdown: null,
        peakValue: null,
        peakDate: null,
      });
      expect(calculateDrawdown(null)).toEqual({
        maxDrawdown: null,
        currentDrawdown: null,
        peakValue: null,
        peakDate: null,
      });
    });

    test("handles single observation series correctly", () => {
      const series = [
        { date: "2026-11-01", totalValue: new Prisma.Decimal("10000") },
      ];
      const result = calculateDrawdown(series);
      expect(result).toEqual({
        maxDrawdown: "0.0000",
        currentDrawdown: "0.0000",
        peakValue: "10000.00000000",
        peakDate: "2026-11-01",
      });
    });

    test("accurately calculates running peak, max drawdown, and current drawdown", () => {
      const series = [
        { date: "2026-11-01", totalValue: "10000" },
        { date: "2026-11-02", totalValue: "12000" }, // Peak = 12000, DD = 0
        { date: "2026-11-03", totalValue: "9600" },  // DD = (9600 - 12000)/12000 = -0.2000
        { date: "2026-11-04", totalValue: "10800" }, // DD = (10800 - 12000)/12000 = -0.1000
      ];

      const result = calculateDrawdown(series);
      expect(result).toEqual({
        maxDrawdown: "-0.2000",
        currentDrawdown: "-0.1000",
        peakValue: "12000.00000000",
        peakDate: "2026-11-02",
      });
    });

    test("supports series with .value property and Date objects", () => {
      const series = [
        { date: new Date("2026-11-01T00:00:00.000Z"), value: 500 },
        { date: new Date("2026-11-02T00:00:00.000Z"), value: 450 },
      ];
      const result = calculateDrawdown(series);
      expect(result.peakDate).toBe("2026-11-01");
      expect(result.peakValue).toBe("500.00000000");
      expect(result.maxDrawdown).toBe("-0.1000");
      expect(result.currentDrawdown).toBe("-0.1000");
    });
  });

  describe("Sharpe-like ratio calculation", () => {
    test("returns null if observations < 2", () => {
      expect(calculateSharpeRatio([])).toBeNull();
      expect(calculateSharpeRatio([0.01])).toBeNull();
    });

    test("returns null for zero-variance returns (division by zero std dev)", () => {
      expect(calculateSharpeRatio([0.01, 0.01, 0.01])).toBeNull();
    });

    test("accurately calculates Sharpe ratio on deterministic inputs", () => {
      // Returns: [0.001, 0.002, 0.0015, 0.0012, 0.0018]
      // Rf: 0.02
      // Annualized Sharpe expected ~= 54.70
      const returns = [0.001, 0.002, 0.0015, 0.0012, 0.0018];
      const sharpe = calculateSharpeRatio(returns, { riskFreeRate: 0.02, annualizationFactor: 252 });
      expect(sharpe).toBe("54.70");
    });
  });

  describe("calculatePortfolioRiskMetrics aggregation", () => {
    test("handles empty series gracefully", () => {
      const result = calculatePortfolioRiskMetrics([]);
      expect(result).toEqual({
        annualizedVolatility: null,
        maxDrawdown: null,
        currentDrawdown: null,
        peakValue: null,
        peakDate: null,
        sharpeRatio: null,
        observationCount: 0,
      });
    });

    test("handles single observation cleanly (N=1 clean baseline invariant)", () => {
      const series = [
        {
          date: "2026-11-01",
          totalValue: "10000",
          dailyReturn: "0",
        },
      ];
      const result = calculatePortfolioRiskMetrics(series);
      expect(result).toEqual({
        annualizedVolatility: null,
        maxDrawdown: "0.0000",
        currentDrawdown: "0.0000",
        peakValue: "10000.00000000",
        peakDate: "2026-11-01",
        sharpeRatio: null,
        observationCount: 1,
      });
    });

    test("computes full suite of metrics for multi-day series", () => {
      const series = [
        { date: "2026-11-01", totalValue: "10000", dailyReturn: "0.001" },
        { date: "2026-11-02", totalValue: "10020", dailyReturn: "0.002" },
        { date: "2026-11-03", totalValue: "10035", dailyReturn: "0.0015" },
        { date: "2026-11-04", totalValue: "10047", dailyReturn: "0.0012" },
        { date: "2026-11-05", totalValue: "10065", dailyReturn: "0.0018" },
      ];

      const result = calculatePortfolioRiskMetrics(series, { riskFreeRate: 0.02 });
      expect(result.observationCount).toBe(5);
      expect(result.peakValue).toBe("10065.00000000");
      expect(result.peakDate).toBe("2026-11-05");
      expect(result.maxDrawdown).toBe("0.0000");
      expect(result.currentDrawdown).toBe("0.0000");
      expect(result.annualizedVolatility).toBe("0.0065");
      expect(result.sharpeRatio).toBe("54.70");
    });
  });
});
