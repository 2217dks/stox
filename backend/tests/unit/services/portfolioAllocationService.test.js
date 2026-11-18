const { Prisma } = require("@prisma/client");
const { getPortfolioAllocation, reconcilePercentages } = require("../../../src/services/portfolioAllocationService");

describe("Portfolio Allocation Service (Task 37.4)", () => {
  const userId = "usr-alloc-1";
  const portfolioId = "port-alloc-1";

  let mockClient;
  let mockMarketData;

  beforeEach(() => {
    mockClient = {
      portfolio: {
        findFirst: jest.fn(),
      },
      holding: {
        findMany: jest.fn(),
      },
    };

    mockMarketData = {
      getQuote: jest.fn(),
    };
  });

  test("throws 404 when portfolio is not owned by user", async () => {
    mockClient.portfolio.findFirst.mockResolvedValue(null);

    await expect(
      getPortfolioAllocation(userId, portfolioId, { client: mockClient }),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: "PORTFOLIO_NOT_FOUND",
    });
  });

  test("throws 400 when an invalid dimension is provided", async () => {
    mockClient.portfolio.findFirst.mockResolvedValue({
      id: portfolioId,
      userId,
    });

    await expect(
      getPortfolioAllocation(userId, portfolioId, {
        dimension: "invalid_dim",
        client: mockClient,
      }),
    ).rejects.toMatchObject({
      statusCode: 400,
      code: "INVALID_ALLOCATION_DIMENSION",
    });
  });

  test("calculates symbol allocation, incorporates cash, and reconciles percentages to exactly 100.0000%", async () => {
    mockClient.portfolio.findFirst.mockResolvedValue({
      id: portfolioId,
      name: "Diversified Tech",
      cashBalance: new Prisma.Decimal("2500.00000000"),
    });

    // 2 holdings: AAPL (10 @ 150 = 1500) and MSFT (20 @ 300 = 6000)
    // Cash = 2500
    // Total = 10000
    mockClient.holding.findMany.mockResolvedValue([
      {
        id: "h-1",
        symbol: "AAPL",
        assetType: "STOCK",
        quantity: new Prisma.Decimal("10.00000000"),
        averageBuyPrice: new Prisma.Decimal("140.00000000"),
        totalInvested: new Prisma.Decimal("1400.00000000"),
      },
      {
        id: "h-2",
        symbol: "MSFT",
        assetType: "STOCK",
        quantity: new Prisma.Decimal("20.00000000"),
        averageBuyPrice: new Prisma.Decimal("280.00000000"),
        totalInvested: new Prisma.Decimal("5600.00000000"),
      },
    ]);

    mockMarketData.getQuote.mockImplementation(async (symbol) => {
      if (symbol === "AAPL") return { symbol: "AAPL", price: "150.00000000" };
      if (symbol === "MSFT") return { symbol: "MSFT", price: "300.00000000" };
      return null;
    });

    const result = await getPortfolioAllocation(userId, portfolioId, {
      dimension: "symbol",
      marketDataProvider: mockMarketData,
      client: mockClient,
    });

    expect(result.portfolioId).toBe(portfolioId);
    expect(result.dimension).toBe("symbol");
    expect(result.totalPortfolioValue).toBe("10000.00000000");
    expect(result.cashBalance).toBe("2500.00000000");
    expect(result.holdingsValue).toBe("7500.00000000");
    expect(result.holdingsCount).toBe(2);

    // Sorted descending by value: MSFT (6000, 60%), CASH (2500, 25%), AAPL (1500, 15%)
    expect(result.allocations).toHaveLength(3);

    expect(result.allocations[0].key).toBe("MSFT");
    expect(result.allocations[0].value).toBe("6000.00000000");
    expect(result.allocations[0].percentage).toBe("60.0000");
    expect(result.allocations[0].priceSource).toBe("live");
    expect(result.allocations[0].isPriceEstimated).toBe(false);

    expect(result.allocations[1].key).toBe("CASH");
    expect(result.allocations[1].value).toBe("2500.00000000");
    expect(result.allocations[1].percentage).toBe("25.0000");

    expect(result.allocations[2].key).toBe("AAPL");
    expect(result.allocations[2].value).toBe("1500.00000000");
    expect(result.allocations[2].percentage).toBe("15.0000");

    // Reconciliation check
    expect(result.reconciliation.totalPercentage).toBe("100.0000");
    expect(result.reconciliation.isReconciled).toBe(true);
  });

  test("falls back to cost basis when live market price is missing or fails", async () => {
    mockClient.portfolio.findFirst.mockResolvedValue({
      id: portfolioId,
      name: "Fallback Test",
      cashBalance: new Prisma.Decimal("1000.00000000"),
    });

    mockClient.holding.findMany.mockResolvedValue([
      {
        id: "h-3",
        symbol: "UNLISTED",
        assetType: "STOCK",
        quantity: new Prisma.Decimal("10.00000000"),
        averageBuyPrice: new Prisma.Decimal("50.00000000"),
        totalInvested: new Prisma.Decimal("500.00000000"),
      },
    ]);

    mockMarketData.getQuote.mockRejectedValue(new Error("Market quote not available"));

    const result = await getPortfolioAllocation(userId, portfolioId, {
      dimension: "symbol",
      marketDataProvider: mockMarketData,
      client: mockClient,
    });

    expect(result.totalPortfolioValue).toBe("1500.00000000");
    const unlisted = result.allocations.find((a) => a.key === "UNLISTED");
    expect(unlisted).toBeDefined();
    expect(unlisted.priceSource).toBe("cost_basis");
    expect(unlisted.isPriceEstimated).toBe(true);
    expect(unlisted.value).toBe("500.00000000");
    expect(result.reconciliation.totalPercentage).toBe("100.0000");
  });

  test("calculates asset dimension allocation grouping STOCK, CRYPTO, and CASH", async () => {
    mockClient.portfolio.findFirst.mockResolvedValue({
      id: portfolioId,
      name: "Multi-Asset",
      cashBalance: new Prisma.Decimal("1000.00000000"),
    });

    mockClient.holding.findMany.mockResolvedValue([
      {
        id: "h-s1",
        symbol: "AAPL",
        assetType: "STOCK",
        quantity: new Prisma.Decimal("10.00000000"),
        averageBuyPrice: new Prisma.Decimal("100.00000000"),
        totalInvested: new Prisma.Decimal("1000.00000000"),
      },
      {
        id: "h-c1",
        symbol: "BTC",
        assetType: "CRYPTO",
        quantity: new Prisma.Decimal("0.10000000"),
        averageBuyPrice: new Prisma.Decimal("20000.00000000"),
        totalInvested: new Prisma.Decimal("2000.00000000"),
      },
    ]);

    mockMarketData.getQuote.mockImplementation(async (symbol) => {
      if (symbol === "AAPL") return { symbol: "AAPL", price: "100.00000000" };
      if (symbol === "BTC") return { symbol: "BTC", price: "20000.00000000" };
      return null;
    });

    const result = await getPortfolioAllocation(userId, portfolioId, {
      dimension: "asset",
      marketDataProvider: mockMarketData,
      client: mockClient,
    });

    expect(result.dimension).toBe("asset");
    // Total = 1000 (stock) + 2000 (crypto) + 1000 (cash) = 4000
    expect(result.totalPortfolioValue).toBe("4000.00000000");

    const cryptoBucket = result.allocations.find((a) => a.key === "CRYPTO");
    expect(cryptoBucket.percentage).toBe("50.0000");

    const stockBucket = result.allocations.find((a) => a.key === "STOCK");
    expect(stockBucket.percentage).toBe("25.0000");

    const cashBucket = result.allocations.find((a) => a.key === "CASH");
    expect(cashBucket.percentage).toBe("25.0000");

    expect(result.reconciliation.totalPercentage).toBe("100.0000");
  });

  test("handles zero-value portfolio gracefully without dividing by zero", async () => {
    mockClient.portfolio.findFirst.mockResolvedValue({
      id: portfolioId,
      name: "Zero Portfolio",
      cashBalance: new Prisma.Decimal("0.00000000"),
    });

    mockClient.holding.findMany.mockResolvedValue([]);

    const result = await getPortfolioAllocation(userId, portfolioId, {
      dimension: "symbol",
      marketDataProvider: mockMarketData,
      client: mockClient,
    });

    expect(result.totalPortfolioValue).toBe("0.00000000");
    expect(result.allocations[0].percentage).toBe("0.0000");
    expect(result.reconciliation.totalPercentage).toBe("0.0000");
    expect(result.reconciliation.isReconciled).toBe(true);
  });

  test("clearly communicates estimated allocation and marks reconciliation as estimated when quotes fall back to cost basis", async () => {
    mockClient.portfolio.findFirst.mockResolvedValue({
      id: portfolioId,
      name: "Mixed Pricing Portfolio",
      cashBalance: new Prisma.Decimal("2000.00000000"),
    });

    mockClient.holding.findMany.mockResolvedValue([
      {
        id: "h-live",
        symbol: "AAPL",
        assetType: "STOCK",
        quantity: new Prisma.Decimal("10.00000000"),
        averageBuyPrice: new Prisma.Decimal("150.00000000"),
        totalInvested: new Prisma.Decimal("1500.00000000"),
      },
      {
        id: "h-est",
        symbol: "PRIVATE_EQUITY",
        assetType: "STOCK",
        quantity: new Prisma.Decimal("5.00000000"),
        averageBuyPrice: new Prisma.Decimal("200.00000000"),
        totalInvested: new Prisma.Decimal("1000.00000000"),
      },
    ]);

    mockMarketData.getQuote.mockImplementation(async (symbol) => {
      if (symbol === "AAPL") return { symbol: "AAPL", price: "180.00000000" };
      throw new Error("Quote unavailable for PRIVATE_EQUITY");
    });

    const result = await getPortfolioAllocation(userId, portfolioId, {
      dimension: "symbol",
      marketDataProvider: mockMarketData,
      client: mockClient,
    });

    // Root-level estimation indicators
    expect(result.isEstimated).toBe(true);
    expect(result.valuationMethod).toBe("estimated");
    expect(result.pricingSummary).toEqual({
      totalHoldings: 2,
      liveQuotes: 1,
      estimatedQuotes: 1,
      hasEstimatedPrices: true,
    });

    // Reconciliation block must not imply live market valuation
    expect(result.reconciliation.isEstimated).toBe(true);
    expect(result.reconciliation.valuationMethod).toBe("estimated");
    expect(result.reconciliation.totalPercentage).toBe("100.0000");

    // AAPL is live, PRIVATE_EQUITY is estimated
    const aapl = result.allocations.find((a) => a.key === "AAPL");
    expect(aapl.priceSource).toBe("live");
    expect(aapl.isPriceEstimated).toBe(false);

    const privateEq = result.allocations.find((a) => a.key === "PRIVATE_EQUITY");
    expect(privateEq.priceSource).toBe("cost_basis");
    expect(privateEq.isPriceEstimated).toBe(true);

    const cash = result.allocations.find((a) => a.key === "CASH");
    expect(cash.priceSource).toBe("portfolio");
    expect(cash.isPriceEstimated).toBe(false);
  });

  test("communicates estimation in asset dimension when an asset category contains fallback cost basis", async () => {
    mockClient.portfolio.findFirst.mockResolvedValue({
      id: portfolioId,
      name: "Mixed Asset Portfolio",
      cashBalance: new Prisma.Decimal("1000.00000000"),
    });

    mockClient.holding.findMany.mockResolvedValue([
      {
        id: "h-stock",
        symbol: "AAPL",
        assetType: "STOCK",
        quantity: new Prisma.Decimal("10.00000000"),
        averageBuyPrice: new Prisma.Decimal("100.00000000"),
        totalInvested: new Prisma.Decimal("1000.00000000"),
      },
      {
        id: "h-crypto",
        symbol: "OBSCURE_COIN",
        assetType: "CRYPTO",
        quantity: new Prisma.Decimal("100.00000000"),
        averageBuyPrice: new Prisma.Decimal("10.00000000"),
        totalInvested: new Prisma.Decimal("1000.00000000"),
      },
    ]);

    mockMarketData.getQuote.mockImplementation(async (symbol) => {
      if (symbol === "AAPL") return { symbol: "AAPL", price: "120.00000000" };
      throw new Error("No live price for OBSCURE_COIN");
    });

    const result = await getPortfolioAllocation(userId, portfolioId, {
      dimension: "asset",
      marketDataProvider: mockMarketData,
      client: mockClient,
    });

    expect(result.isEstimated).toBe(true);
    expect(result.valuationMethod).toBe("estimated");
    expect(result.reconciliation.isEstimated).toBe(true);
    expect(result.reconciliation.valuationMethod).toBe("estimated");

    const cryptoBucket = result.allocations.find((a) => a.key === "CRYPTO");
    expect(cryptoBucket.hasEstimatedPrice).toBe(true);
    expect(cryptoBucket.isPriceEstimated).toBe(true);

    const stockBucket = result.allocations.find((a) => a.key === "STOCK");
    expect(stockBucket.hasEstimatedPrice).toBe(false);
    expect(stockBucket.isPriceEstimated).toBe(false);
  });

  test("does not treat positive stale quote as live price and marks allocation estimated (symbol dimension)", async () => {
    mockClient.portfolio.findFirst.mockResolvedValue({
      id: portfolioId,
      name: "Stale Quote Test",
      cashBalance: new Prisma.Decimal("1000.00000000"),
    });

    mockClient.holding.findMany.mockResolvedValue([
      {
        id: "h-stale",
        symbol: "STALE_STOCK",
        assetType: "STOCK",
        quantity: new Prisma.Decimal("10.00000000"),
        averageBuyPrice: new Prisma.Decimal("100.00000000"),
        totalInvested: new Prisma.Decimal("1000.00000000"),
      },
      {
        id: "h-fresh",
        symbol: "FRESH_STOCK",
        assetType: "STOCK",
        quantity: new Prisma.Decimal("10.00000000"),
        averageBuyPrice: new Prisma.Decimal("50.00000000"),
        totalInvested: new Prisma.Decimal("500.00000000"),
      },
    ]);

    // Positive price but isStale: true
    mockMarketData.getQuote.mockImplementation(async (symbol) => {
      if (symbol === "STALE_STOCK") {
        return {
          symbol: "STALE_STOCK",
          price: "180.00000000",
          isStale: true,
          freshness: "STALE",
          ageSeconds: 400,
        };
      }
      if (symbol === "FRESH_STOCK") {
        return {
          symbol: "FRESH_STOCK",
          price: "60.00000000",
          isStale: false,
          freshness: "FRESH",
          ageSeconds: 10,
        };
      }
      return null;
    });

    const result = await getPortfolioAllocation(userId, portfolioId, {
      dimension: "symbol",
      marketDataProvider: mockMarketData,
      client: mockClient,
    });

    // 1. Verify stale quote is not classified as live price and is marked estimated
    const staleItem = result.allocations.find((a) => a.key === "STALE_STOCK");
    expect(staleItem).toBeDefined();
    expect(staleItem.priceSource).not.toBe("live");
    expect(staleItem.priceSource).toBe("cost_basis");
    expect(staleItem.isPriceEstimated).toBe(true);
    expect(staleItem.price).toBe("100.00000000"); // fell back to avgBuyPrice

    // 2. Verify fresh quote continues to be classified as live
    const freshItem = result.allocations.find((a) => a.key === "FRESH_STOCK");
    expect(freshItem).toBeDefined();
    expect(freshItem.priceSource).toBe("live");
    expect(freshItem.isPriceEstimated).toBe(false);
    expect(freshItem.price).toBe("60.00000000");

    // 3. Verify root-level isEstimated, pricingSummary, and reconciliation remain consistent
    expect(result.isEstimated).toBe(true);
    expect(result.valuationMethod).toBe("estimated");
    expect(result.pricingSummary).toEqual({
      totalHoldings: 2,
      liveQuotes: 1,
      estimatedQuotes: 1,
      hasEstimatedPrices: true,
    });
    expect(result.reconciliation.isEstimated).toBe(true);
    expect(result.reconciliation.valuationMethod).toBe("estimated");
    expect(result.reconciliation.isReconciled).toBe(true);
  });

  test("does not treat positive stale quote as live price in asset dimension", async () => {
    mockClient.portfolio.findFirst.mockResolvedValue({
      id: portfolioId,
      name: "Stale Asset Dimension",
      cashBalance: new Prisma.Decimal("500.00000000"),
    });

    mockClient.holding.findMany.mockResolvedValue([
      {
        id: "h-crypto-stale",
        symbol: "BTC",
        assetType: "CRYPTO",
        quantity: new Prisma.Decimal("1.00000000"),
        averageBuyPrice: new Prisma.Decimal("50000.00000000"),
        totalInvested: new Prisma.Decimal("50000.00000000"),
      },
    ]);

    mockMarketData.getQuote.mockResolvedValue({
      symbol: "BTC",
      price: "65000.00000000",
      isStale: true,
      freshness: "STALE",
      ageSeconds: 120,
    });

    const result = await getPortfolioAllocation(userId, portfolioId, {
      dimension: "asset",
      marketDataProvider: mockMarketData,
      client: mockClient,
    });

    expect(result.isEstimated).toBe(true);
    expect(result.valuationMethod).toBe("estimated");
    expect(result.reconciliation.isEstimated).toBe(true);
    expect(result.reconciliation.valuationMethod).toBe("estimated");

    const cryptoBucket = result.allocations.find((a) => a.key === "CRYPTO");
    expect(cryptoBucket.hasEstimatedPrice).toBe(true);
    expect(cryptoBucket.isPriceEstimated).toBe(true);
    expect(cryptoBucket.value).toBe("50000.00000000"); // fell back to avgBuyPrice
  });
});
