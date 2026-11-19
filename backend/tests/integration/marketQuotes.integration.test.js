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
});
