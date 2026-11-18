const {
  pnlHeatmapQuerySchema,
  benchmarkQuerySchema,
  riskMetricsQuerySchema,
  benchmarkComparisonQuerySchema,
  monthlyPerformanceQuerySchema,
  realizedPnlQuerySchema,
  unrealizedPnlQuerySchema,
  portfolioSnapshotsQuerySchema,
  aggregatePnlQuerySchema,
  portfolioPerformanceQuerySchema,
  portfolioHistoryQuerySchema,
  portfolioAllocationQuerySchema,
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

  describe("monthlyPerformanceQuerySchema", () => {
    test("accepts empty query with undefined defaults", () => {
      const parsed = monthlyPerformanceQuerySchema.parse({});
      expect(parsed).toEqual({
        year: undefined,
        from: undefined,
        to: undefined,
      });
    });

    test("parses year integer", () => {
      const parsed = monthlyPerformanceQuerySchema.parse({ year: "2026" });
      expect(parsed.year).toBe(2026);
    });

    test("parses YYYY-MM month bounds with UTC calendar month semantics", () => {
      const parsed = monthlyPerformanceQuerySchema.parse({
        from: "2026-01",
        to: "2026-01",
      });
      expect(parsed.from).toBeInstanceOf(Date);
      expect(parsed.to).toBeInstanceOf(Date);
      expect(parsed.from.toISOString()).toBe("2026-01-01T00:00:00.000Z");
      expect(parsed.to.toISOString()).toBe("2026-01-31T23:59:59.999Z");
      expect(parsed.from.getTime()).toBeLessThan(parsed.to.getTime());
    });

    test("handles leap-year and non-leap-year February in YYYY-MM format", () => {
      const nonLeap = monthlyPerformanceQuerySchema.parse({ to: "2026-02" });
      expect(nonLeap.to.toISOString()).toBe("2026-02-28T23:59:59.999Z");

      const leap = monthlyPerformanceQuerySchema.parse({ to: "2024-02" });
      expect(leap.to.toISOString()).toBe("2024-02-29T23:59:59.999Z");
    });

    test("accepts standalone from or to in YYYY-MM format", () => {
      const fromOnly = monthlyPerformanceQuerySchema.parse({ from: "2026-05" });
      expect(fromOnly.from.toISOString()).toBe("2026-05-01T00:00:00.000Z");
      expect(fromOnly.to).toBeUndefined();

      const toOnly = monthlyPerformanceQuerySchema.parse({ to: "2026-05" });
      expect(toOnly.to.toISOString()).toBe("2026-05-31T23:59:59.999Z");
      expect(toOnly.from).toBeUndefined();
    });

    test("parses from and to date-only bounds (YYYY-MM-DD)", () => {
      const parsed = monthlyPerformanceQuerySchema.parse({
        from: "2026-01-01",
        to: "2026-06-30",
      });
      expect(parsed.from).toBeInstanceOf(Date);
      expect(parsed.to).toBeInstanceOf(Date);
      expect(parsed.from.toISOString()).toBe("2026-01-01T00:00:00.000Z");
      expect(parsed.to.toISOString()).toBe("2026-06-30T23:59:59.999Z");
      expect(parsed.from.getTime()).toBeLessThan(parsed.to.getTime());

      const singleDay = monthlyPerformanceQuerySchema.parse({
        from: "2026-03-15",
        to: "2026-03-15",
      });
      expect(singleDay.from.getTime()).toBeLessThan(singleDay.to.getTime());
    });

    test("parses ISO datetimes and offset-bearing datetimes", () => {
      const parsed = monthlyPerformanceQuerySchema.parse({
        from: "2026-01-01T10:00:00.000Z",
        to: "2026-06-30T18:00:00.000Z",
      });
      expect(parsed.from.toISOString()).toBe("2026-01-01T10:00:00.000Z");
      expect(parsed.to.toISOString()).toBe("2026-06-30T18:00:00.000Z");

      const offsetParsed = monthlyPerformanceQuerySchema.parse({
        from: "2026-10-10T09:00:00+05:30",
      });
      expect(offsetParsed.from.toISOString()).toBe("2026-10-10T03:30:00.000Z");
    });

    test("rejects invalid month numbers in YYYY-MM format", () => {
      expect(() => monthlyPerformanceQuerySchema.parse({ from: "2026-00" })).toThrow();
      expect(() => monthlyPerformanceQuerySchema.parse({ from: "2026-13" })).toThrow();
      expect(() => monthlyPerformanceQuerySchema.parse({ to: "2026-99" })).toThrow();
    });

    test("rejects impossible calendar dates", () => {
      expect(() => monthlyPerformanceQuerySchema.parse({ from: "2026-02-30" })).toThrow();
      expect(() => monthlyPerformanceQuerySchema.parse({ to: "2026-13-45" })).toThrow();
    });

    test("rejects malformed date strings and timezone-less datetimes", () => {
      expect(() => monthlyPerformanceQuerySchema.parse({ from: "not-a-date" })).toThrow();
      expect(() =>
        monthlyPerformanceQuerySchema.parse({ from: "2026-01-01T12:00:00" }),
      ).toThrow();
    });

    test("rejects reversed ranges with custom issue on 'to'", () => {
      const reversedMonth = monthlyPerformanceQuerySchema.safeParse({
        from: "2026-03",
        to: "2026-01",
      });
      expect(reversedMonth.success).toBe(false);
      expect(reversedMonth.error.issues[0].path).toContain("to");

      const reversedDate = monthlyPerformanceQuerySchema.safeParse({
        from: "2026-01-16",
        to: "2026-01-15",
      });
      expect(reversedDate.success).toBe(false);
      expect(reversedDate.error.issues[0].path).toContain("to");

      const reversedIso = monthlyPerformanceQuerySchema.safeParse({
        from: "2026-06-01T00:00:00Z",
        to: "2026-01-01T00:00:00Z",
      });
      expect(reversedIso.success).toBe(false);
      expect(reversedIso.error.issues[0].path).toContain("to");
    });
  });

  describe("realizedPnlQuerySchema", () => {
    test("allows empty query and defaults period when provided", () => {
      const parsed = realizedPnlQuerySchema.parse({});
      expect(parsed).toEqual({ period: "1M" });

      const withPeriod = realizedPnlQuerySchema.parse({ period: "3m" });
      expect(withPeriod.period).toBe("3M");
    });

    test("accepts valid symbol and date range", () => {
      const parsed = realizedPnlQuerySchema.parse({
        symbol: "aapl",
        from: "2026-01-01T00:00:00Z",
        to: "2026-01-10T00:00:00Z",
      });
      expect(parsed.symbol).toBe("AAPL");
      expect(parsed.from).toBeInstanceOf(Date);
      expect(parsed.to).toBeInstanceOf(Date);
    });

    test("rejects reversed from/to range", () => {
      const result = realizedPnlQuerySchema.safeParse({
        from: "2026-01-15T00:00:00Z",
        to: "2026-01-10T00:00:00Z",
      });
      expect(result.success).toBe(false);
      expect(result.error.issues[0].path).toContain("to");
    });
  });

  describe("unrealizedPnlQuerySchema", () => {
    test("defaults rejectStale and allowStale to false", () => {
      const parsed = unrealizedPnlQuerySchema.parse({});
      expect(parsed).toEqual({
        rejectStale: false,
        allowStale: false,
        maxAgeSeconds: undefined,
      });
    });

    test("parses string booleans and integer maxAgeSeconds", () => {
      const parsed = unrealizedPnlQuerySchema.parse({
        rejectStale: "true",
        allowStale: "1",
        maxAgeSeconds: "120",
      });
      expect(parsed).toEqual({
        rejectStale: true,
        allowStale: true,
        maxAgeSeconds: 120,
      });
    });

    test("rejects invalid maxAgeSeconds", () => {
      expect(() =>
        unrealizedPnlQuerySchema.parse({ maxAgeSeconds: "0" }),
      ).toThrow();
      expect(() =>
        unrealizedPnlQuerySchema.parse({ maxAgeSeconds: "not-a-number" }),
      ).toThrow();
    });
  });

  describe("portfolioSnapshotsQuerySchema", () => {
    test("applies default limit of 100", () => {
      const parsed = portfolioSnapshotsQuerySchema.parse({});
      expect(parsed).toEqual({
        limit: 100,
      });
    });

    test("parses valid date bounds and custom limit", () => {
      const parsed = portfolioSnapshotsQuerySchema.parse({
        from: "2026-10-01",
        to: "2026-11-01",
        limit: "50",
      });
      expect(parsed.limit).toBe(50);
      expect(parsed.from).toBeInstanceOf(Date);
      expect(parsed.to).toBeInstanceOf(Date);
    });

    test("rejects when 'from' is later than 'to'", () => {
      const result = portfolioSnapshotsQuerySchema.safeParse({
        from: "2026-11-05",
        to: "2026-11-01",
      });
      expect(result.success).toBe(false);
      expect(result.error.issues[0].path).toContain("to");
    });

    test("rejects limit greater than 365 or less than 1", () => {
      expect(() =>
        portfolioSnapshotsQuerySchema.parse({ limit: "500" }),
      ).toThrow();
      expect(() =>
        portfolioSnapshotsQuerySchema.parse({ limit: "0" }),
      ).toThrow();
    });
  });

  describe("aggregatePnlQuerySchema", () => {
    test("applies default period 1M and default boolean flags", () => {
      const parsed = aggregatePnlQuerySchema.parse({});
      expect(parsed).toEqual({
        period: "1M",
        rejectStale: false,
        allowStale: false,
        maxAgeSeconds: undefined,
      });
    });

    test("parses full options including symbol, date bounds, and boolean strings", () => {
      const parsed = aggregatePnlQuerySchema.parse({
        period: "3m",
        symbol: "msft",
        from: "2026-08-01",
        to: "2026-11-01",
        rejectStale: "true",
        allowStale: "false",
        maxAgeSeconds: "60",
      });
      expect(parsed.period).toBe("3M");
      expect(parsed.symbol).toBe("MSFT");
      expect(parsed.from).toBeInstanceOf(Date);
      expect(parsed.to).toBeInstanceOf(Date);
      expect(parsed.rejectStale).toBe(true);
      expect(parsed.allowStale).toBe(false);
      expect(parsed.maxAgeSeconds).toBe(60);
    });

    test("rejects reversed from/to date range", () => {
      const result = aggregatePnlQuerySchema.safeParse({
        from: "2026-11-10",
        to: "2026-11-01",
      });
      expect(result.success).toBe(false);
      expect(result.error.issues[0].path).toContain("to");
    });
  });
  describe("portfolioPerformanceQuerySchema", () => {
    test("applies default period 1M when query is empty", () => {
      const parsed = portfolioPerformanceQuerySchema.parse({});
      expect(parsed).toEqual({
        period: "1M",
        year: undefined,
        from: undefined,
        to: undefined,
      });
    });

    test("parses custom date boundaries and normalized period", () => {
      const parsed = portfolioPerformanceQuerySchema.parse({
        period: "1y",
        year: "2026",
        from: "2026-01-01",
        to: "2026-12-31",
      });
      expect(parsed.period).toBe("1Y");
      expect(parsed.year).toBe(2026);
      expect(parsed.from).toBeInstanceOf(Date);
      expect(parsed.to).toBeInstanceOf(Date);
    });

    test("rejects when from is after to", () => {
      const result = portfolioPerformanceQuerySchema.safeParse({
        from: "2026-12-31",
        to: "2026-01-01",
      });
      expect(result.success).toBe(false);
      expect(result.error.issues[0].path).toContain("to");
    });
  });

  describe("portfolioHistoryQuerySchema", () => {
    test("accepts empty query with undefined date bounds", () => {
      const parsed = portfolioHistoryQuerySchema.parse({});
      expect(parsed).toEqual({
        from: undefined,
        to: undefined,
      });
    });

    test("parses valid date bounds", () => {
      const parsed = portfolioHistoryQuerySchema.parse({
        from: "2026-10-01",
        to: "2026-11-01",
      });
      expect(parsed.from).toBeInstanceOf(Date);
      expect(parsed.to).toBeInstanceOf(Date);
    });

    test("rejects when from is after to", () => {
      const result = portfolioHistoryQuerySchema.safeParse({
        from: "2026-11-05",
        to: "2026-11-01",
      });
      expect(result.success).toBe(false);
      expect(result.error.issues[0].path).toContain("to");
    });
  });

  describe("portfolioAllocationQuerySchema", () => {
    test("defaults dimension to symbol", () => {
      const parsed = portfolioAllocationQuerySchema.parse({});
      expect(parsed.dimension).toBe("symbol");
    });

    test("normalizes uppercase and trims dimension", () => {
      const parsed = portfolioAllocationQuerySchema.parse({
        dimension: " ASSET ",
      });
      expect(parsed.dimension).toBe("asset");
    });

    test("rejects unsupported dimension", () => {
      expect(() =>
        portfolioAllocationQuerySchema.parse({ dimension: "sector" }),
      ).toThrow();
    });
  });
});

