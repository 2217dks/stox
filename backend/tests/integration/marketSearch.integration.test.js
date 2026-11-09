jest.mock("../../src/services/marketData", () => ({
  searchSymbols: jest.fn(),
}));

const request = require("supertest");
const app = require("../../src/app");
const marketDataService = require("../../src/services/marketData");
const { AppError } = require("../../src/utils/errors");

const matches = [
  {
    symbol: "AAPL",
    name: "Apple Inc.",
    assetClass: "STOCK",
    exchange: "NASDAQ",
    currency: "USD",
    type: "Common Stock",
    source: "finnhub",
  },
  {
    symbol: "BINANCE:BTCUSDT",
    name: "BTC/USDT",
    assetClass: "CRYPTO",
    exchange: "BINANCE",
    currency: "USDT",
    type: "CRYPTO",
    source: "binance",
  },
];

function searchUrl(query) {
  const params = new URLSearchParams(query);
  return `/api/v1/market/search?${params}`;
}

beforeEach(() => {
  marketDataService.searchSymbols.mockReset();
});

describe("market symbol search API integration", () => {
  test("returns provider-independent metadata from both asset classes", async () => {
    marketDataService.searchSymbols.mockResolvedValue(matches);

    const response = await request(app).get(searchUrl({ query: " apple " }));

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true, data: matches });
    expect(marketDataService.searchSymbols).toHaveBeenCalledWith("apple", {
      limit: 20,
    });
  });

  test("passes an optional asset class and requested result limit", async () => {
    marketDataService.searchSymbols.mockResolvedValue([matches[0]]);

    const response = await request(app).get(
      searchUrl({ query: "apple", assetClass: "STOCK", limit: "5" }),
    );

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([matches[0]]);
    expect(marketDataService.searchSymbols).toHaveBeenCalledWith("apple", {
      assetClass: "STOCK",
      limit: 5,
    });
  });

  test("returns an empty result array when there are no matches", async () => {
    marketDataService.searchSymbols.mockResolvedValue([]);

    const response = await request(app).get(
      searchUrl({ query: "no-such-symbol" }),
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true, data: [] });
  });

  test("accepts the minimum and maximum query/limit boundaries", async () => {
    marketDataService.searchSymbols.mockResolvedValue([]);

    const minimum = await request(app).get(
      searchUrl({ query: "ab", limit: "1" }),
    );
    const maximumQuery = "a".repeat(50);
    const maximum = await request(app).get(
      searchUrl({ query: maximumQuery, limit: "50" }),
    );

    expect(minimum.status).toBe(200);
    expect(maximum.status).toBe(200);
    expect(marketDataService.searchSymbols).toHaveBeenNthCalledWith(1, "ab", {
      limit: 1,
    });
    expect(marketDataService.searchSymbols).toHaveBeenNthCalledWith(
      2,
      maximumQuery,
      { limit: 50 },
    );
  });

  test.each([
    ["missing query", {}],
    ["empty query", { query: "" }],
    ["one-character query", { query: "a" }],
    ["query over the maximum length", { query: "a".repeat(51) }],
    ["unsupported asset class", { query: "apple", assetClass: "OPTION" }],
    ["zero limit", { query: "apple", limit: "0" }],
    ["limit over the maximum", { query: "apple", limit: "51" }],
    ["non-integer limit", { query: "apple", limit: "2.5" }],
  ])("rejects %s before provider access", async (_description, query) => {
    const response = await request(app).get(searchUrl(query));

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      success: false,
      error: { code: "VALIDATION_ERROR" },
    });
    expect(marketDataService.searchSymbols).not.toHaveBeenCalled();
  });

  test("returns a safe provider error when search is unavailable", async () => {
    marketDataService.searchSymbols.mockRejectedValue(
      new AppError("Market data provider rate limit reached.", {
        statusCode: 429,
        code: "MARKET_DATA_RATE_LIMITED",
      }),
    );

    const response = await request(app).get(searchUrl({ query: "apple" }));

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
