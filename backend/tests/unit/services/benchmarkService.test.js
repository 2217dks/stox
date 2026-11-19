const {
  getBenchmarkPriceSeries,
  getBenchmarkData,
} = require("../../../src/services/benchmarkService");

describe("benchmarkService unit tests", () => {
  const mockMarketData = {
    getHistoricalPrices: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("retrieves benchmark series and computes daily simple returns", async () => {
    // 3 candles spanning Nov 1, Nov 2, Nov 3
    mockMarketData.getHistoricalPrices.mockResolvedValue({
      assetClass: "STOCK",
      interval: "1d",
      prices: [
        {
          timestamp: new Date("2026-11-01T00:00:00.000Z").getTime(),
          open: "500",
          high: "505",
          low: "498",
          close: "500",
          volume: "1000000",
        },
        {
          timestamp: new Date("2026-11-02T00:00:00.000Z").getTime(),
          open: "500",
          high: "512",
          low: "499",
          close: "510",
          volume: "1200000",
        },
        {
          timestamp: new Date("2026-11-03T00:00:00.000Z").getTime(),
          open: "510",
          high: "511",
          low: "502",
          close: "504.9",
          volume: "950000",
        },
      ],
    });

    const asOf = new Date("2026-11-03T12:00:00.000Z");
    const result = await getBenchmarkData("SPY", {
      period: "1W",
      asOf,
      marketDataProvider: mockMarketData,
    });

    expect(result.benchmark).toBe("SPY");
    expect(result.period).toBe("1W");
    expect(result.prices).toHaveLength(3);

    expect(result.prices[0]).toEqual({
      date: "2026-11-01",
      price: "500",
      dailyReturn: null,
    });

    expect(result.prices[1]).toEqual({
      date: "2026-11-02",
      price: "510",
      dailyReturn: "0.0200", // (510 - 500) / 500 = 0.02
    });

    expect(result.prices[2]).toEqual({
      date: "2026-11-03",
      price: "504.9",
      dailyReturn: "-0.0100", // (504.9 - 510) / 510 = -0.01
    });
  });

  test("defaults symbol to SPY and period to 1M", async () => {
    mockMarketData.getHistoricalPrices.mockResolvedValue({
      assetClass: "STOCK",
      interval: "1d",
      prices: [],
    });

    const result = await getBenchmarkData(null, {
      marketDataProvider: mockMarketData,
    });

    expect(result.benchmark).toBe("SPY");
    expect(result.period).toBe("1M");
    expect(mockMarketData.getHistoricalPrices).toHaveBeenCalledWith(
      "SPY",
      expect.objectContaining({ interval: "1d" }),
    );
  });
});


describe("benchmarkService ALL period", () => {
  test("requests a window the market-data validator accepts for a three-year-old portfolio", async () => {
    const marketDataProvider = {
      getHistoricalPrices: jest.fn().mockResolvedValue({
        assetClass: "STOCK",
        interval: "1d",
        prices: [],
      }),
    };

    const client = {
      performanceSnapshot: {
        findMany: jest.fn().mockResolvedValue([
          { snapshotDate: new Date("2023-01-01T00:00:00.000Z") },
        ]),
      },
    };

    await getBenchmarkPriceSeries("SPY", {
      period: "ALL",
      asOf: new Date("2026-11-19T12:00:00.000Z"),
      portfolioId: "portfolio-1",
      marketDataProvider,
      client,
    });

    const [, options] = marketDataProvider.getHistoricalPrices.mock.calls[0];
    const DAY_MS = 24 * 60 * 60 * 1000;

    expect(options.to - options.from).toBeLessThanOrEqual(
      DAY_MS * options.limit,
    );
  });
});
