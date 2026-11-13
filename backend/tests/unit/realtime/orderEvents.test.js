const {
  configureEventBus,
  createInMemoryEventBus,
  resetEventBus,
} = require("../../../src/realtime/eventBus");
const {
  publishExecutionEvents,
} = require("../../../src/realtime/orderEvents");
const portfolioService = require("../../../src/services/portfolioService");

const ORDER = {
  id: "order-1",
  portfolioId: "0f6a0e37-2f6a-4f8d-9e0d-63f4a1a4f0b0",
  symbol: "AAPL",
  side: "BUY",
  type: "MARKET",
  status: "PENDING",
  quantity: "2",
};

const TRADE = {
  id: "trade-1",
  symbol: "AAPL",
  side: "BUY",
  quantity: "2",
  price: "100",
  totalValue: "200",
  realizedPnl: null,
  executedAt: new Date("2026-11-11T10:00:00.000Z"),
};

const VALUATION = {
  portfolioId: ORDER.portfolioId,
  cashBalance: "9800",
  holdingsValue: "200",
  totalValue: "10000",
  pnl: "0",
  asOf: "2026-11-11T10:00:01.000Z",
};

describe("Execution realtime events", () => {
  let bus;

  beforeEach(() => {
    bus = createInMemoryEventBus();
    configureEventBus(bus);
  });

  afterEach(() => {
    resetEventBus();
    jest.restoreAllMocks();
  });

  it("publishes order and trade events even when portfolio valuation fails", async () => {
    const published = [];

    bus.publish = jest.fn(async (message) => {
      published.push(message);
    });
    jest
      .spyOn(portfolioService, "getPortfolioValuation")
      .mockRejectedValue(new Error("valuation query failed"));

    await expect(
      publishExecutionEvents({ trade: TRADE, order: ORDER }),
    ).resolves.toBeUndefined();

    expect(published.map((message) => message.event)).toEqual([
      "order-status",
      "trade-executed",
    ]);
    expect(published[0].payload).toMatchObject({
      orderId: ORDER.id,
      status: "EXECUTED",
      price: "100",
    });
    expect(published[1].payload).toMatchObject({
      tradeId: TRADE.id,
      orderId: ORDER.id,
      realizedPnl: null,
    });
  });

  it("publishes the remaining events when one publish fails", async () => {
    const published = [];

    bus.publish = jest.fn(async (message) => {
      if (message.event === "order-status") {
        throw new Error("redis unavailable");
      }

      published.push(message);
    });
    jest
      .spyOn(portfolioService, "getPortfolioValuation")
      .mockResolvedValue(VALUATION);

    await expect(
      publishExecutionEvents({ trade: TRADE, order: ORDER }),
    ).resolves.toBeUndefined();

    expect(published.map((message) => message.event)).toEqual([
      "trade-executed",
      "portfolio-update",
    ]);
  });

  it("publishes all three events in a stable order", async () => {
    const published = [];

    bus.publish = jest.fn(async (message) => {
      published.push(message);
    });
    jest
      .spyOn(portfolioService, "getPortfolioValuation")
      .mockResolvedValue(VALUATION);

    await publishExecutionEvents({ trade: TRADE, order: ORDER });

    expect(published.map((message) => message.event)).toEqual([
      "order-status",
      "trade-executed",
      "portfolio-update",
    ]);
    expect(published[2].payload).toEqual(VALUATION);
  });

  it("does nothing when no event bus is configured", async () => {
    resetEventBus();

    const valuation = jest.spyOn(
      portfolioService,
      "getPortfolioValuation",
    );

    await expect(
      publishExecutionEvents({ trade: TRADE, order: ORDER }),
    ).resolves.toBeUndefined();

    expect(valuation).not.toHaveBeenCalled();
  });
});
