jest.mock("../../../src/config/database", () => ({
  $disconnect: jest.fn(),
  copyTrader: {
    findMany: jest.fn(),
  },
  copyTradeExecution: {
    create: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  order: {
    findUnique: jest.fn(),
  },
  portfolio: {
    findFirst: jest.fn(),
    findUnique: jest.fn(),
  },
  trade: {
    findUnique: jest.fn(),
  },
}));

jest.mock("../../../src/services/orderService", () => ({
  createOrder: jest.fn(),
}));

const { computeCopyQuantity } = require("../../../src/services/copyTradeService");

// Pure sizing contract. The fan-out path is covered by the integration suite;
// these cases pin the arithmetic and the rounding direction.
describe("computeCopyQuantity", () => {
  test("mirrors the source quantity scaled by allocationPct", () => {
    expect(
      computeCopyQuantity({
        sourceQuantity: "10",
        sourcePrice: "100",
        allocationPct: "50",
      }).toString(),
    ).toBe("5");
  });

  test("supports a fractional allocation", () => {
    expect(
      computeCopyQuantity({
        sourceQuantity: "10",
        sourcePrice: "100",
        allocationPct: "25.5",
      }).toString(),
    ).toBe("2.55");
  });

  test("applies maxTradeSize as a notional cap", () => {
    expect(
      computeCopyQuantity({
        sourceQuantity: "10",
        sourcePrice: "100",
        allocationPct: "100",
        maxTradeSize: "250",
      }).toString(),
    ).toBe("2.5");
  });

  test("does not raise the quantity when the cap is above the mirrored size", () => {
    expect(
      computeCopyQuantity({
        sourceQuantity: "1",
        sourcePrice: "100",
        allocationPct: "100",
        maxTradeSize: "1000",
      }).toString(),
    ).toBe("1");
  });

  test("rounds down so the notional never exceeds the cap", () => {
    expect(
      computeCopyQuantity({
        sourceQuantity: "1",
        sourcePrice: "3",
        allocationPct: "100",
        maxTradeSize: "1",
      }).toString(),
    ).toBe("0.33333333");
  });

  test("returns zero for a zero source quantity", () => {
    expect(
      computeCopyQuantity({
        sourceQuantity: "0",
        sourcePrice: "100",
        allocationPct: "100",
      }).toString(),
    ).toBe("0");
  });

  test("returns zero for a non-positive allocation", () => {
    expect(
      computeCopyQuantity({
        sourceQuantity: "10",
        sourcePrice: "100",
        allocationPct: "0",
      }).toString(),
    ).toBe("0");
  });

  test("ignores a null maxTradeSize", () => {
    expect(
      computeCopyQuantity({
        sourceQuantity: "10",
        sourcePrice: "100",
        allocationPct: "100",
        maxTradeSize: null,
      }).toString(),
    ).toBe("10");
  });

  test("preserves decimal precision", () => {
    expect(
      computeCopyQuantity({
        sourceQuantity: "0.1",
        sourcePrice: "0.1",
        allocationPct: "33.33",
      }).toString(),
    ).toBe("0.03333");
  });
});
