const request = require("supertest");

const app = require("../../src/app");
const prisma = require("../../src/config/database");

const timestamp = Date.now();

const user1 = {
  name: "Portfolio Integration User 1",
  email: `portfolio-integration-1-${timestamp}@example.com`,
  password: "IntegrationTest#2026",
};

const user2 = {
  name: "Portfolio Integration User 2",
  email: `portfolio-integration-2-${timestamp}@example.com`,
  password: "IntegrationTest#2026",
};

let user1Id;
let user2Id;

let user1AccessToken;
let user2AccessToken;

let user1MainPortfolioId;
let user1TestPortfolioId;
let user2MainPortfolioId;

beforeAll(async () => {
  jest.setTimeout(15000);

  const user1Registration = await request(app)
    .post("/api/v1/auth/register")
    .send(user1);

  expect([200, 201]).toContain(user1Registration.status);
  expect(user1Registration.body.success).toBe(true);

  user1Id = user1Registration.body.data.user.id;
  user1AccessToken = user1Registration.body.data.accessToken;

  const user2Registration = await request(app)
    .post("/api/v1/auth/register")
    .send(user2);

  expect([200, 201]).toContain(user2Registration.status);
  expect(user2Registration.body.success).toBe(true);

  user2Id = user2Registration.body.data.user.id;
  user2AccessToken = user2Registration.body.data.accessToken;

  const user1MainPortfolio = await prisma.portfolio.findFirst({
    where: {
      userId: user1Id,
      isDefault: true,
    },
  });

  const user2MainPortfolio = await prisma.portfolio.findFirst({
    where: {
      userId: user2Id,
      isDefault: true,
    },
  });

  expect(user1MainPortfolio).not.toBeNull();
  expect(user2MainPortfolio).not.toBeNull();

  user1MainPortfolioId = user1MainPortfolio.id;
  user2MainPortfolioId = user2MainPortfolio.id;
});

afterAll(async () => {
  await prisma.user.deleteMany({
    where: {
      id: {
        in: [user1Id, user2Id].filter(Boolean),
      },
    },
  });

  await prisma.$disconnect();
});

describe("Portfolio integration API", () => {
  test("rejects unauthenticated portfolio requests", async () => {
    const response = await request(app).get("/api/v1/portfolios");

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("UNAUTHORIZED");
  });

  test("creates a portfolio through the API", async () => {
    const response = await request(app)
      .post("/api/v1/portfolios")
      .set("Authorization", `Bearer ${user1AccessToken}`)
      .send({
        name: "Integration Test Portfolio",
        description: "Portfolio created by integration test",
      });

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);

    const portfolio = response.body.data.portfolio;

    expect(portfolio).toBeDefined();
    expect(portfolio.userId).toBe(user1Id);
    expect(portfolio.name).toBe("Integration Test Portfolio");
    expect(portfolio.description).toBe("Portfolio created by integration test");
    expect(portfolio.startingBalance).toBe("10000");
    expect(portfolio.cashBalance).toBe("10000");
    expect(portfolio.isDefault).toBe(false);
    expect(portfolio.isActive).toBe(true);

    user1TestPortfolioId = portfolio.id;

    const savedPortfolio = await prisma.portfolio.findUnique({
      where: {
        id: user1TestPortfolioId,
      },
    });

    expect(savedPortfolio).not.toBeNull();
    expect(savedPortfolio.userId).toBe(user1Id);
  });

  test("lists only the authenticated user's portfolios", async () => {
    const response = await request(app)
      .get("/api/v1/portfolios")
      .set("Authorization", `Bearer ${user1AccessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);

    const portfolios = response.body.data.portfolios;

    expect(Array.isArray(portfolios)).toBe(true);

    const portfolioIds = portfolios.map((portfolio) => portfolio.id);

    expect(portfolioIds).toContain(user1MainPortfolioId);
    expect(portfolioIds).toContain(user1TestPortfolioId);

    for (const portfolio of portfolios) {
      expect(portfolio.userId).toBe(user1Id);
    }

    expect(portfolioIds).not.toContain(user2MainPortfolioId);
  });

  test("returns holdings belonging to the requested portfolio", async () => {
    await prisma.holding.createMany({
      data: [
        {
          portfolioId: user1TestPortfolioId,
          symbol: "AAPL",
          assetType: "STOCK",
          quantity: "10",
          averageBuyPrice: "175.50000000",
          totalInvested: "1755.00000000",
          isShort: false,
        },
        {
          portfolioId: user1TestPortfolioId,
          symbol: "BTCUSDT",
          assetType: "CRYPTO",
          quantity: "0.5",
          averageBuyPrice: "59850",
          totalInvested: "29925",
          isShort: false,
        },
      ],
    });

    const response = await request(app)
      .get(`/api/v1/portfolios/${user1TestPortfolioId}/holdings`)
      .set("Authorization", `Bearer ${user1AccessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.portfolioId).toBe(user1TestPortfolioId);

    const holdings = response.body.data.holdings;

    expect(Array.isArray(holdings)).toBe(true);
    expect(holdings).toHaveLength(2);

    const aapl = holdings.find((holding) => holding.symbol === "AAPL");

    expect(aapl).toBeDefined();
    expect(aapl.portfolioId).toBe(user1TestPortfolioId);
    expect(aapl.quantity).toBe("10");
    expect(aapl.averageBuyPrice).toBe("175.5");
    expect(aapl.totalInvested).toBe("1755");
    expect(aapl.isShort).toBe(false);
  });

  test("returns the current portfolio cash balance", async () => {
    await prisma.portfolio.update({
      where: {
        id: user1TestPortfolioId,
      },
      data: {
        cashBalance: "7350.50000000",
      },
    });

    const response = await request(app)
      .get(`/api/v1/portfolios/${user1TestPortfolioId}/cash-balance`)
      .set("Authorization", `Bearer ${user1AccessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.portfolioId).toBe(user1TestPortfolioId);
    expect(response.body.data.cashBalance).toBe("7350.5");
  });

  test("prevents one user from accessing another user's holdings", async () => {
    const response = await request(app)
      .get(`/api/v1/portfolios/${user1MainPortfolioId}/holdings`)
      .set("Authorization", `Bearer ${user2AccessToken}`);

    expect(response.status).toBe(404);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("PORTFOLIO_NOT_FOUND");
  });

  test("prevents one user from accessing another user's cash balance", async () => {
    const response = await request(app)
      .get(`/api/v1/portfolios/${user1MainPortfolioId}/cash-balance`)
      .set("Authorization", `Bearer ${user2AccessToken}`);

    expect(response.status).toBe(404);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("PORTFOLIO_NOT_FOUND");
  });
});
