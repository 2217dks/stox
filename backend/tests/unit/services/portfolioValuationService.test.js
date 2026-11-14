const { Prisma } = require("@prisma/client");
const { calculatePortfolioValuation } = require("../../../src/services/portfolioValuationService");

describe("portfolioValuationService unit tests", () => {
  const portfolioId = "11111111-1111-4111-8111-111111111111";

  test("throws PORTFOLIO_NOT_FOUND when portfolio does not exist", async () => {
    const mockClient = {
      portfolio: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
    };

    await expect(
      calculatePortfolioValuation(portfolioId, { client: mockClient }),
    ).rejects.toMatchObject({
      code: "PORTFOLIO_NOT_FOUND",
      statusCode: 404,
    });
  });

  test("calculates valuation correctly when portfolio has zero holdings", async () => {
    const mockClient = {
      portfolio: {
        findUnique: jest.fn().mockResolvedValue({
          id: portfolioId,
          cashBalance: new Prisma.Decimal("5000"),
          startingBalance: new Prisma.Decimal("10000"),
          isActive: true,
        }),
      },
      holding: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };

    const result = await calculatePortfolioValuation(portfolioId, { client: mockClient });

    expect(result.cashBalance.toString()).toBe("5000");
    expect(result.holdingsValue.toString()).toBe("0");
    expect(result.totalValue.toString()).toBe("5000");
    expect(result.holdings).toHaveLength(0);
  });

  test("calculates valuation correctly with multiple stock and crypto holdings", async () => {
    const mockClient = {
      portfolio: {
        findUnique: jest.fn().mockResolvedValue({
          id: portfolioId,
          cashBalance: new Prisma.Decimal("1000"),
          startingBalance: new Prisma.Decimal("10000"),
          isActive: true,
        }),
      },
      holding: {
        findMany: jest.fn().mockResolvedValue([
          {
            symbol: "AAPL",
            assetType: "STOCK",
            quantity: new Prisma.Decimal("10"),
          },
          {
            symbol: "BINANCE:BTCUSDT",
            assetType: "CRYPTO",
            quantity: new Prisma.Decimal("0.5"),
          },
        ]),
      },
    };

    const mockPriceProvider = {
      getQuote: jest.fn().mockImplementation(async (symbol) => {
        if (symbol === "AAPL") {
          return { price: "200" }; // 10 * 200 = 2000
        }
        if (symbol === "BINANCE:BTCUSDT") {
          return { price: "60000" }; // 0.5 * 60000 = 30000
        }
        throw new Error("Unknown symbol");
      }),
    };

    const result = await calculatePortfolioValuation(portfolioId, {
      client: mockClient,
      priceProvider: mockPriceProvider,
    });

    // 1000 cash + 2000 AAPL + 30000 BTC = 33000
    expect(result.cashBalance.toString()).toBe("1000");
    expect(result.holdingsValue.toString()).toBe("32000");
    expect(result.totalValue.toString()).toBe("33000");
    expect(result.holdings).toHaveLength(2);
  });

  test("never treats missing or failed quote as zero; throws MARKET_DATA_PROVIDER_UNAVAILABLE", async () => {
    const mockClient = {
      portfolio: {
        findUnique: jest.fn().mockResolvedValue({
          id: portfolioId,
          cashBalance: new Prisma.Decimal("1000"),
          isActive: true,
        }),
      },
      holding: {
        findMany: jest.fn().mockResolvedValue([
          {
            symbol: "FAILING",
            assetType: "STOCK",
            quantity: new Prisma.Decimal("5"),
          },
        ]),
      },
    };

    const mockPriceProvider = {
      getQuote: jest.fn().mockRejectedValue(new Error("Network connection timeout")),
    };

    await expect(
      calculatePortfolioValuation(portfolioId, {
        client: mockClient,
        priceProvider: mockPriceProvider,
      }),
    ).rejects.toMatchObject({
      code: "MARKET_DATA_PROVIDER_UNAVAILABLE",
      statusCode: 503,
    });
  });

  test("deterministic test: uses historical price/close as of requested date, not live quote", async () => {
    const mockClient = {
      portfolio: {
        findUnique: jest.fn().mockResolvedValue({
          id: portfolioId,
          cashBalance: new Prisma.Decimal("500"),
          startingBalance: new Prisma.Decimal("10000"),
          isActive: true,
        }),
      },
      holding: {
        findMany: jest.fn().mockResolvedValue([
          {
            symbol: "AAPL",
            assetType: "STOCK",
            quantity: new Prisma.Decimal("10"),
          },
        ]),
      },
    };

    const targetHistoricalDate = new Date("2026-11-13T23:59:59.999Z");

    const mockPriceProvider = {
      getHistoricalPrice: jest.fn().mockResolvedValue({
        symbol: "AAPL",
        price: "180.00", // Yesterday's EOD close
        timestamp: "2026-11-13T20:00:00.000Z",
      }),
      getQuote: jest.fn().mockResolvedValue({
        symbol: "AAPL",
        price: "250.00", // Today's live quote
        timestamp: Date.now(),
      }),
    };

    const result = await calculatePortfolioValuation(portfolioId, {
      client: mockClient,
      priceProvider: mockPriceProvider,
      asOf: targetHistoricalDate,
    });

    // Proves getHistoricalPrice was called with the exact historical timestamp
    expect(mockPriceProvider.getHistoricalPrice).toHaveBeenCalledWith(
      "AAPL",
      expect.objectContaining({
        asOf: targetHistoricalDate,
        assetClass: "STOCK",
      }),
    );

    // Proves live getQuote was NOT called
    expect(mockPriceProvider.getQuote).not.toHaveBeenCalled();

    // 500 cash + (10 shares * $180 historical close) = $2,300, NOT 500 + (10 * 250) = $3,000
    expect(result.holdingsValue.toString()).toBe("1800");
    expect(result.totalValue.toString()).toBe("2300");
    expect(result.holdings[0].price.toString()).toBe("180");
  });

  test("deterministic test: extracts candle close on or before asOf when using getHistoricalPrices", async () => {
    const mockClient = {
      portfolio: {
        findUnique: jest.fn().mockResolvedValue({
          id: portfolioId,
          cashBalance: new Prisma.Decimal("0"),
          isActive: true,
        }),
      },
      holding: {
        findMany: jest.fn().mockResolvedValue([
          {
            symbol: "MSFT",
            assetType: "STOCK",
            quantity: new Prisma.Decimal("2"),
          },
        ]),
      },
    };

    const targetHistoricalDate = new Date("2026-11-13T23:59:59.999Z");

    const mockPriceProvider = {
      getHistoricalPrices: jest.fn().mockResolvedValue({
        symbol: "MSFT",
        assetClass: "STOCK",
        interval: "1d",
        prices: [
          {
            timestamp: "2026-11-12T20:00:00.000Z",
            close: "410.00",
          },
          {
            timestamp: "2026-11-13T20:00:00.000Z",
            close: "420.00", // Target date close
          },
          {
            timestamp: "2026-11-14T14:00:00.000Z",
            close: "450.00", // Subsequent intraday quote after target date
          },
        ],
      }),
      getQuote: jest.fn().mockResolvedValue({ price: "500.00" }),
    };

    const result = await calculatePortfolioValuation(portfolioId, {
      client: mockClient,
      priceProvider: mockPriceProvider,
      asOf: targetHistoricalDate,
    });

    expect(mockPriceProvider.getHistoricalPrices).toHaveBeenCalledWith(
      "MSFT",
      expect.objectContaining({
        interval: "1d",
        assetClass: "STOCK",
      }),
    );

    // Valued using 420.00 (the close on or before 2026-11-14T23:59:59.999Z), NOT 450 or 500
    expect(result.holdingsValue.toString()).toBe("840");
    expect(result.totalValue.toString()).toBe("840");
    expect(result.holdings[0].price.toString()).toBe("420");
    expect(mockPriceProvider.getQuote).not.toHaveBeenCalled();
  });
});

