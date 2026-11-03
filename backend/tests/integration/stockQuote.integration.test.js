process.env.JWT_ACCESS_SECRET ||= "stock-quote-integration-test-secret";

jest.mock("../../src/services/marketData", () => ({
  getQuote: jest.fn(),
}));

const request = require("supertest");
const app = require("../../src/app");
const marketDataService = require("../../src/services/marketData");
const { AppError } = require("../../src/utils/errors");

const quote = {
  symbol: "AAPL",
  assetClass: "STOCK",
  price: "226.5",
  change: "1.25",
  changePercent: "0.55",
  high: "228.1",
  low: "224.8",
  open: "225.3",
  previousClose: "225.25",
  volume: null,
  currency: "USD",
  timestamp: "2026-11-02T12:00:00.000Z",
  source: "finnhub",
};

beforeEach(() => {
  marketDataService.getQuote.mockReset();
});

describe("stock quote API integration", () => {
  test("returns the normalized stock quote envelope without authentication", async () => {
    marketDataService.getQuote.mockResolvedValue(quote);

    const response = await request(app).get("/api/v1/market/quote/stock/aapl");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true, data: quote });
    expect(marketDataService.getQuote).toHaveBeenCalledWith("AAPL", {
      assetClass: "STOCK",
    });
  });

  test("normalizes supported punctuation in stock ticker symbols", async () => {
    marketDataService.getQuote.mockResolvedValue({
      ...quote,
      symbol: "BRK.B",
    });

    const response = await request(app).get("/api/v1/market/quote/stock/brk.b");

    expect(response.status).toBe(200);
    expect(response.body.data.symbol).toBe("BRK.B");
    expect(marketDataService.getQuote).toHaveBeenCalledWith("BRK.B", {
      assetClass: "STOCK",
    });
  });

  test("accepts the maximum documented ticker length", async () => {
    const symbol = "ABCDEFGHIJKLMNOPQRST";
    marketDataService.getQuote.mockResolvedValue({ ...quote, symbol });

    const response = await request(app).get(
      `/api/v1/market/quote/stock/${symbol.toLowerCase()}`,
    );

    expect(response.status).toBe(200);
    expect(marketDataService.getQuote).toHaveBeenCalledWith(symbol, {
      assetClass: "STOCK",
    });
  });

  test.each(["AAPL!", "AAPL.", "ABCDEFGHIJKLMNOPQRSTU"])(
    "rejects invalid ticker format or length %s before service access",
    async (symbol) => {
      const response = await request(app).get(
        `/api/v1/market/quote/stock/${symbol}`,
      );

      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({
        success: false,
        error: { code: "VALIDATION_ERROR" },
      });
      expect(marketDataService.getQuote).not.toHaveBeenCalled();
    },
  );

  test("maps an unsupported stock symbol to the standard not-found error", async () => {
    marketDataService.getQuote.mockRejectedValue(
      new AppError(
        "Market data is unavailable for the requested symbol or range.",
        { statusCode: 404, code: "MARKET_DATA_NOT_FOUND" },
      ),
    );

    const response = await request(app).get(
      "/api/v1/market/quote/stock/NOTAREALSTOCK",
    );

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("MARKET_DATA_NOT_FOUND");
  });

  test("returns safe provider errors without exposing tokens or raw payloads", async () => {
    marketDataService.getQuote.mockRejectedValue(
      new AppError("Market data provider is temporarily unavailable.", {
        statusCode: 503,
        code: "MARKET_DATA_PROVIDER_UNAVAILABLE",
      }),
    );

    const response = await request(app).get("/api/v1/market/quote/stock/AAPL");

    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      success: false,
      error: {
        code: "MARKET_DATA_PROVIDER_UNAVAILABLE",
        message: "Market data provider is temporarily unavailable.",
      },
    });
    expect(JSON.stringify(response.body)).not.toContain("FINNHUB_API_KEY");
    expect(JSON.stringify(response.body)).not.toContain("rawProviderPayload");
  });
});
