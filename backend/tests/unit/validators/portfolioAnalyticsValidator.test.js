const {
  pnlHeatmapQuerySchema,
  benchmarkQuerySchema,
  riskMetricsQuerySchema,
  benchmarkComparisonQuerySchema,
} = require("../../../src/validators/portfolioValidator");

describe("Portfolio Analytics Validators Unit Tests", () => {
  describe("pnlHeatmapQuerySchema", () => {
    test("applies defaults when query is empty", () => {
      const parsed = pnlHeatmapQuerySchema.parse({});
      expect(parsed).toEqual({
        period: "1M",
        year: undefined,
      });
    });

    test("normalizes lowercase period and parses year", () => {
      const parsed = pnlHeatmapQuerySchema.parse({
        period: "1y",
        year: "2026",
      });
      expect(parsed).toEqual({
        period: "1Y",
        year: 2026,
      });
    });

    test("rejects invalid period", () => {
      expect(() => pnlHeatmapQuerySchema.parse({ period: "INVALID" })).toThrow();
    });

    test("rejects non-numeric year", () => {
      expect(() => pnlHeatmapQuerySchema.parse({ year: "not-a-year" })).toThrow();
    });
  });

  describe("benchmarkQuerySchema", () => {
    test("applies default SPY and 1M period", () => {
      const parsed = benchmarkQuerySchema.parse({});
      expect(parsed).toEqual({
        symbol: "SPY",
        period: "1M",
      });
    });

    test("normalizes symbol casing and trims whitespace", () => {
      const parsed = benchmarkQuerySchema.parse({
        symbol: " qqq ",
        period: "3m",
      });
      expect(parsed).toEqual({
        symbol: "QQQ",
        period: "3M",
      });
    });

    test("rejects invalid symbol format", () => {
      expect(() => benchmarkQuerySchema.parse({ symbol: "BAD SYMBOL!" })).toThrow();
    });
  });

  describe("riskMetricsQuerySchema", () => {
    test("applies default riskFreeRate 0.02 and period 1M", () => {
      const parsed = riskMetricsQuerySchema.parse({});
      expect(parsed).toEqual({
        period: "1M",
        riskFreeRate: 0.02,
      });
    });

    test("parses numeric string for riskFreeRate", () => {
      const parsed = riskMetricsQuerySchema.parse({
        riskFreeRate: "0.045",
      });
      expect(parsed.riskFreeRate).toBe(0.045);
    });

    test("rejects negative riskFreeRate or values greater than 1.0", () => {
      expect(() => riskMetricsQuerySchema.parse({ riskFreeRate: "-0.01" })).toThrow();
      expect(() => riskMetricsQuerySchema.parse({ riskFreeRate: "1.5" })).toThrow();
    });
  });

  describe("benchmarkComparisonQuerySchema", () => {
    test("parses valid combination of inputs", () => {
      const parsed = benchmarkComparisonQuerySchema.parse({
        symbol: "DIA",
        period: "6M",
        riskFreeRate: "0.03",
      });
      expect(parsed).toEqual({
        symbol: "DIA",
        period: "6M",
        riskFreeRate: 0.03,
      });
    });
  });
});

