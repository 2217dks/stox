jest.mock("../../../src/config/database", () => ({
  user: { findUnique: jest.fn() },
  portfolio: { findFirst: jest.fn() },
  holding: { aggregate: jest.fn() },
}));

jest.mock("../../../src/services/cacheService", () => ({
  getOrSetPortfolioSummary: jest.fn(),
  invalidatePortfolio: jest.fn().mockResolvedValue(1),
}));

const { Prisma } = require("@prisma/client");
const prisma = require("../../../src/config/database");
const cacheService = require("../../../src/services/cacheService");
const portfolioService = require("../../../src/services/portfolioService");

const USER_ID = "11111111-1111-4111-8111-111111111111";
const PORTFOLIO_ID = "22222222-2222-4222-8222-222222222222";
const CREATED_AT = new Date("2026-01-01T00:00:00.000Z");

function mockActiveUser() {
  prisma.user.findUnique.mockResolvedValue({
    id: USER_ID,
    isSuspended: false,
  });
}

function mockPortfolio(cashBalance = "10000", reservedCash = "0") {
  prisma.portfolio.findFirst.mockResolvedValue({
    id: PORTFOLIO_ID,
    userId: USER_ID,
    name: "Main Portfolio",
    description: null,
    startingBalance: new Prisma.Decimal("10000"),
    cashBalance: new Prisma.Decimal(cashBalance),
    reservedCash: new Prisma.Decimal(reservedCash),
    isDefault: true,
    isActive: true,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockActiveUser();

  cacheService.getOrSetPortfolioSummary.mockImplementation(
    (_portfolioId, loader) => loader(),
  );
});

describe("getPortfolioSummary", () => {
  test("returns a zero holdings summary for an empty portfolio", async () => {
    mockPortfolio("123.45", "0");
    prisma.holding.aggregate.mockResolvedValue({
      _count: 0,
      _sum: { totalInvested: null },
    });

    const summary = await portfolioService.getPortfolioSummary(
      USER_ID,
      PORTFOLIO_ID,
    );

    expect(summary.cashBalance).toBe("123.45");
    expect(summary.reservedCash).toBe("0");
    expect(summary.availableCash).toBe("123.45");
    expect(summary.holdingsValue).toBe("0");
    expect(summary.totalValue).toBe("123.45");
    expect(summary.holdingsCount).toBe(0);

    expect(prisma.holding.aggregate).toHaveBeenCalledWith({
      where: { portfolioId: PORTFOLIO_ID },
      _count: true,
      _sum: { totalInvested: true },
    });
  });

  test("adds decimal cash and holdings values without floating-point loss", async () => {
    mockPortfolio("0.10000001", "0.00000001");
    prisma.holding.aggregate.mockResolvedValue({
      _count: 2,
      _sum: { totalInvested: new Prisma.Decimal("0.20000002") },
    });

    const summary = await portfolioService.getPortfolioSummary(
      USER_ID,
      PORTFOLIO_ID,
    );

    expect(summary.cashBalance).toBe("0.10000001");
    expect(new Prisma.Decimal(summary.reservedCash).toFixed(8)).toBe(
      "0.00000001",
    );
    expect(summary.availableCash).toBe("0.1");
    expect(summary.holdingsValue).toBe("0.20000002");
    expect(summary.totalValue).toBe("0.30000003");
    expect(summary.holdingsCount).toBe(2);

    expect(typeof summary.cashBalance).toBe("string");
    expect(typeof summary.reservedCash).toBe("string");
    expect(typeof summary.availableCash).toBe("string");
    expect(typeof summary.holdingsValue).toBe("string");
    expect(typeof summary.totalValue).toBe("string");
  });

  test("scopes portfolio lookup to the authenticated owner", async () => {
    mockPortfolio();
    prisma.holding.aggregate.mockResolvedValue({
      _count: 0,
      _sum: { totalInvested: null },
    });

    await portfolioService.getPortfolioSummary(USER_ID, PORTFOLIO_ID);

    expect(prisma.portfolio.findFirst).toHaveBeenCalledWith({
      where: { id: PORTFOLIO_ID, userId: USER_ID },
    });
  });

  test("returns PORTFOLIO_NOT_FOUND for missing or foreign portfolios", async () => {
    prisma.portfolio.findFirst.mockResolvedValue(null);

    await expect(
      portfolioService.getPortfolioSummary(USER_ID, PORTFOLIO_ID),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: "PORTFOLIO_NOT_FOUND",
    });

    expect(prisma.holding.aggregate).not.toHaveBeenCalled();
  });

  test("returns the cached summary after checking ownership", async () => {
    mockPortfolio();

    const cachedSummary = {
      id: PORTFOLIO_ID,
      cashBalance: "10000",
      reservedCash: "0",
      availableCash: "10000",
      holdingsValue: "2500",
      totalValue: "12500",
      holdingsCount: 1,
    };

    cacheService.getOrSetPortfolioSummary.mockResolvedValue(cachedSummary);

    const summary = await portfolioService.getPortfolioSummary(
      USER_ID,
      PORTFOLIO_ID,
    );

    expect(summary).toEqual(cachedSummary);

    expect(prisma.portfolio.findFirst).toHaveBeenCalledWith({
      where: {
        id: PORTFOLIO_ID,
        userId: USER_ID,
      },
    });

    expect(cacheService.getOrSetPortfolioSummary).toHaveBeenCalledWith(
      PORTFOLIO_ID,
      expect.any(Function),
    );

    expect(prisma.holding.aggregate).not.toHaveBeenCalled();
  });
});
