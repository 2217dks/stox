const {
  createCopyTraderSchema,
  updateCopyTraderSchema,
  copyTraderIdParamSchema,
  listCopyTradersQuerySchema,
} = require("../../../src/validators/copyTradingValidator");

const TRADER_ID = "8b2c1a4e-3f2d-4c5b-9a8e-7d6c5b4a3f2e";
const PORTFOLIO_ID = "2d2b6b0d-9e9f-4e4d-a3ce-3a0c2b7e7d20";

function issuesOf(result) {
  return result.error.issues.map((issue) => issue.path.join("."));
}

function expectIssueAt(result, path) {
  expect(result.success).toBe(false);
  expect(issuesOf(result)).toContain(path);
}

describe("copyTradingValidator", () => {
  describe("createCopyTraderSchema", () => {
    test("accepts the minimal body and applies defaults", () => {
      const result = createCopyTraderSchema.safeParse({ traderId: TRADER_ID });

      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({
        traderId: TRADER_ID,
        allocationPct: "100",
        maxTradeSize: null,
        isActive: true,
      });
    });

    test("accepts explicit allocation, cap, destination, and paused state", () => {
      const result = createCopyTraderSchema.safeParse({
        traderId: TRADER_ID,
        allocationPct: "25.50",
        maxTradeSize: "1000.25",
        copyPortfolioId: PORTFOLIO_ID,
        isActive: false,
      });

      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({
        allocationPct: "25.50",
        maxTradeSize: "1000.25",
        copyPortfolioId: PORTFOLIO_ID,
        isActive: false,
      });
    });

    test("accepts numeric allocation and size values as strings", () => {
      const result = createCopyTraderSchema.safeParse({
        traderId: TRADER_ID,
        allocationPct: 50,
        maxTradeSize: 1000,
      });

      expect(result.success).toBe(true);
      expect(result.data.allocationPct).toBe("50");
      expect(result.data.maxTradeSize).toBe("1000");
    });

    test("rejects an invalid trader id", () => {
      expectIssueAt(
        createCopyTraderSchema.safeParse({ traderId: "not-a-uuid" }),
        "traderId",
      );
    });

    test.each(["0", "100.01", "-1", "50.123", "abc"])(
      "rejects allocationPct %s",
      (allocationPct) => {
        expectIssueAt(
          createCopyTraderSchema.safeParse({
            traderId: TRADER_ID,
            allocationPct,
          }),
          "allocationPct",
        );
      },
    );

    test.each(["0", "-1", "1.123456789", "abc"])(
      "rejects maxTradeSize %s",
      (maxTradeSize) => {
        expectIssueAt(
          createCopyTraderSchema.safeParse({
            traderId: TRADER_ID,
            maxTradeSize,
          }),
          "maxTradeSize",
        );
      },
    );

    test("rejects an invalid copyPortfolioId", () => {
      expectIssueAt(
        createCopyTraderSchema.safeParse({
          traderId: TRADER_ID,
          copyPortfolioId: "not-a-uuid",
        }),
        "copyPortfolioId",
      );
    });

    test("strips unknown fields", () => {
      const result = createCopyTraderSchema.safeParse({
        traderId: TRADER_ID,
        copierId: TRADER_ID,
        status: "ACTIVE",
      });

      expect(result.success).toBe(true);
      expect(result.data).not.toHaveProperty("copierId");
      expect(result.data).not.toHaveProperty("status");
    });
  });

  describe("updateCopyTraderSchema", () => {
    test.each([
      [{ allocationPct: "50" }],
      [{ maxTradeSize: "500" }],
      [{ maxTradeSize: null }],
      [{ copyPortfolioId: PORTFOLIO_ID }],
      [{ copyPortfolioId: null }],
      [{ isActive: false }],
    ])("accepts a single update field %#", (body) => {
      expect(updateCopyTraderSchema.safeParse(body).success).toBe(true);
    });

    test("rejects an empty body", () => {
      expect(updateCopyTraderSchema.safeParse({}).success).toBe(false);
    });

    test("rejects unknown fields", () => {
      expect(
        updateCopyTraderSchema.safeParse({ copiedId: TRADER_ID }).success,
      ).toBe(false);
    });

    test("rejects an out-of-range allocation", () => {
      expectIssueAt(
        updateCopyTraderSchema.safeParse({ allocationPct: "100.01" }),
        "allocationPct",
      );
    });
  });

  describe("copyTraderIdParamSchema", () => {
    test("accepts a uuid", () => {
      expect(
        copyTraderIdParamSchema.safeParse({ id: TRADER_ID }).success,
      ).toBe(true);
    });

    test("rejects a non-uuid", () => {
      expectIssueAt(
        copyTraderIdParamSchema.safeParse({ id: "nope" }),
        "id",
      );
    });
  });

  describe("listCopyTradersQuerySchema", () => {
    test("applies pagination defaults", () => {
      const result = listCopyTradersQuerySchema.safeParse({});

      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({ page: 1, limit: 20 });
    });

    test("parses boolean query strings", () => {
      expect(
        listCopyTradersQuerySchema.safeParse({ isActive: "true" }).data
          .isActive,
      ).toBe(true);
      expect(
        listCopyTradersQuerySchema.safeParse({ isActive: "false" }).data
          .isActive,
      ).toBe(false);
    });

    test("rejects a non-boolean active filter", () => {
      expectIssueAt(
        listCopyTradersQuerySchema.safeParse({ isActive: "yes" }),
        "isActive",
      );
    });

    test("rejects a limit above 100", () => {
      expectIssueAt(
        listCopyTradersQuerySchema.safeParse({ limit: "101" }),
        "limit",
      );
    });
  });
});
