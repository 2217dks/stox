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
});
