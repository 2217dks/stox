jest.mock("../../src/services/marketData", () => ({
  getMarketOverview: jest.fn(),
}));

const request = require("supertest");
const app = require("../../src/app");
const marketDataService = require("../../src/services/marketData");
const { AppError } = require("../../src/utils/errors");

const cryptoOverview = {
  assetClass: "CRYPTO",
  asOf: "2026-11-02T12:00:00.000Z",
  marketStatus: {
    isOpen: true,
    session: "24/7",
    exchange: "BINANCE",
    timezone: "UTC",
  },
  movers: [
    {
      symbol: "BINANCE:BTCUSDT",
      price: "67123.45",
      changePercent: "2.5",
      quoteVolume: "1234567.89",
    },
  ],
  source: "binance",
};

beforeEach(() => {
  marketDataService.getMarketOverview.mockReset();
});

describe("market overview API integration", () => {
  test("returns the normalized crypto overview in the standard envelope", async () => {
    marketDataService.getMarketOverview.mockResolvedValue(cryptoOverview);

    const response = await request(app).get(
      "/api/v1/market/overview?assetClass=CRYPTO&limit=10",
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true, data: cryptoOverview });
    expect(marketDataService.getMarketOverview).toHaveBeenCalledWith({
      assetClass: "CRYPTO",
      limit: 10,
    });
  });

  test("marks stock movers unavailable while retaining market status", async () => {
    const stockOverview = {
      assetClass: "STOCK",
      asOf: "2026-11-02T12:00:00.000Z",
      marketStatus: {
        isOpen: true,
        session: "regular",
        exchange: "US",
        timezone: "America/New_York",
      },
      movers: null,
      source: "finnhub",
    };
    marketDataService.getMarketOverview.mockResolvedValue(stockOverview);

    const response = await request(app).get(
      "/api/v1/market/overview?assetClass=STOCK",
    );

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual(stockOverview);
    expect(marketDataService.getMarketOverview).toHaveBeenCalledWith({
      assetClass: "STOCK",
      limit: 10,
    });
  });

  test("represents an available but empty mover feed with an empty array", async () => {
    marketDataService.getMarketOverview.mockResolvedValue({
      ...cryptoOverview,
      movers: [],
    });

    const response = await request(app).get(
      "/api/v1/market/overview?assetClass=CRYPTO",
    );

    expect(response.status).toBe(200);
    expect(response.body.data.movers).toEqual([]);
  });

  test.each([
    ["missing asset class", ""],
    ["unsupported asset class", "?assetClass=OPTIONS"],
    ["excessive mover limit", "?assetClass=CRYPTO&limit=101"],
    ["non-integer mover limit", "?assetClass=CRYPTO&limit=2.5"],
  ])("rejects %s before provider access", async (_description, query) => {
    const response = await request(app).get(`/api/v1/market/overview${query}`);

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      success: false,
      error: { code: "VALIDATION_ERROR" },
    });
    expect(marketDataService.getMarketOverview).not.toHaveBeenCalled();
  });

  test("returns the standard safe error envelope when the selected provider fails", async () => {
    marketDataService.getMarketOverview.mockRejectedValue(
      new AppError("Market data provider is temporarily unavailable.", {
        statusCode: 503,
        code: "MARKET_DATA_PROVIDER_UNAVAILABLE",
      }),
    );

    const response = await request(app).get(
      "/api/v1/market/overview?assetClass=CRYPTO",
    );

    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      success: false,
      error: {
        code: "MARKET_DATA_PROVIDER_UNAVAILABLE",
        message: "Market data provider is temporarily unavailable.",
      },
    });
  });
});
