jest.mock("../../../src/config/database", () => ({
  $disconnect: jest.fn(),
  copyTrader: {
    findMany: jest.fn(),
  },
  copyTradeExecution: {
    create: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
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
    update: jest.fn(),
  },
}));

jest.mock("../../../src/services/orderService", () => ({
  createOrder: jest.fn(),
}));

const {
  computeCopyQuantity,
  fanOutCopyTrades,
} = require("../../../src/services/copyTradeService");
const prisma = require("../../../src/config/database");
const orderService = require("../../../src/services/orderService");

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

describe("copy-trade fan-out recovery", () => {
  const sourceTrade = {
    id: "trade-1",
    symbol: "AAPL",
    assetType: "STOCK",
    side: "BUY",
    quantity: "10",
    price: "100",
    copyFanOutAt: null,
    order: { id: "order-source", source: "MANUAL" },
    portfolio: { userId: "copied-user" },
  };

  const copyTrader = {
    id: "copy-trader-1",
    copierId: "copier-1",
    copyPortfolioId: "portfolio-1",
    allocationPct: "100",
    maxTradeSize: null,
  };

  beforeEach(() => {
    jest.clearAllMocks();

    prisma.trade.findUnique.mockResolvedValue(sourceTrade);
    prisma.trade.update.mockResolvedValue({});
    prisma.copyTrader.findMany.mockResolvedValue([copyTrader]);
    prisma.copyTradeExecution.create.mockResolvedValue({
      id: "execution-1",
      status: "PENDING",
      attempts: 0,
    });
    prisma.copyTradeExecution.findUnique.mockResolvedValue({
      id: "execution-1",
      status: "PENDING",
      attempts: 0,
    });
    prisma.copyTradeExecution.update.mockImplementation(async ({ data }) => ({
      id: "execution-1",
      status: data.status ?? "PENDING",
      attempts: data.attempts ?? 0,
    }));
    prisma.copyTradeExecution.count.mockResolvedValue(0);
    prisma.portfolio.findUnique.mockResolvedValue({
      id: "portfolio-1",
      isActive: true,
    });
  });

  test("marks PLACED when a concurrent pass committed the order before the failure was classified", async () => {
    prisma.order.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "order-1", status: "PENDING" });

    orderService.createOrder.mockRejectedValue(
      Object.assign(new Error("Insufficient available portfolio cash."), {
        code: "INSUFFICIENT_BALANCE",
      }),
    );

    const summary = await fanOutCopyTrades({
      tradeId: sourceTrade.id,
      orderService,
    });

    expect(summary.placed).toBe(1);
    expect(summary.failed).toBe(0);
    expect(prisma.copyTradeExecution.update).toHaveBeenCalledWith({
      where: { id: "execution-1" },
      data: expect.objectContaining({ status: "PLACED" }),
    });
    expect(prisma.trade.update).toHaveBeenCalledWith({
      where: { id: sourceTrade.id },
      data: { copyFanOutAt: expect.any(Date) },
    });
  });
});
