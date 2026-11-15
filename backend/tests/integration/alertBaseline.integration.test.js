jest.mock("../../src/services/marketData", () => ({
  getQuote: jest.fn(),
}));

const request = require("supertest");

const app = require("../../src/app");
const prisma = require("../../src/config/database");
const marketData = require("../../src/services/marketData");

const timestamp = Date.now();
const testSymbol = `BLN${timestamp}`.toUpperCase();

const user = {
  name: "Alert Baseline User",
  email: `alert-baseline-${timestamp}@example.com`,
  password: "IntegrationTest#2026",
};

let userId;
let accessToken;
let symbolId;

beforeAll(async () => {
  jest.setTimeout(15000);

  const symbol = await prisma.symbol.create({
    data: {
      symbol: testSymbol,
      name: "Alert Baseline Test Symbol",
      assetType: "STOCK",
      exchange: "TEST",
    },
  });

  symbolId = symbol.id;

  const registration = await request(app)
    .post("/api/v1/auth/register")
    .send(user);

  expect([200, 201]).toContain(registration.status);
  userId = registration.body.data.user.id;
  accessToken = registration.body.data.accessToken;
});

afterAll(async () => {
  try {
    if (userId) {
      await prisma.user.deleteMany({ where: { id: userId } });
    }

    if (symbolId) {
      await prisma.alert.deleteMany({ where: { symbolId } });
      await prisma.symbol.deleteMany({ where: { id: symbolId } });
    }
  } finally {
    await prisma.$disconnect();
  }
});

describe("Alert percentage baselines", () => {
  beforeEach(() => {
    marketData.getQuote.mockReset();
  });

  test("captures the request-time quote for a percentage alert", async () => {
    marketData.getQuote.mockResolvedValue({
      symbol: testSymbol,
      price: "190.25",
    });

    const response = await request(app)
      .post("/api/v1/alerts")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        symbol: testSymbol,
        assetType: "STOCK",
        condition: "PERCENT_CHANGE_UP",
        targetPrice: "5",
      });

    expect(response.status).toBe(201);
    expect(marketData.getQuote).toHaveBeenCalledWith(testSymbol, {
      assetClass: "STOCK",
    });

    const { alert } = response.body.data;
    expect(alert.baselinePrice).toBe("190.25");
    expect(alert.baselineAt).toBeTruthy();

    const saved = await prisma.alert.findUnique({ where: { id: alert.id } });
    expect(saved.baselinePrice.toString()).toBe("190.25");
    expect(saved.baselineAt).toBeInstanceOf(Date);
  });

  test("does not fetch a quote for an absolute price alert", async () => {
    const response = await request(app)
      .post("/api/v1/alerts")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        symbol: testSymbol,
        assetType: "STOCK",
        condition: "PRICE_ABOVE",
        targetPrice: "250",
      });

    expect(response.status).toBe(201);
    expect(marketData.getQuote).not.toHaveBeenCalled();
    expect(response.body.data.alert.baselinePrice).toBeNull();
    expect(response.body.data.alert.baselineAt).toBeNull();
  });

  test("fails instead of creating an alert with an unknown baseline", async () => {
    marketData.getQuote.mockRejectedValue(
      Object.assign(new Error("provider unavailable"), {
        statusCode: 503,
        code: "MARKET_DATA_PROVIDER_UNAVAILABLE",
        isOperational: true,
      }),
    );

    const response = await request(app)
      .post("/api/v1/alerts")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        symbol: testSymbol,
        assetType: "STOCK",
        condition: "PERCENT_CHANGE_DOWN",
        targetPrice: "5",
      });

    expect(response.status).toBe(503);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe(
      "MARKET_DATA_PROVIDER_UNAVAILABLE",
    );

    const count = await prisma.alert.count({
      where: {
        userId,
        condition: "PERCENT_CHANGE_DOWN",
      },
    });

    expect(count).toBe(0);
  });

  test("captures a baseline when an alert switches to a percentage condition", async () => {
    const created = await request(app)
      .post("/api/v1/alerts")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        symbol: testSymbol,
        assetType: "STOCK",
        condition: "PRICE_ABOVE",
        targetPrice: "250",
      });

    marketData.getQuote.mockResolvedValue({
      symbol: testSymbol,
      price: "200",
    });

    const response = await request(app)
      .patch(`/api/v1/alerts/${created.body.data.alert.id}`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ condition: "PERCENT_CHANGE_UP", targetPrice: "5" });

    expect(response.status).toBe(200);
    expect(response.body.data.alert.baselinePrice).toBe("200");
    expect(response.body.data.alert.baselineAt).toBeTruthy();
  });

  test("clears the baseline when an alert leaves a percentage condition", async () => {
    marketData.getQuote.mockResolvedValue({
      symbol: testSymbol,
      price: "200",
    });

    const created = await request(app)
      .post("/api/v1/alerts")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        symbol: testSymbol,
        assetType: "STOCK",
        condition: "PERCENT_CHANGE_UP",
        targetPrice: "5",
      });

    const response = await request(app)
      .patch(`/api/v1/alerts/${created.body.data.alert.id}`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ condition: "PRICE_ABOVE", targetPrice: "250" });

    expect(response.status).toBe(200);
    expect(response.body.data.alert.baselinePrice).toBeNull();
    expect(response.body.data.alert.baselineAt).toBeNull();
  });
});
