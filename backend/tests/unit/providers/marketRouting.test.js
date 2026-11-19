const {
  inferMarketRegion,
  providerSupportsMarket,
} = require("../../../src/providers/marketRouting");

describe("market routing metadata", () => {
  test("defaults plain and unrecognised stock suffixes to the US market", () => {
    expect(inferMarketRegion("AAPL")).toBe("US");
    expect(inferMarketRegion("BRK.B")).toBe("US");
    expect(inferMarketRegion("BRK-B")).toBe("US");
  });

  test("maps common international exchange suffixes to ISO regions", () => {
    expect(inferMarketRegion("VOD.L")).toBe("GB");
    expect(inferMarketRegion("7203.T")).toBe("JP");
    expect(inferMarketRegion("RELIANCE.NS")).toBe("IN");
    expect(inferMarketRegion("SHOP.TO")).toBe("CA");
    expect(inferMarketRegion("ASML.AS")).toBe("NL");
    expect(inferMarketRegion("SAP.DE")).toBe("DE");
    expect(inferMarketRegion("0700.HK")).toBe("HK");
    expect(inferMarketRegion("BHP.AX")).toBe("AU");
  });

  test("treats providers without market metadata as globally available", () => {
    expect(providerSupportsMarket({}, "GB")).toBe(true);
    expect(providerSupportsMarket({ markets: ["*"] }, "GB")).toBe(true);
    expect(providerSupportsMarket({ markets: ["US"] }, "GB")).toBe(false);
    expect(providerSupportsMarket({ markets: ["US", "GB"] }, "GB")).toBe(true);
  });

  test("only a global provider serves the synthetic GLOBAL region", () => {
    expect(providerSupportsMarket({ markets: ["GLOBAL"] }, "GLOBAL")).toBe(
      true,
    );
    expect(providerSupportsMarket({ markets: ["US"] }, "GLOBAL")).toBe(false);
  });
});
