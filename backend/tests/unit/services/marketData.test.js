jest.mock("dotenv", () => ({
  config: jest.fn(),
}));

jest.mock("../../../src/config/marketDataConfig", () => ({
  loadMarketDataConfig: jest.fn(() => ({
    providerByAssetClass: {
      STOCK: "stocks",
      CRYPTO: "crypto",
    },
  })),
}));

jest.mock("../../../src/providers/createMarketDataProviders", () => ({
  createMarketDataProviders: jest.fn(() => ({
    stocks: {},
    crypto: {},
  })),
}));

jest.mock("../../../src/services/marketDataService", () => ({
  createMarketDataService: jest.fn(),
}));

jest.mock("../../../src/services/cacheService", () => ({
  getOrSetPrice: jest.fn(),
}));

const {
  createMarketDataService,
} = require("../../../src/services/marketDataService");
const cacheService = require("../../../src/services/cacheService");

const baseMarketDataService = {
  getQuote: jest.fn(),
};

createMarketDataService.mockReturnValue(baseMarketDataService);

const marketData = require("../../../src/services/marketData");

describe("marketData quote caching", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    createMarketDataService.mockReturnValue(baseMarketDataService);

    cacheService.getOrSetPrice.mockImplementation(
      (_assetClass, _symbol, loader) => loader(),
    );

    baseMarketDataService.getQuote.mockResolvedValue({
      symbol: "AAPL",
      assetClass: "STOCK",
      price: "250.10",
    });
  });

  test("uses the STOCK cache namespace for stock quotes", async () => {
    await marketData.getQuote("aapl", {
      assetClass: "STOCK",
    });

    expect(cacheService.getOrSetPrice).toHaveBeenCalledWith(
      "STOCK",
      "aapl",
      expect.any(Function),
    );
  });

  test("infers CRYPTO for crypto symbols", async () => {
    await marketData.getQuote("btcusdt");

    expect(cacheService.getOrSetPrice).toHaveBeenCalledWith(
      "CRYPTO",
      "btcusdt",
      expect.any(Function),
    );
  });
});
