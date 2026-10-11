const { listTradesQuerySchema, tradeIdParamSchema } = require(
  "../../../src/validators/tradeValidator",
);

// Black-box tests at the module boundary (the exported schemas are the
// public interface). Contract invariants mirror the order validator:
// - valid input  -> success: true, transformed data
// - invalid input-> success: false, issues carry a path and a message
// - exact messages are NOT asserted (copy may change; contract may not).
function issuesOf(result) {
  return result.error.issues.map((issue) => issue.path.join("."));
}

function expectIssueAt(result, path) {
  expect(result.success).toBe(false);
  expect(issuesOf(result)).toContain(path);
}

function expectValid(result) {
  expect(result.success).toBe(true);
}

const uuid = "8b2c1a4e-3f2d-4c5b-9a8e-7d6c5b4a3f2e";

describe("tradeValidator schemas (black-box)", () => {
  describe("listTradesQuerySchema: pagination defaults and bounds", () => {
    test("empty query defaults to page 1, limit 20", () => {
      const result = listTradesQuerySchema.safeParse({});

      expectValid(result);
      expect(result.data.page).toBe(1);
      expect(result.data.limit).toBe(20);
    });

    test("coerces numeric strings", () => {
      const result = listTradesQuerySchema.safeParse({
        page: "3",
        limit: "50",
      });

      expectValid(result);
      expect(result.data.page).toBe(3);
      expect(result.data.limit).toBe(50);
    });

    const invalidPagination = [
      { case: "page below 1", query: { page: "0" }, path: "page" },
      { case: "negative page", query: { page: "-2" }, path: "page" },
      { case: "non-integer page", query: { page: "1.5" }, path: "page" },
      { case: "non-numeric page", query: { page: "abc" }, path: "page" },
      { case: "limit below 1", query: { limit: "0" }, path: "limit" },
      { case: "limit above 100", query: { limit: "101" }, path: "limit" },
    ];

    for (const { case: label, query, path } of invalidPagination) {
      test(`rejects ${label}`, () => {
        expectIssueAt(listTradesQuerySchema.safeParse(query), path);
      });
    }
  });

  describe("listTradesQuerySchema: filters", () => {
    test("normalizes symbol to trimmed uppercase", () => {
      const result = listTradesQuerySchema.safeParse({ symbol: "  aapl " });

      expectValid(result);
      expect(result.data.symbol).toBe("AAPL");
    });

    test("rejects an empty symbol", () => {
      expectIssueAt(
        listTradesQuerySchema.safeParse({ symbol: "   " }),
        "symbol",
      );
    });

    test("accepts BUY and SELL sides", () => {
      expectValid(listTradesQuerySchema.safeParse({ side: "BUY" }));
      expectValid(listTradesQuerySchema.safeParse({ side: "SELL" }));
    });

    test("rejects sides outside the enum", () => {
      expectIssueAt(
        listTradesQuerySchema.safeParse({ side: "HOLD" }),
        "side",
      );
    });

    test("accepts a valid portfolioId uuid", () => {
      expectValid(listTradesQuerySchema.safeParse({ portfolioId: uuid }));
    });

    const invalidPortfolioIds = ["not-a-uuid", "", 123];

    for (const portfolioId of invalidPortfolioIds) {
      test(`rejects portfolioId ${JSON.stringify(portfolioId)}`, () => {
        expectIssueAt(
          listTradesQuerySchema.safeParse({ portfolioId }),
          "portfolioId",
        );
      });
    }
  });

  describe("listTradesQuerySchema: date window (UTC, half-open)", () => {
    test("date-only 'from' parses as midnight UTC", () => {
      const result = listTradesQuerySchema.safeParse({ from: "2026-10-01" });

      expectValid(result);
      expect(result.data.from.toISOString()).toBe(
        "2026-10-01T00:00:00.000Z",
      );
    });

    test("date-only 'to' normalizes to midnight of the FOLLOWING day", () => {
      const result = listTradesQuerySchema.safeParse({ to: "2026-10-01" });

      expectValid(result);
      expect(result.data.to.toISOString()).toBe(
        "2026-10-02T00:00:00.000Z",
      );
    });

    test("ISO datetime with explicit UTC offset is used as the exact instant", () => {
      const result = listTradesQuerySchema.safeParse({
        from: "2026-10-01T10:00:00Z",
      });

      expectValid(result);
      expect(result.data.from.toISOString()).toBe(
        "2026-10-01T10:00:00.000Z",
      );
    });

    const invalidBounds = [
      { case: "datetime without offset", bound: "2026-10-01T10:00:00" },
      { case: "impossible calendar date", bound: "2026-02-30" },
      { case: "free text", bound: "yesterday" },
      { case: "number", bound: 1735689600000 },
    ];

    for (const { case: label, bound } of invalidBounds) {
      test(`rejects ${label}`, () => {
        expectIssueAt(listTradesQuerySchema.safeParse({ from: bound }), "from");
      });
    }

    test("rejects 'to' not later than 'from'", () => {
      expectIssueAt(
        listTradesQuerySchema.safeParse({
          from: "2026-10-05T12:00:00Z",
          to: "2026-10-05T12:00:00Z",
        }),
        "to",
      );
      expectIssueAt(
        listTradesQuerySchema.safeParse({
          from: "2026-10-05T12:00:00Z",
          to: "2026-10-05T11:00:00Z",
        }),
        "to",
      );
      expectIssueAt(
        listTradesQuerySchema.safeParse({ from: "2026-10-05", to: "2026-10-04" }),
        "to",
      );
    });

    test("equal date-only bounds are valid (whole-day window)", () => {
      expectValid(
        listTradesQuerySchema.safeParse({ from: "2026-10-05", to: "2026-10-05" }),
      );
    });
  });

  describe("listTradesQuerySchema: sort/order allowlist", () => {
    test("sort and order are optional", () => {
      expectValid(listTradesQuerySchema.safeParse({}));
    });

    test("accepts allowlisted sort fields with either direction", () => {
      expectValid(
        listTradesQuerySchema.safeParse({ sort: "executedAt", order: "asc" }),
      );
      expectValid(
        listTradesQuerySchema.safeParse({ sort: "totalValue", order: "desc" }),
      );
    });

    test("rejects sort fields outside the allowlist", () => {
      expectIssueAt(listTradesQuerySchema.safeParse({ sort: "price" }), "sort");
      expectIssueAt(
        listTradesQuerySchema.safeParse({ sort: "portfolioId" }),
        "sort",
      );
    });

    test("rejects directions outside asc/desc", () => {
      expectIssueAt(
        listTradesQuerySchema.safeParse({ order: "ASC" }),
        "order",
      );
      expectIssueAt(
        listTradesQuerySchema.safeParse({ order: "newest" }),
        "order",
      );
    });
  });

  describe("tradeIdParamSchema", () => {
    test("accepts a valid uuid", () => {
      expectValid(tradeIdParamSchema.safeParse({ id: uuid }));
    });

    const invalidIds = ["not-a-uuid", "", 123];

    for (const id of invalidIds) {
      test(`rejects ${JSON.stringify(id)}`, () => {
        expectIssueAt(tradeIdParamSchema.safeParse({ id }), "id");
      });
    }
  });
});
