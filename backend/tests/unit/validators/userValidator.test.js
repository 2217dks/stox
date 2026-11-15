const {
  publicUserParamsSchema,
  tradeStatisticsQuerySchema,
} = require("../../../src/validators/userValidator");

describe("userValidator schemas", () => {
  describe("publicUserParamsSchema", () => {
    test("accepts valid uuid", () => {
      const result = publicUserParamsSchema.safeParse({
        id: "8b2c1a4e-3f2d-4c5b-9a8e-7d6c5b4a3f2e",
      });
      expect(result.success).toBe(true);
    });

    test("rejects non-uuid id", () => {
      const result = publicUserParamsSchema.safeParse({ id: "12345" });
      expect(result.success).toBe(false);
      expect(result.error.issues[0].message).toBe("Invalid user ID.");
    });
  });

  describe("tradeStatisticsQuerySchema", () => {
    const validUuid = "8b2c1a4e-3f2d-4c5b-9a8e-7d6c5b4a3f2e";

    test("accepts empty query", () => {
      const result = tradeStatisticsQuerySchema.safeParse({});
      expect(result.success).toBe(true);
    });

    test("accepts valid portfolioId and normalizes symbol to uppercase", () => {
      const result = tradeStatisticsQuerySchema.safeParse({
        portfolioId: validUuid,
        symbol: "aapl",
        side: "BUY",
        includeMonthly: "true",
      });

      expect(result.success).toBe(true);
      expect(result.data.portfolioId).toBe(validUuid);
      expect(result.data.symbol).toBe("AAPL");
      expect(result.data.side).toBe("BUY");
      expect(result.data.includeMonthly).toBe(true);
    });

    test("rejects invalid portfolioId", () => {
      const result = tradeStatisticsQuerySchema.safeParse({
        portfolioId: "not-a-uuid",
      });
      expect(result.success).toBe(false);
      expect(result.error.issues[0].message).toBe("Invalid portfolio ID.");
    });

    test("rejects invalid side", () => {
      const result = tradeStatisticsQuerySchema.safeParse({
        side: "HOLD",
      });
      expect(result.success).toBe(false);
    });

    test("accepts valid date range and coerces correctly", () => {
      const result = tradeStatisticsQuerySchema.safeParse({
        from: "2026-01-01",
        to: "2026-01-15",
      });

      expect(result.success).toBe(true);
      expect(result.data.from).toBeInstanceOf(Date);
      expect(result.data.to).toBeInstanceOf(Date);
      expect(result.data.from.getTime()).toBeLessThan(result.data.to.getTime());
    });

    test("rejects when 'from' is later than 'to'", () => {
      const result = tradeStatisticsQuerySchema.safeParse({
        from: "2026-01-15T00:00:00Z",
        to: "2026-01-01T00:00:00Z",
      });

      expect(result.success).toBe(false);
      const toIssue = result.error.issues.find((i) => i.path.includes("to"));
      expect(toIssue).toBeDefined();
      expect(toIssue.message).toBe("'to' must be later than 'from'.");
    });

    test("rejects when ISO 'from' equals 'to'", () => {
      const result = tradeStatisticsQuerySchema.safeParse({
        from: "2026-01-15T10:00:00Z",
        to: "2026-01-15T10:00:00Z",
      });

      expect(result.success).toBe(false);
      const toIssue = result.error.issues.find((i) => i.path.includes("to"));
      expect(toIssue).toBeDefined();
      expect(toIssue.message).toBe("'to' must be later than 'from'.");
    });
  });
});
