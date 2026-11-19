const request = require("supertest");

const app = require("../../src/app");
const marketData = require("../../src/services/marketData");

describe("GET /market/quotes", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("returns one batch of quotes for many symbols", async () => {
    const spy = jest.spyOn(marketData, "getQuotes").mockResolvedValue([
      { symbol: "AAPL", assetClass: "STOCK", price: "100" },
      { symbol: "BINANCE:BTCUSDT", assetClass: "CRYPTO", price: "50000" },
    ]);

    const response = await request(app).get(
      "/api/v1/market/quotes?symbols=AAPL,BTCUSDT",
    );

    expect(response.status).toBe(200);
    expect(response.body.data.quotes).toHaveLength(2);
    expect(spy).toHaveBeenCalledWith(["AAPL", "BTCUSDT"]);
  });

  test("rejects more than 20 symbols", async () => {
    const symbols = Array.from({ length: 21 }, (_, index) => `S${index}`).join(
      ",",
    );

    const response = await request(app).get(
      `/api/v1/market/quotes?symbols=${symbols}`,
    );

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  test("rejects a request with no symbols", async () => {
    const response = await request(app).get("/api/v1/market/quotes");

    expect(response.status).toBe(400);
  });

  test("returns quote for a single symbol", async () => {
    const spy = jest.spyOn(marketData, "getQuotes").mockResolvedValue([
      { symbol: "AAPL", assetClass: "STOCK", price: "150" },
    ]);

    const response = await request(app).get(
      "/api/v1/market/quotes?symbols=AAPL",
    );

    expect(response.status).toBe(200);
    expect(response.body.data.quotes).toHaveLength(1);
    expect(spy).toHaveBeenCalledWith(["AAPL"]);
  });

  test("supports repeated symbols query parameters", async () => {
    const spy = jest.spyOn(marketData, "getQuotes").mockResolvedValue([
      { symbol: "AAPL", assetClass: "STOCK", price: "150" },
      { symbol: "BINANCE:ETHUSDT", assetClass: "CRYPTO", price: "3000" },
    ]);

    const response = await request(app).get(
      "/api/v1/market/quotes?symbols=AAPL&symbols=ETHUSDT",
    );

    expect(response.status).toBe(200);
    expect(response.body.data.quotes).toHaveLength(2);
    expect(spy).toHaveBeenCalledWith(["AAPL", "ETHUSDT"]);
  });

  test("deduplicates symbols in batch query", async () => {
    const spy = jest.spyOn(marketData, "getQuotes").mockResolvedValue([
      { symbol: "AAPL", assetClass: "STOCK", price: "150" },
      { symbol: "MSFT", assetClass: "STOCK", price: "400" },
    ]);

    const response = await request(app).get(
      "/api/v1/market/quotes?symbols=AAPL,MSFT,AAPL,MSFT",
    );

    expect(response.status).toBe(200);
    expect(spy).toHaveBeenCalledWith(["AAPL", "MSFT"]);
  });

  test("handles partial failures by returning only fulfilled quotes without 500 error", async () => {
    jest.spyOn(marketData, "getQuote").mockImplementation(async (sym) => {
      if (sym === "INVALID_DELISTED") {
        throw new Error("Provider returned 404");
      }
      return { symbol: sym, assetClass: "STOCK", price: "100" };
    });

    const response = await request(app).get(
      "/api/v1/market/quotes?symbols=AAPL,INVALID_DELISTED,MSFT",
    );

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.quotes).toHaveLength(2);
    expect(response.body.data.quotes.map((q) => q.symbol)).toEqual([
      "AAPL",
      "MSFT",
    ]);
  });
});
