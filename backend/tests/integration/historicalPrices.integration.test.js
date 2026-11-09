process.env.JWT_ACCESS_SECRET ||= "historical-prices-integration-test-secret";

jest.mock("../../src/services/marketData", () => ({
  getHistoricalPrices: jest.fn(),
}));

const jwt = require("jsonwebtoken");
const request = require("supertest");
const app = require("../../src/app");
const marketDataService = require("../../src/services/marketData");
const { AppError } = require("../../src/utils/errors");

const now = Math.floor(Date.now() / 60_000) * 60_000;
const from = now - 2 * 86_400_000;
const to = now - 86_400_000;
const history = {
  symbol: "AAPL",
  assetClass: "STOCK",
  interval: "1d",
  prices: [
    {
      timestamp: "2026-10-30T00:00:00.000Z",
      open: "100",
      high: "105",
      low: "99",
      close: "103.5",
      volume: "1000",
    },
    {
      timestamp: "2026-10-31T00:00:00.000Z",
      open: "103.5",
      high: "107",
      low: "102",
      close: "106",
      volume: "1200",
    },
  ],
};

function historyUrl(query = {}, symbol = "AAPL") {
  const params = new URLSearchParams({
    interval: "1d",
    from: String(from),
    to: String(to),
    ...query,
  });
  return `/api/v1/market/history/${symbol}?${params}`;
}

beforeEach(() => {
  marketDataService.getHistoricalPrices.mockReset();
});

describe("historical prices API integration", () => {
  test("returns ordered history in the standard envelope without authentication", async () => {
    marketDataService.getHistoricalPrices.mockResolvedValue(history);

    const response = await request(app).get(historyUrl());

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true, data: history });
    expect(marketDataService.getHistoricalPrices).toHaveBeenCalledWith("AAPL", {
      interval: "1d",
      from,
      to,
      limit: 500,
    });
  });

  test("accepts the documented crypto asset class and forwards it to the service", async () => {
    const cryptoHistory = {
      ...history,
      symbol: "BTCUSDT",
      assetClass: "CRYPTO",
    };
    marketDataService.getHistoricalPrices.mockResolvedValue(cryptoHistory);

    const response = await request(app).get(
      historyUrl({ assetClass: "CRYPTO" }, "BTCUSDT"),
    );

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual(cryptoHistory);
    expect(marketDataService.getHistoricalPrices).toHaveBeenCalledWith(
      "BTCUSDT",
      { interval: "1d", from, to, limit: 500, assetClass: "CRYPTO" },
    );
  });

  test("accepts the configured maximum point limit and range boundary", async () => {
    marketDataService.getHistoricalPrices.mockResolvedValue({
      ...history,
      prices: [],
    });
    const boundaryFrom = now - 1000 * 86_400_000;
    const url = historyUrl({
      from: String(boundaryFrom),
      to: String(now),
      limit: "1000",
    });

    const response = await request(app).get(url);

    expect(response.status).toBe(200);
    expect(response.body.data.prices).toEqual([]);
    expect(marketDataService.getHistoricalPrices).toHaveBeenCalledWith("AAPL", {
      interval: "1d",
      from: boundaryFrom,
      to: now,
      limit: 1000,
    });
  });

  test.each([
    ["unsupported interval", { interval: "2d" }],
    ["unsupported asset class", { assetClass: "OPTION" }],
    ["reversed dates", { from: String(to), to: String(from) }],
    ["future end date", { to: String(now + 86_400_000) }],
    [
      "range beyond point limit",
      { from: String(now - 3 * 86_400_000), to: String(to), limit: "1" },
    ],
  ])("rejects %s before provider access", async (_label, query) => {
    const response = await request(app).get(historyUrl(query));

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      success: false,
      error: { code: "VALIDATION_ERROR" },
    });
    expect(marketDataService.getHistoricalPrices).not.toHaveBeenCalled();
  });

  test("rejects malformed symbols before provider access", async () => {
    const response = await request(app).get(
      `/api/v1/market/history/${encodeURIComponent("AAPL!")}?interval=1d&from=${from}&to=${to}`,
    );

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
    expect(marketDataService.getHistoricalPrices).not.toHaveBeenCalled();
  });

  test("represents a valid empty provider result as an empty prices array", async () => {
    marketDataService.getHistoricalPrices.mockResolvedValue({
      ...history,
      prices: [],
    });

    const response = await request(app).get(historyUrl());

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      data: { ...history, prices: [] },
    });
  });

  test("maps provider failures to the safe standard error envelope", async () => {
    marketDataService.getHistoricalPrices.mockRejectedValue(
      new AppError("Market data provider is temporarily unavailable.", {
        statusCode: 503,
        code: "MARKET_DATA_PROVIDER_UNAVAILABLE",
      }),
    );

    const response = await request(app).get(historyUrl());

    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      success: false,
      error: {
        code: "MARKET_DATA_PROVIDER_UNAVAILABLE",
        message: "Market data provider is temporarily unavailable.",
      },
    });
  });

  test("serves the same public endpoint to an authenticated caller", async () => {
    marketDataService.getHistoricalPrices.mockResolvedValue(history);
    const token = jwt.sign(
      { userId: "historical-prices-user", role: "TRADER" },
      process.env.JWT_ACCESS_SECRET,
      { issuer: "stox", expiresIn: "5m" },
    );

    const response = await request(app)
      .get(historyUrl())
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual(history);
  });
});
