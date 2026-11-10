jest.mock("../../../src/config/database", () => ({
  $disconnect: jest.fn(),
}));

const { Prisma } = require("@prisma/client");
const { evaluateOrder } = require("../../../src/services/tradeService");

// Pure trigger-condition contract for the order worker. No database or market
// provider is involved: the function only decides whether a pending order's
// price condition is met by the current market price.

function order(overrides = {}) {
  return {
    type: "MARKET",
    side: "BUY",
    limitPrice: null,
    stopPrice: null,
    ...overrides,
  };
}

describe("evaluateOrder", () => {
  test("market orders are executable at any positive price", () => {
    expect(evaluateOrder(order(), "100")).toBe(true);
    expect(evaluateOrder(order({ side: "SELL" }), "0.00000001")).toBe(true);
  });

  test("a BUY limit fills at or below the limit price", () => {
    const buyLimit = order({ type: "LIMIT", side: "BUY", limitPrice: "250" });

    expect(evaluateOrder(buyLimit, "249.99")).toBe(true);
    expect(evaluateOrder(buyLimit, "250")).toBe(true);
    expect(evaluateOrder(buyLimit, "250.01")).toBe(false);
  });

  test("a SELL limit fills at or above the limit price", () => {
    const sellLimit = order({ type: "LIMIT", side: "SELL", limitPrice: "300" });

    expect(evaluateOrder(sellLimit, "300.01")).toBe(true);
    expect(evaluateOrder(sellLimit, "300")).toBe(true);
    expect(evaluateOrder(sellLimit, "299.99")).toBe(false);
  });

  test("a stop-loss fills at or below its stop price", () => {
    const stopLoss = order({ type: "STOP_LOSS", stopPrice: "160" });

    expect(evaluateOrder(stopLoss, "159.99")).toBe(true);
    expect(evaluateOrder(stopLoss, "160")).toBe(true);
    expect(evaluateOrder(stopLoss, "160.01")).toBe(false);
  });

  test("a take-profit fills at or above its stop price", () => {
    const takeProfit = order({ type: "TAKE_PROFIT", stopPrice: "260" });

    expect(evaluateOrder(takeProfit, "260.01")).toBe(true);
    expect(evaluateOrder(takeProfit, "260")).toBe(true);
    expect(evaluateOrder(takeProfit, "259.99")).toBe(false);
  });

  test("orders with a missing trigger price are not executable", () => {
    expect(evaluateOrder(order({ type: "LIMIT" }), "100")).toBe(false);
    expect(evaluateOrder(order({ type: "STOP_LOSS" }), "100")).toBe(false);
    expect(evaluateOrder(order({ type: "TAKE_PROFIT" }), "100")).toBe(false);
  });

  test("preserves decimal precision instead of comparing floating-point values", () => {
    const buyLimit = order({
      type: "LIMIT",
      side: "BUY",
      limitPrice: new Prisma.Decimal("0.30000000"),
    });

    expect(evaluateOrder(buyLimit, "0.30000001")).toBe(false);
    expect(evaluateOrder(buyLimit, "0.3")).toBe(true);
  });
});
