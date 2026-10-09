const {
  createOrderSchema,
  createMarketOrderSchema,
  listOrdersQuerySchema,
  orderIdParamSchema,
} = require("../../../src/validators/orderValidator");

// Black-box tests at the module boundary (the exported schemas are the public
// interface). Contract invariants (docs/API.md + docs/phase-1-api-contract-review.md):
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

function expectIssueAtPrefix(result, pathPrefix) {
  expect(result.success).toBe(false);
  expect(issuesOf(result).some((path) => path.startsWith(pathPrefix))).toBe(
    true,
  );
}

function expectValid(result) {
  expect(result.success).toBe(true);
}

describe("orderValidator schemas (black-box)", () => {
  // ==========================================================
  // createOrderSchema — shared field rules
  // ==========================================================

  const marketBase = () => ({
    portfolioId: "8b2c1a4e-3f2d-4c5b-9a8e-7d6c5b4a3f2e",
    symbol: "AAPL",
    assetType: "STOCK",
    side: "BUY",
    quantity: "1.5",
  });

  describe("createOrderSchema: portfolioId", () => {
    test("accepts a valid uuid", () => {
      expectValid(createOrderSchema.safeParse(marketBase()));
    });

    const invalid = [
      { case: "missing", body: { ...marketBase(), portfolioId: undefined } },
      { case: "not a uuid", body: { ...marketBase(), portfolioId: "not-a-uuid" } },
      { case: "number", body: { ...marketBase(), portfolioId: 123 } },
      { case: "empty string", body: { ...marketBase(), portfolioId: "" } },
    ];

    for (const { case: label, body } of invalid) {
      test(`rejects ${label}`, () => {
        expectIssueAt(createOrderSchema.safeParse(body), "portfolioId");
      });
    }
  });

  describe("createOrderSchema: symbol", () => {
    test("accepts alphanumeric symbols (crypto tickers)", () => {
      const result = createOrderSchema.safeParse({
        ...marketBase(),
        assetType: "CRYPTO",
        symbol: "BTCUSDT",
      });

      expectValid(result);
      expect(result.data.symbol).toBe("BTCUSDT");
    });

    test("trims surrounding whitespace", () => {
      const result = createOrderSchema.safeParse({
        ...marketBase(),
        symbol: "  AAPL  ",
      });

      expectValid(result);
      expect(result.data.symbol).toBe("AAPL");
    });

    test("normalizes to uppercase", () => {
      const result = createOrderSchema.safeParse({
        ...marketBase(),
        symbol: "aapl",
      });

      expectValid(result);
      expect(result.data.symbol).toBe("AAPL");
    });

    test("rejects whitespace-only symbol", () => {
      expectIssueAt(
        createOrderSchema.safeParse({ ...marketBase(), symbol: "   " }),
        "symbol",
      );
    });

    test("rejects empty symbol", () => {
      expectIssueAt(
        createOrderSchema.safeParse({ ...marketBase(), symbol: "" }),
        "symbol",
      );
    });

    test("accepts symbol at max length (20)", () => {
      expectValid(
        createOrderSchema.safeParse({ ...marketBase(), symbol: "A".repeat(20) }),
      );
    });

    test("rejects symbol over max length (21)", () => {
      expectIssueAt(
        createOrderSchema.safeParse({ ...marketBase(), symbol: "A".repeat(21) }),
        "symbol",
      );
    });

    const wrongTypes = [123, null, [], {}, true];

    for (const symbol of wrongTypes) {
      test(`rejects wrong-type symbol (${JSON.stringify(symbol)})`, () => {
        expectIssueAt(
          createOrderSchema.safeParse({ ...marketBase(), symbol }),
          "symbol",
        );
      });
    }
  });

  describe("createOrderSchema: assetType and side", () => {
    test("accepts every documented enum value", () => {
      for (const assetType of ["STOCK", "CRYPTO", "FOREX"]) {
        expectValid(
          createOrderSchema.safeParse({ ...marketBase(), assetType }),
        );
      }

      for (const side of ["BUY", "SELL"]) {
        expectValid(createOrderSchema.safeParse({ ...marketBase(), side }));
      }
    });

    test("rejects invalid assetType", () => {
      expectIssueAt(
        createOrderSchema.safeParse({ ...marketBase(), assetType: "BONDS" }),
        "assetType",
      );
    });

    test("rejects invalid side", () => {
      expectIssueAt(
        createOrderSchema.safeParse({ ...marketBase(), side: "HOLD" }),
        "side",
      );
    });

    test("enum matching is exact (no case folding)", () => {
      expectIssueAt(
        createOrderSchema.safeParse({ ...marketBase(), side: "buy" }),
        "side",
      );
      expectIssueAt(
        createOrderSchema.safeParse({ ...marketBase(), assetType: "stock" }),
        "assetType",
      );
    });
  });

  describe("createOrderSchema: quantity", () => {
    test("accepts numeric strings with up to 8 decimal places", () => {
      for (const quantity of ["1", "1.5", "0.00000001", "1.12345678"]) {
        expectValid(
          createOrderSchema.safeParse({ ...marketBase(), quantity }),
        );
      }
    });

    test("accepts number-typed quantity and returns it as string", () => {
      const result = createOrderSchema.safeParse({
        ...marketBase(),
        quantity: 2,
      });

      expectValid(result);
      expect(result.data.quantity).toBe("2");
    });

    test("accepts quantity with surrounding whitespace", () => {
      const result = createOrderSchema.safeParse({
        ...marketBase(),
        quantity: "  2.5  ",
      });

      expectValid(result);
      expect(result.data.quantity).toBe("2.5");
    });

    test("accepts leading-zero quantity", () => {
      expectValid(
        createOrderSchema.safeParse({ ...marketBase(), quantity: "007.5" }),
      );
    });

    test("accepts the maximum representable value (10 integer digits, Decimal(18,8))", () => {
      expectValid(
        createOrderSchema.safeParse({
          ...marketBase(),
          quantity: "9999999999.99999999",
        }),
      );
    });

    const invalid = [
      { case: "missing", quantity: undefined },
      { case: "zero string", quantity: "0" },
      { case: "zero decimal", quantity: "0.00000000" },
      { case: "zero number", quantity: 0 },
      { case: "negative string", quantity: "-1" },
      { case: "negative tiny", quantity: "-0.00000001" },
      { case: "nine decimal places", quantity: "1.123456789" },
      { case: "non-numeric", quantity: "abc" },
      { case: "empty string", quantity: "" },
      { case: "whitespace-only", quantity: "   " },
      { case: "boolean", quantity: true },
      { case: "null", quantity: null },
      { case: "array", quantity: [] },
      { case: "object", quantity: {} },
      { case: "exponent notation", quantity: 1e-8 },
      { case: "eleven integer digits (overflows Decimal(18,8))", quantity: "12345678901" },
      { case: "eleven integer digits numeric", quantity: 12345678901 },
    ];

    for (const { case: label, quantity } of invalid) {
      test(`rejects ${label}`, () => {
        expectIssueAt(
          createOrderSchema.safeParse({ ...marketBase(), quantity }),
          "quantity",
        );
      });
    }
  });

  describe("createOrderSchema: unknown fields are stripped", () => {
    test("client cannot inject status, source, or executed state", () => {
      const result = createOrderSchema.safeParse({
        ...marketBase(),
        status: "EXECUTED",
        source: "ADMIN_OVERRIDE",
        executedPrice: "1",
        id: "forged-id",
      });

      expectValid(result);
      expect(result.data).not.toHaveProperty("status");
      expect(result.data).not.toHaveProperty("source");
      expect(result.data).not.toHaveProperty("executedPrice");
      expect(result.data).not.toHaveProperty("id");
    });
  });

  // ==========================================================
  // createOrderSchema — type-conditional pricing rules
  // ==========================================================

  describe("createOrderSchema: type-conditional pricing", () => {
    test("type is optional and defaults to MARKET", () => {
      const result = createOrderSchema.safeParse(marketBase());

      expectValid(result);
      expect(result.data.type).toBe("MARKET");
    });

    test("explicit MARKET is accepted", () => {
      expectValid(
        createOrderSchema.safeParse({ ...marketBase(), type: "MARKET" }),
      );
    });

    test("rejects invalid type", () => {
      expectIssueAt(
        createOrderSchema.safeParse({ ...marketBase(), type: "ICEBERG" }),
        "type",
      );
    });

    test("rejects lowercase type (no case folding on enums)", () => {
      expectIssueAt(
        createOrderSchema.safeParse({ ...marketBase(), type: "limit" }),
        "type",
      );
    });

    test("MARKET forbids limitPrice", () => {
      expectIssueAt(
        createOrderSchema.safeParse({
          ...marketBase(),
          type: "MARKET",
          limitPrice: "250",
        }),
        "limitPrice",
      );
    });

    test("MARKET forbids stopPrice", () => {
      expectIssueAt(
        createOrderSchema.safeParse({
          ...marketBase(),
          type: "MARKET",
          stopPrice: "240",
        }),
        "stopPrice",
      );
    });

    test("LIMIT requires limitPrice", () => {
      expectIssueAt(
        createOrderSchema.safeParse({ ...marketBase(), type: "LIMIT" }),
        "limitPrice",
      );
    });

    test("LIMIT forbids stopPrice", () => {
      expectIssueAt(
        createOrderSchema.safeParse({
          ...marketBase(),
          type: "LIMIT",
          limitPrice: "250",
          stopPrice: "240",
        }),
        "stopPrice",
      );
    });

    test("STOP_LOSS requires stopPrice", () => {
      expectIssueAt(
        createOrderSchema.safeParse({ ...marketBase(), type: "STOP_LOSS" }),
        "stopPrice",
      );
    });

    test("STOP_LOSS forbids limitPrice", () => {
      expectIssueAt(
        createOrderSchema.safeParse({
          ...marketBase(),
          type: "STOP_LOSS",
          stopPrice: "240",
          limitPrice: "250",
        }),
        "limitPrice",
      );
    });

    test("TAKE_PROFIT requires stopPrice", () => {
      expectIssueAt(
        createOrderSchema.safeParse({ ...marketBase(), type: "TAKE_PROFIT" }),
        "stopPrice",
      );
    });

    test("valid LIMIT order round-trips limitPrice as string", () => {
      const result = createOrderSchema.safeParse({
        ...marketBase(),
        type: "LIMIT",
        limitPrice: 250.5,
      });

      expectValid(result);
      expect(result.data.limitPrice).toBe("250.5");
    });

    test("valid STOP_LOSS order round-trips stopPrice as string", () => {
      const result = createOrderSchema.safeParse({
        ...marketBase(),
        type: "STOP_LOSS",
        stopPrice: "240.12345678",
      });

      expectValid(result);
      expect(result.data.stopPrice).toBe("240.12345678");
    });
  });

  describe("pricing fields (shared rules for limitPrice and stopPrice)", () => {
    const limitBase = () => ({
      ...marketBase(),
      type: "LIMIT",
      limitPrice: "250",
    });

    test("accepts number-typed price and returns it as string", () => {
      const result = createOrderSchema.safeParse({
        ...limitBase(),
        limitPrice: 250,
      });

      expectValid(result);
      expect(result.data.limitPrice).toBe("250");
    });

    test("accepts price with up to 8 decimal places", () => {
      expectValid(
        createOrderSchema.safeParse({ ...limitBase(), limitPrice: "1.12345678" }),
      );
    });

    const invalid = [
      { case: "zero", price: "0" },
      { case: "negative", price: "-250" },
      { case: "nine decimal places", price: "1.123456789" },
      { case: "non-numeric", price: "abc" },
      { case: "empty string", price: "" },
      { case: "null", price: null },
      { case: "boolean", price: true },
      { case: "eleven integer digits", price: "12345678901.5" },
    ];

    for (const { case: label, price } of invalid) {
      test(`rejects limitPrice: ${label}`, () => {
        expectIssueAt(
          createOrderSchema.safeParse({ ...limitBase(), limitPrice: price }),
          "limitPrice",
        );
      });
    }

    test("rejects stopPrice below zero-rule via STOP_LOSS", () => {
      expectIssueAt(
        createOrderSchema.safeParse({
          ...marketBase(),
          type: "STOP_LOSS",
          stopPrice: "-1",
        }),
        "stopPrice",
      );
    });
  });

  // ==========================================================
  // Back-compat alias
  // ==========================================================

  describe("createMarketOrderSchema (legacy export)", () => {
    test("still validates a basic market order", () => {
      expectValid(createMarketOrderSchema.safeParse(marketBase()));
    });
  });

  // ==========================================================
  // listOrdersQuerySchema
  // ==========================================================

  describe("listOrdersQuerySchema: defaults", () => {
    test("empty query yields page 1 and limit 20", () => {
      const result = listOrdersQuerySchema.safeParse({});

      expectValid(result);
      expect(result.data.page).toBe(1);
      expect(result.data.limit).toBe(20);
    });

    test("no filter fields are required", () => {
      expectValid(listOrdersQuerySchema.safeParse({}));
    });
  });

  describe("listOrdersQuerySchema: pagination", () => {
    test("accepts numeric-string page and limit (query params are strings)", () => {
      const result = listOrdersQuerySchema.safeParse({
        page: "3",
        limit: "50",
      });

      expectValid(result);
      expect(result.data.page).toBe(3);
      expect(result.data.limit).toBe(50);
    });

    const invalid = [
      { case: "page zero", query: { page: "0" } },
      { case: "page negative", query: { page: "-1" } },
      { case: "page non-integer", query: { page: "1.5" } },
      { case: "page non-numeric", query: { page: "abc" } },
      { case: "limit zero", query: { limit: "0" } },
      { case: "limit over max (101)", query: { limit: "101" } },
      { case: "limit non-numeric", query: { limit: "many" } },
    ];

    for (const { case: label, query } of invalid) {
      test(`rejects ${label}`, () => {
        expectIssueAt(listOrdersQuerySchema.safeParse(query), Object.keys(query)[0]);
      });
    }

    test("accepts limit at boundary (100)", () => {
      expectValid(listOrdersQuerySchema.safeParse({ limit: "100" }));
    });
  });

  describe("listOrdersQuerySchema: status filter", () => {
    test("accepts a single status", () => {
      const result = listOrdersQuerySchema.safeParse({ status: "PENDING" });

      expectValid(result);
      expect(result.data.status).toEqual(["PENDING"]);
    });

    test("accepts comma-separated multiple statuses", () => {
      const result = listOrdersQuerySchema.safeParse({
        status: "EXECUTED,CANCELLED",
      });

      expectValid(result);
      expect(result.data.status).toEqual(["EXECUTED", "CANCELLED"]);
    });

    test("tolerates whitespace around segments", () => {
      const result = listOrdersQuerySchema.safeParse({
        status: " PENDING , EXECUTED ",
      });

      expectValid(result);
      expect(result.data.status).toEqual(["PENDING", "EXECUTED"]);
    });

    test("normalizes case to uppercase", () => {
      const result = listOrdersQuerySchema.safeParse({ status: "pending" });

      expectValid(result);
      expect(result.data.status).toEqual(["PENDING"]);
    });

    test("deduplicates repeated statuses", () => {
      const result = listOrdersQuerySchema.safeParse({
        status: "PENDING,PENDING",
      });

      expectValid(result);
      expect(result.data.status).toEqual(["PENDING"]);
    });

    test("accepts every documented status value", () => {
      const result = listOrdersQuerySchema.safeParse({
        status: "PENDING,EXECUTED,CANCELLED,EXPIRED,REJECTED",
      });

      expectValid(result);
      expect(result.data.status).toHaveLength(5);
    });

    test("rejects unknown status", () => {
      expectIssueAtPrefix(
        listOrdersQuerySchema.safeParse({ status: "FILLED" }),
        "status",
      );
    });

    test("rejects empty segment (trailing comma)", () => {
      expectIssueAtPrefix(
        listOrdersQuerySchema.safeParse({ status: "PENDING," }),
        "status",
      );
    });

    test("rejects empty string status", () => {
      expectIssueAtPrefix(
        listOrdersQuerySchema.safeParse({ status: "" }),
        "status",
      );
    });
  });

  describe("listOrdersQuerySchema: scalar filters", () => {
    test("accepts symbol with normalization", () => {
      const result = listOrdersQuerySchema.safeParse({ symbol: " aapl " });

      expectValid(result);
      expect(result.data.symbol).toBe("AAPL");
    });

    test("rejects symbol over max length", () => {
      expectIssueAt(
        listOrdersQuerySchema.safeParse({ symbol: "A".repeat(21) }),
        "symbol",
      );
    });

    test("accepts valid side and type", () => {
      const result = listOrdersQuerySchema.safeParse({
        side: "BUY",
        type: "LIMIT",
      });

      expectValid(result);
    });

    test("rejects invalid side", () => {
      expectIssueAt(
        listOrdersQuerySchema.safeParse({ side: "HOLD" }),
        "side",
      );
    });

    test("rejects invalid type", () => {
      expectIssueAt(
        listOrdersQuerySchema.safeParse({ type: "ICEBERG" }),
        "type",
      );
    });

    test("accepts valid portfolioId", () => {
      expectValid(
        listOrdersQuerySchema.safeParse({
          portfolioId: "8b2c1a4e-3f2d-4c5b-9a8e-7d6c5b4a3f2e",
        }),
      );
    });

    test("rejects invalid portfolioId", () => {
      expectIssueAt(
        listOrdersQuerySchema.safeParse({ portfolioId: "not-a-uuid" }),
        "portfolioId",
      );
    });
  });

  describe("listOrdersQuerySchema: date range", () => {
    test("accepts date-only strings", () => {
      const result = listOrdersQuerySchema.safeParse({
        from: "2026-10-01",
        to: "2026-10-09",
      });

      expectValid(result);
    });

    test("date-only from is normalized to midnight of that day (UTC, inclusive)", () => {
      const result = listOrdersQuerySchema.safeParse({ from: "2026-10-01" });

      expectValid(result);
      expect(result.data.from.toISOString()).toBe(
        "2026-10-01T00:00:00.000Z",
      );
    });

    test("date-only to is normalized to midnight of the following day (UTC, exclusive)", () => {
      const result = listOrdersQuerySchema.safeParse({ to: "2026-10-09" });

      expectValid(result);
      expect(result.data.to.toISOString()).toBe("2026-10-10T00:00:00.000Z");
    });

    test("equal date-only bounds form a valid single-day window", () => {
      const result = listOrdersQuerySchema.safeParse({
        from: "2026-10-09",
        to: "2026-10-09",
      });

      expectValid(result);
    });

    // End-of-month bounds: the +1 day shift crosses into the next
    // month/year, which must not trip the impossible-date guard.
    test("date-only to on the last day of a month is accepted", () => {
      const monthEnd = listOrdersQuerySchema.safeParse({ to: "2026-10-31" });
      const yearEnd = listOrdersQuerySchema.safeParse({ to: "2026-12-31" });

      expectValid(monthEnd);
      expect(monthEnd.data.to.toISOString()).toBe("2026-11-01T00:00:00.000Z");

      expectValid(yearEnd);
      expect(yearEnd.data.to.toISOString()).toBe("2027-01-01T00:00:00.000Z");
    });

    test("date-only to on a leap day is accepted", () => {
      const result = listOrdersQuerySchema.safeParse({ to: "2024-02-29" });

      expectValid(result);
      expect(result.data.to.toISOString()).toBe("2024-03-01T00:00:00.000Z");
    });

    test("impossible calendar dates are rejected, not normalized", () => {
      expectIssueAt(
        listOrdersQuerySchema.safeParse({ from: "2026-02-30" }),
        "from",
      );
      expectIssueAt(
        listOrdersQuerySchema.safeParse({ to: "2026-13-45" }),
        "to",
      );
    });

    test("full ISO datetimes pass through without normalization", () => {
      const result = listOrdersQuerySchema.safeParse({
        from: "2026-10-01T10:00:00.000Z",
        to: "2026-10-09T18:30:00.000Z",
      });

      expectValid(result);
      expect(result.data.from.toISOString()).toBe("2026-10-01T10:00:00.000Z");
      expect(result.data.to.toISOString()).toBe("2026-10-09T18:30:00.000Z");
    });

    test("offset-bearing datetimes normalize to their UTC instant", () => {
      const result = listOrdersQuerySchema.safeParse({
        from: "2026-10-10T09:00:00+05:30",
      });

      expectValid(result);
      expect(result.data.from.toISOString()).toBe("2026-10-10T03:30:00.000Z");
    });

    test("timezone-less datetimes are rejected (offset required)", () => {
      expectIssueAt(
        listOrdersQuerySchema.safeParse({ from: "2026-10-10T09:00:00" }),
        "from",
      );
      expectIssueAt(
        listOrdersQuerySchema.safeParse({ to: "2026-10-10T18:00:00.000" }),
        "to",
      );
    });

    test("accepts full ISO datetimes", () => {
      const result = listOrdersQuerySchema.safeParse({
        from: "2026-10-01T10:00:00.000Z",
        to: "2026-10-09T18:30:00.000Z",
      });

      expectValid(result);
    });

    test("accepts from without to and to without from", () => {
      expectValid(listOrdersQuerySchema.safeParse({ from: "2026-10-01" }));
      expectValid(listOrdersQuerySchema.safeParse({ to: "2026-10-09" }));
    });

    test("rejects from after to (issue reported on 'to')", () => {
      expectIssueAt(
        listOrdersQuerySchema.safeParse({
          from: "2026-10-09",
          to: "2026-10-01",
        }),
        "to",
      );
    });

    test("rejects invalid date strings", () => {
      expectIssueAt(
        listOrdersQuerySchema.safeParse({ from: "not-a-date" }),
        "from",
      );
      expectIssueAt(
        listOrdersQuerySchema.safeParse({ to: "2026-13-45" }),
        "to",
      );
    });
  });

  describe("listOrdersQuerySchema: unknown query keys", () => {
    test("unknown params are stripped, not rejected", () => {
      const result = listOrdersQuerySchema.safeParse({
        page: "1",
        admin: "true",
        userId: "forged",
      });

      expectValid(result);
      expect(result.data).not.toHaveProperty("admin");
      expect(result.data).not.toHaveProperty("userId");
    });
  });

  // ==========================================================
  // orderIdParamSchema
  // ==========================================================

  describe("orderIdParamSchema", () => {
    test("accepts a valid uuid under 'id'", () => {
      const result = orderIdParamSchema.safeParse({
        id: "8b2c1a4e-3f2d-4c5b-9a8e-7d6c5b4a3f2e",
      });

      expectValid(result);
    });

    const invalid = [
      { case: "missing id", params: {} },
      { case: "not a uuid", params: { id: "not-a-uuid" } },
      { case: "number", params: { id: 123 } },
      { case: "empty string", params: { id: "" } },
    ];

    for (const { case: label, params } of invalid) {
      test(`rejects ${label}`, () => {
        expectIssueAt(orderIdParamSchema.safeParse(params), "id");
      });
    }
  });

  // Sanity: quantity and price rules must not drift apart — a change to one
  // decimal rule should fail loudly here rather than silently at the DB layer.
  describe("decimal string contract", () => {
    test("quantity and prices use the same decimal rules", () => {
      const probe = createOrderSchema.safeParse({
        ...marketBase(),
        type: "LIMIT",
        quantity: "1.123456789", // 9 dp — must fail
        limitPrice: "250",
      });

      expectIssueAt(probe, "quantity");
    });
  });
});
