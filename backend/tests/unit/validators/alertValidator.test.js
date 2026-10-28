const {
  updateAlertSchema,
  alertParamsSchema,
} = require("../../../src/validators/alertValidator");

// Black-box tests at the module boundary (the exported schemas are the
// public interface). Contract invariants mirror the order/trade validator
// suites:
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

describe("alertValidator schemas (black-box)", () => {
  describe("updateAlertSchema: partial updates", () => {
    const singleFieldCases = [
      { case: "condition only", payload: { condition: "PRICE_ABOVE" } },
      { case: "targetPrice only", payload: { targetPrice: "250.5" } },
      { case: "status only", payload: { status: "ACTIVE" } },
      { case: "sendEmail only", payload: { sendEmail: false } },
      { case: "sendPush only", payload: { sendPush: true } },
    ];

    for (const { case: label, payload } of singleFieldCases) {
      test(`accepts ${label}`, () => {
        expectValid(updateAlertSchema.safeParse(payload));
      });
    }

    test("accepts a combined update", () => {
      const result = updateAlertSchema.safeParse({
        condition: "PRICE_BELOW",
        targetPrice: 12.5,
        status: "TRIGGERED",
        sendEmail: false,
        sendPush: true,
      });

      expectValid(result);
      expect(result.data.targetPrice).toBe("12.5");
      expect(result.data.status).toBe("TRIGGERED");
      expect(result.data.sendPush).toBe(true);
    });

    test("normalizes a numeric targetPrice to a decimal string", () => {
      const result = updateAlertSchema.safeParse({ targetPrice: 300 });

      expectValid(result);
      expect(result.data.targetPrice).toBe("300");
    });
  });

  describe("updateAlertSchema: empty payloads", () => {
    test("rejects an empty object", () => {
      expectIssueAt(updateAlertSchema.safeParse({}), "");
    });

    test("rejects an object with only undefined values", () => {
      expectIssueAt(
        updateAlertSchema.safeParse({ condition: undefined }),
        "",
      );
    });
  });

  describe("updateAlertSchema: field validation", () => {
    const invalidFieldCases = [
      {
        case: "unknown condition",
        payload: { condition: "NOT_A_CONDITION" },
        path: "condition",
      },
      {
        case: "unknown status",
        payload: { status: "PAUSED" },
        path: "status",
      },
      { case: "zero targetPrice", payload: { targetPrice: "0" }, path: "targetPrice" },
      {
        case: "negative targetPrice",
        payload: { targetPrice: "-5" },
        path: "targetPrice",
      },
      {
        case: "targetPrice with more than 8 decimals",
        payload: { targetPrice: "1.123456789" },
        path: "targetPrice",
      },
      {
        case: "non-numeric targetPrice",
        payload: { targetPrice: "abc" },
        path: "targetPrice",
      },
      {
        case: "non-boolean sendEmail",
        payload: { sendEmail: "yes" },
        path: "sendEmail",
      },
      {
        case: "non-boolean sendPush",
        payload: { sendPush: "yes" },
        path: "sendPush",
      },
    ];

    for (const { case: label, payload, path } of invalidFieldCases) {
      test(`rejects ${label}`, () => {
        expectIssueAt(updateAlertSchema.safeParse(payload), path);
      });
    }
  });

  describe("updateAlertSchema: unknown field rejection", () => {
    // Unrecognized keys are rejected at the payload root: zod reports path
    // "" with a message that names the offending key.
    function expectRootIssueNaming(result, key) {
      expect(result.success).toBe(false);
      expect(issuesOf(result)).toContain("");
      expect(
        result.error.issues.some((issue) => issue.message.includes(key)),
      ).toBe(true);
    }

    const unknownFieldCases = [
      { case: "symbol", field: "symbol", value: "AAPL" },
      { case: "assetType", field: "assetType", value: "STOCK" },
      { case: "userId", field: "userId", value: uuid },
      { case: "an arbitrary field", field: "malicious", value: 1 },
    ];

    for (const { case: label, field, value } of unknownFieldCases) {
      test(`rejects ${label}`, () => {
        expectRootIssueNaming(
          updateAlertSchema.safeParse({
            status: "ACTIVE",
            [field]: value,
          }),
          field,
        );
      });
    }

    test("rejects a payload of only unknown fields", () => {
      expectRootIssueNaming(
        updateAlertSchema.safeParse({ symbol: "AAPL" }),
        "symbol",
      );
    });
  });

  describe("alertParamsSchema: UUID parameter validation", () => {
    test("accepts a valid UUID", () => {
      const result = alertParamsSchema.safeParse({ alertId: uuid });

      expectValid(result);
      expect(result.data.alertId).toBe(uuid);
    });

    const invalidParamCases = [
      { case: "a non-UUID string", alertId: "not-a-uuid" },
      { case: "a numeric ID", alertId: "12345" },
      { case: "an empty string", alertId: "" },
      {
        case: "a malformed UUID variant",
        alertId: "11111111-1111-1111-1111-111111111111",
      },
    ];

    for (const { case: label, alertId } of invalidParamCases) {
      test(`rejects ${label}`, () => {
        expectIssueAt(alertParamsSchema.safeParse({ alertId }), "alertId");
      });
    }
  });
});
