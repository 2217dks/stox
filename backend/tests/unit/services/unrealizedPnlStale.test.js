const {
  calculatePositionUnrealizedPnl,
} = require("../../../src/services/unrealizedPnlService");

const holding = {
  symbol: "AAPL",
  assetType: "STOCK",
  quantity: "10",
  totalInvested: "1000",
};

const staleQuote = {
  symbol: "AAPL",
  assetType: "STOCK",
  price: "110",
  timestamp: "2020-01-01T00:00:00.000Z",
};

describe("allowStale", () => {
  test("rejectStale alone rejects a stale quote", () => {
    expect(() =>
      calculatePositionUnrealizedPnl(holding, staleQuote, {
        rejectStale: true,
      }),
    ).toThrow(/stale/i);
  });

  test("allowStale overrides rejectStale instead of being ignored", () => {
    expect(() =>
      calculatePositionUnrealizedPnl(holding, staleQuote, {
        rejectStale: true,
        allowStale: true,
      }),
    ).not.toThrow();
  });
});
