process.env.JWT_ACCESS_SECRET ||= "crypto-quote-integration-test-secret";

jest.mock("../../src/services/marketData", () => ({
  getQuote: jest.fn(),
}));

const jwt = require("jsonwebtoken");
const request = require("supertest");
const app = require("../../src/app");
const marketDataService = require("../../src/services/marketData");
const { AppError } = require("../../src/utils/errors");

const quote = {
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
  timestamp: "2026-11-02T12:00:00.000Z",
  source: "binance",
};

beforeEach(() => {
  marketDataService.getQuote.mockReset();
});

describe("crypto quote API integration", () => {
  test("returns the normalized quote envelope without authentication", async () => {
    marketDataService.getQuote.mockResolvedValue(quote);

    const response = await request(app).get("/api/v1/market/quote/btcusdt");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true, data: quote });
    expect(marketDataService.getQuote).toHaveBeenCalledWith("BTCUSDT", {
      assetClass: "CRYPTO",
    });
  });

  test("also serves a caller with a valid access token", async () => {
    marketDataService.getQuote.mockResolvedValue(quote);
    const token = jwt.sign(
      { userId: "crypto-quote-user", role: "TRADER" },
      process.env.JWT_ACCESS_SECRET,
      { issuer: "stox", expiresIn: "5m" },
    );

    const response = await request(app)
      .get("/api/v1/market/quote/BINANCE%3ABTC%2FUSDT")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual(quote);
    expect(marketDataService.getQuote).toHaveBeenCalledWith(
      "BINANCE:BTC/USDT",
      { assetClass: "CRYPTO" },
    );
  });

  test("rejects invalid symbols before calling the market-data service", async () => {
    const response = await request(app).get("/api/v1/market/quote/AAPL");

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      success: false,
      error: { code: "VALIDATION_ERROR" },
    });
    expect(marketDataService.getQuote).not.toHaveBeenCalled();
  });

  test("maps an unknown Binance pair to the standard not-found error", async () => {
    marketDataService.getQuote.mockRejectedValue(
      new AppError(
        "Market data is unavailable for the requested symbol or range.",
        {
          statusCode: 404,
          code: "MARKET_DATA_NOT_FOUND",
        },
      ),
    );

    const response = await request(app).get(
      "/api/v1/market/quote/NOTAREALCOINUSDT",
    );

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      success: false,
      error: {
        code: "MARKET_DATA_NOT_FOUND",
        message:
          "Market data is unavailable for the requested symbol or range.",
      },
    });
    expect(marketDataService.getQuote).toHaveBeenCalledWith(
      "NOTAREALCOINUSDT",
      { assetClass: "CRYPTO" },
    );
  });

  test("returns the standard safe error envelope for provider failures", async () => {
    marketDataService.getQuote.mockRejectedValue(
      new AppError("Market data provider rate limit reached.", {
        statusCode: 429,
        code: "MARKET_DATA_RATE_LIMITED",
      }),
    );

    const response = await request(app).get("/api/v1/market/quote/BTCUSDT");

    expect(response.status).toBe(429);
    expect(response.body).toEqual({
      success: false,
      error: {
        code: "MARKET_DATA_RATE_LIMITED",
        message: "Market data provider rate limit reached.",
      },
    });
  });
});
