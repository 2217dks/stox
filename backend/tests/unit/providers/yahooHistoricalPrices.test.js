const {
  mapYahooChart,
} = require("../../../src/providers/yahooHistoricalPrices");

const HOUR_MS = 60 * 60 * 1000;
const BASE_SECONDS = 1_700_000_000;

function chartPayload() {
  return {
    chart: {
      result: [
        {
          timestamp: [
            BASE_SECONDS,
            BASE_SECONDS + 3600,
            BASE_SECONDS + 7200,
            BASE_SECONDS + 10800,
            BASE_SECONDS + 14400,
          ],
          indicators: {
            quote: [
              {
                open: [1, 2, null, 4, 5],
                high: [2, 3, null, 5, 6],
                low: [0.5, 1.5, null, 3.5, 4.5],
                close: [1.5, 2.5, null, 4.5, 5.5],
                volume: [10, 20, null, 40, 50],
              },
            ],
          },
        },
      ],
    },
  };
}

describe("Yahoo historical price mapping", () => {
  test("maps timestamps and OHLCV to normalized strings, skipping null rows", () => {
    const result = mapYahooChart(chartPayload(), {
      symbol: "AAPL",
      interval: "1h",
    });

    expect(result.symbol).toBe("AAPL");
    expect(result.assetClass).toBe("STOCK");
    expect(result.interval).toBe("1h");
    expect(result.prices).toHaveLength(4);
    expect(result.prices[0]).toEqual({
      timestamp: new Date(BASE_SECONDS * 1000).toISOString(),
      open: "1",
      high: "2",
      low: "0.5",
      close: "1.5",
      volume: "10",
    });
  });

  test("aggregates 1h candles into 4h buckets", () => {
    const result = mapYahooChart(chartPayload(), {
      symbol: "AAPL",
      interval: "4h",
    });

    expect(result.prices).toHaveLength(2);
    expect(result.prices[0]).toMatchObject({
      open: "1",
      high: "3",
      low: "0.5",
      close: "2.5",
      volume: "30",
    });
    expect(new Date(result.prices[0].timestamp).getTime() % (4 * HOUR_MS)).toBe(
      0,
    );
  });

  test("returns an empty series when the window has no trading session", () => {
    const result = mapYahooChart(
      { chart: { result: [{ meta: {}, indicators: { quote: [] } }] } },
      { symbol: "AAPL", interval: "5m" },
    );

    expect(result.prices).toEqual([]);
  });

  test("rejects a payload without chart data", () => {
    expect(() => mapYahooChart({}, { symbol: "AAPL", interval: "1d" })).toThrow(
      "Stock history provider returned an invalid response.",
    );
  });
});
