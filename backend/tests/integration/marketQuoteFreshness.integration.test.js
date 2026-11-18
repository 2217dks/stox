jest.mock("../../src/services/marketData", () => ({
  getQuote: jest.fn(),
}));

const request = require("supertest");
const app = require("../../src/app");
const marketData = require("../../src/services/marketData");
const { createMarketDataError } = require("../../src/providers/marketDataErrors");

describe("market quote freshness API integration", () => {
  beforeEach(() => {
    marketData.getQuote.mockReset();
  });

  test("returns crypto quote with freshness fields and headers", async () => {
    const mockQuote = {
      symbol: "BINANCE:BTCUSDT",
      assetClass: "CRYPTO",
      price: "67123.45",
      change: "123.45",
      changePercent: "0.18",
      high: "68000",
      low: "66000",
      open: "67000",
      previousClose: "67000",
      volume: "1234.56",
      currency: "USDT",
      timestamp: new Date().toISOString(),
      source: "binance",
      isStale: false,
      freshness: "FRESH",
      ageSeconds: 5,
    };

    marketData.getQuote.mockResolvedValue(mockQuote);

    const response = await request(app).get("/api/v1/market/quote/BTCUSDT");

    expect(response.status).toBe(200);
    expect(response.headers["x-quote-freshness"]).toBe("FRESH");
    expect(response.headers["x-quote-age-seconds"]).toBe("5");
    expect(response.body).toEqual({
      success: true,
      data: mockQuote,
    });
    expect(marketData.getQuote).toHaveBeenCalledWith("BTCUSDT", {
      assetClass: "CRYPTO",
      rejectStale: undefined,
      maxAgeSeconds: undefined,
    });
  });

  test("passes rejectStale and maxAgeSeconds options to service", async () => {
    const mockQuote = {
      symbol: "AAPL",
      assetClass: "STOCK",
      price: "150.00",
      change: "1.00",
      changePercent: "0.67",
      high: "151.00",
      low: "149.00",
      open: "149.50",
      previousClose: "149.00",
      volume: "1000000",
      currency: "USD",
      timestamp: new Date().toISOString(),
      source: "finnhub",
      isStale: false,
      freshness: "FRESH",
      ageSeconds: 12,
    };

    marketData.getQuote.mockResolvedValue(mockQuote);

    const response = await request(app).get(
      "/api/v1/market/quote/stock/AAPL?rejectStale=true&maxAgeSeconds=60",
    );

    expect(response.status).toBe(200);
    expect(response.headers["x-quote-freshness"]).toBe("FRESH");
    expect(response.headers["x-quote-age-seconds"]).toBe("12");
    expect(marketData.getQuote).toHaveBeenCalledWith("AAPL", {
      assetClass: "STOCK",
      rejectStale: true,
      maxAgeSeconds: 60,
    });
  });

  test("returns 503 MARKET_DATA_STALE_QUOTE when service rejects stale quote", async () => {
    marketData.getQuote.mockRejectedValue(
      createMarketDataError(
        "Market data quote is stale or delayed.",
        503,
        "MARKET_DATA_STALE_QUOTE",
      ),
    );

    const response = await request(app).get(
      "/api/v1/market/quote/BTCUSDT?rejectStale=true",
    );

    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({
      success: false,
      error: {
        code: "MARKET_DATA_STALE_QUOTE",
        message: "Market data quote is stale or delayed.",
      },
    });
  });

  test("rejects invalid query parameters with 400 VALIDATION_ERROR", async () => {
    const response = await request(app).get(
      "/api/v1/market/quote/BTCUSDT?maxAgeSeconds=-5",
    );

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      success: false,
      error: {
        code: "VALIDATION_ERROR",
      },
    });
  });
});
