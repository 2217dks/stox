const {
  createMarketQuoteDto,
  normalizeQuoteDecimal,
} = require("../../../src/dtos/marketQuoteDto");

function quote(overrides = {}) {
  return {
    symbol: " aapl ",
    assetClass: "stock",
    price: 123.45,
    change: 1.2,
    changePercent: 0.98,
    high: 125,
    low: 120,
    open: 121,
    previousClose: 122.25,
    volume: null,
    currency: "usd",
    timestamp: new Date("2026-11-02T00:00:00.000Z"),
    source: " FINNHUB ",
    ...overrides,
  };
}

describe("normalized market quote DTO", () => {
  test("returns the stable normalized quote shape", () => {
    expect(createMarketQuoteDto(quote())).toEqual({
      symbol: "AAPL",
      assetClass: "STOCK",
      price: "123.45",
      change: "1.2",
      changePercent: "0.98",
      high: "125",
      low: "120",
      open: "121",
      previousClose: "122.25",
      volume: null,
      currency: "USD",
      timestamp: "2026-11-02T00:00:00.000Z",
      source: "finnhub",
    });
  });

  test("canonicalizes decimal text and expands exponents without rounding", () => {
    expect(normalizeQuoteDecimal("00100.1200")).toBe("100.12");
    expect(normalizeQuoteDecimal("123456789012345678901234567890.123000")).toBe(
      "123456789012345678901234567890.123",
    );
    expect(normalizeQuoteDecimal("1.2300e-7")).toBe("0.000000123");
    expect(normalizeQuoteDecimal(1e-8)).toBe("0.00000001");
    expect(normalizeQuoteDecimal("-0.000")).toBe("0");
  });

  test("normalizes equivalent provider precision to the same decimal string", () => {
    const fromFinnhub = createMarketQuoteDto(quote({ price: 100.12 }));
    const fromBinance = createMarketQuoteDto(
      quote({ price: "100.120000", assetClass: "CRYPTO" }),
    );

    expect(fromFinnhub.price).toBe(fromBinance.price);
  });

  test("turns missing optional quote values into explicit nulls", () => {
    const result = createMarketQuoteDto(
      quote({
        change: undefined,
        changePercent: null,
        high: undefined,
        low: null,
        open: undefined,
        previousClose: null,
        volume: undefined,
        currency: undefined,
        timestamp: undefined,
      }),
    );

    expect(result).toMatchObject({
      change: null,
      changePercent: null,
      high: null,
      low: null,
      open: null,
      previousClose: null,
      volume: null,
      currency: null,
      timestamp: null,
    });
  });

  test("converts timestamp offsets to UTC ISO strings", () => {
    expect(
      createMarketQuoteDto(quote({ timestamp: "2026-11-02T05:30:00+05:30" }))
        .timestamp,
    ).toBe("2026-11-02T00:00:00.000Z");
  });

  test.each([
    ["invalid decimal", { price: "not-a-price" }],
    ["infinite decimal", { price: Number.POSITIVE_INFINITY }],
    ["malformed optional decimal", { change: "1.2.3" }],
    ["malformed timestamp", { timestamp: "not-a-date" }],
    ["invalid timestamp type", { timestamp: false }],
    ["zero price", { price: "0.00" }],
    ["negative volume", { volume: "-1" }],
  ])("rejects %s", async (_label, overrides) => {
    await expect(
      Promise.resolve().then(() => createMarketQuoteDto(quote(overrides))),
    ).rejects.toMatchObject({
      statusCode: 502,
      code: "MARKET_DATA_INVALID_RESPONSE",
    });
  });
});
