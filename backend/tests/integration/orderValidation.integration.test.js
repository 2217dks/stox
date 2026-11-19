const request = require("supertest");

const app = require("../../src/app");
const prisma = require("../../src/config/database");
const marketDataService = require("../../src/services/marketData");

// Black-box tests for order validation, exercised through the HTTP layer only.
// Contract invariants (docs/ERROR_HANDLING.md + docs/API.md + the repo-wide
// conventions established in validation.integration.test.js):
// - failures: { success: false, error: { code, message, details? } }
// - validation failures: 400 VALIDATION_ERROR, details = [{ path, message }]
// - identity before validity: bad/missing auth is 401 even with a bad body
// - exact messages are NOT asserted (copy may change; contract may not).
const timestamp = Date.now();

const validUser = {
  name: "Order Validation Test User",
  email: `order-validation-${timestamp}@stox.local`,
  password: "TestPassword123!",
};

let userId;
let accessToken;
let mainPortfolioId;
const createdOrderIds = [];
let getQuoteSpy;

// Second user, used to prove orders are invisible across accounts.
let userBId;
let userBAccessToken;
let userBOrderId;

beforeAll(async () => {
  jest.setTimeout(30000);

  getQuoteSpy = jest
    .spyOn(marketDataService, "getQuote")
    .mockResolvedValue({ price: "100" });

  const register = await request(app)
    .post("/api/v1/auth/register")
    .send(validUser);

  userId = register.body.data.user.id;
  accessToken = register.body.data.accessToken;

  const portfolios = await request(app)
    .get("/api/v1/portfolios")
    .set("Authorization", `Bearer ${accessToken}`);

  const mainPortfolio = portfolios.body.data.portfolios.find(
    (portfolio) => portfolio.isDefault,
  );
  mainPortfolioId = mainPortfolio.id;

  await prisma.holding.createMany({
    data: [
      {
        portfolioId: mainPortfolioId,
        symbol: `H${timestamp}2`,
        assetType: "STOCK",
        quantity: 10,
        averageBuyPrice: 100,
        totalInvested: 1000,
      },
      {
        portfolioId: mainPortfolioId,
        symbol: `C${timestamp}1`,
        assetType: "STOCK",
        quantity: 10,
        averageBuyPrice: 100,
        totalInvested: 1000,
      },
      {
        portfolioId: mainPortfolioId,
        symbol: `C${timestamp}3`,
        assetType: "STOCK",
        quantity: 10,
        averageBuyPrice: 100,
        totalInvested: 1000,
      },
      {
        portfolioId: mainPortfolioId,
        symbol: `C${timestamp}RACE`,
        assetType: "STOCK",
        quantity: 10,
        averageBuyPrice: 100,
        totalInvested: 1000,
      },
    ],
  });
});

afterAll(async () => {
  for (const orderId of createdOrderIds) {
    await prisma.order.delete({ where: { id: orderId } }).catch(() => {});
  }

  if (mainPortfolioId) {
    await prisma.holding.deleteMany({
      where: {
        portfolioId: mainPortfolioId,
        symbol: {
          in: [
            `H${timestamp}2`,
            `C${timestamp}1`,
            `C${timestamp}3`,
            `C${timestamp}RACE`,
          ],
        },
      },
    }).catch(() => {});
  }

  if (userBOrderId) {
    await prisma.order.delete({ where: { id: userBOrderId } }).catch(() => {});
  }

  if (userBId) {
    await prisma.user.delete({ where: { id: userBId } });
  }

  if (userId) {
    await prisma.user.delete({ where: { id: userId } });
  }

  getQuoteSpy?.mockRestore();

  await prisma.$disconnect();
});

function expectErrorEnvelope(body) {
  expect(body).toHaveProperty("success", false);
  expect(typeof body.error?.code).toBe("string");
  expect(body.error.code.length).toBeGreaterThan(0);
}

function expectValidationDetails(body) {
  expect(body.error.code).toBe("VALIDATION_ERROR");
  expect(Array.isArray(body.error.details)).toBe(true);
  expect(body.error.details.length).toBeGreaterThan(0);

  for (const issue of body.error.details) {
    expect(typeof issue.path).toBe("string");
    expect(typeof issue.message).toBe("string");
    expect(issue.message.length).toBeGreaterThan(0);
  }
}

function pathsOf(body) {
  return body.error.details.map((issue) => issue.path);
}

async function postOrder(body, token = accessToken) {
  const request_ = request(app).post("/api/v1/orders");

  if (token) {
    request_.set("Authorization", `Bearer ${token}`);
  }

  return request_.send(body);
}

describe("order creation validation (black-box via POST /orders)", () => {
  describe("middleware chain order (contract: identity before validity)", () => {
    test("missing token is 401 even with an invalid body", async () => {
      const response = await postOrder({ symbol: 123 }, null);

      expect(response.status).toBe(401);
      expectErrorEnvelope(response.body);
    });

    test("garbage token is 401 even with a valid body", async () => {
      const response = await request(app)
        .post("/api/v1/orders")
        .set("Authorization", "Bearer garbage.token.here")
        .send({
          portfolioId: mainPortfolioId,
          symbol: "AAPL",
          assetType: "STOCK",
          side: "BUY",
          quantity: "1",
        });

      expect(response.status).toBe(401);
      expectErrorEnvelope(response.body);
    });
  });

  describe("rejecting invalid payloads (contract: 400 VALIDATION_ERROR)", () => {
    const marketBase = () => ({
      portfolioId: mainPortfolioId,
      symbol: "AAPL",
      assetType: "STOCK",
      side: "BUY",
      quantity: "1.5",
    });

    test("empty body reports every missing field at once", async () => {
      const response = await postOrder({});

      expect(response.status).toBe(400);
      expectValidationDetails(response.body);

      const actualPaths = pathsOf(response.body);
      expect(actualPaths).toContain("portfolioId");
      expect(actualPaths).toContain("symbol");
      expect(actualPaths).toContain("assetType");
      expect(actualPaths).toContain("side");
      expect(actualPaths).toContain("quantity");
    });

    const invalidOrders = [
      { case: "missing portfolioId", override: { portfolioId: undefined } },
      { case: "non-uuid portfolioId", override: { portfolioId: "not-a-uuid" } },
      { case: "number portfolioId", override: { portfolioId: 123 } },
      { case: "missing symbol", override: { symbol: undefined } },
      { case: "whitespace-only symbol", override: { symbol: "   " } },
      { case: "empty symbol", override: { symbol: "" } },
      { case: "symbol over max length", override: { symbol: "A".repeat(21) } },
      { case: "wrong-type symbol", override: { symbol: 42 } },
      { case: "missing assetType", override: { assetType: undefined } },
      { case: "invalid assetType enum", override: { assetType: "BONDS" } },
      { case: "lowercase assetType", override: { assetType: "stock" } },
      { case: "missing side", override: { side: undefined } },
      { case: "invalid side enum", override: { side: "HOLD" } },
      { case: "lowercase side", override: { side: "buy" } },
      { case: "missing quantity", override: { quantity: undefined } },
      { case: "zero quantity", override: { quantity: "0" } },
      { case: "zero-decimal quantity", override: { quantity: "0.00000000" } },
      { case: "zero numeric quantity", override: { quantity: 0 } },
      { case: "negative quantity", override: { quantity: "-1" } },
      { case: "negative tiny quantity", override: { quantity: "-0.00000001" } },
      {
        case: "quantity with 9 decimal places",
        override: { quantity: "1.123456789" },
      },
      {
        case: "quantity overflowing Decimal(18,8) integer digits",
        override: { quantity: "12345678901" },
      },
      { case: "non-numeric quantity", override: { quantity: "abc" } },
      { case: "empty-string quantity", override: { quantity: "" } },
      { case: "boolean quantity", override: { quantity: true } },
      { case: "null quantity", override: { quantity: null } },
      { case: "exponent-notation quantity", override: { quantity: 1e-8 } },
    ];

    for (const { case: label, override } of invalidOrders) {
      test(label, async () => {
        const response = await postOrder({ ...marketBase(), ...override });

        expect(response.status).toBe(400);
        expectErrorEnvelope(response.body);
        expectValidationDetails(response.body);
      });
    }

    test("all issues for one field collapse into that field's path", async () => {
      const response = await postOrder({
        ...marketBase(),
        quantity: "-5.123456789",
      });

      expect(response.status).toBe(400);
      expectValidationDetails(response.body);
      expect(pathsOf(response.body)).toContain("quantity");
    });
  });

  describe("type-conditional pricing rules (contract per docs/API.md)", () => {
    const marketBase = () => ({
      portfolioId: mainPortfolioId,
      symbol: "AAPL",
      assetType: "STOCK",
      side: "BUY",
      quantity: "1.5",
    });

    test("omitted type defaults to MARKET", async () => {
      const response = await postOrder(marketBase());

      expect(response.status).toBe(201);
      expect(response.body.data.order.type).toBe("MARKET");

      if (response.status === 201) {
        createdOrderIds.push(response.body.data.order.id);
      }
    });

    test("MARKET with limitPrice is rejected", async () => {
      const response = await postOrder({
        ...marketBase(),
        type: "MARKET",
        limitPrice: "250",
      });

      expect(response.status).toBe(400);
      expectValidationDetails(response.body);
      expect(pathsOf(response.body)).toContain("limitPrice");
    });

    test("MARKET with stopPrice is rejected", async () => {
      const response = await postOrder({
        ...marketBase(),
        type: "MARKET",
        stopPrice: "240",
      });

      expect(response.status).toBe(400);
      expectValidationDetails(response.body);
      expect(pathsOf(response.body)).toContain("stopPrice");
    });

    test("LIMIT without limitPrice is rejected", async () => {
      const response = await postOrder({ ...marketBase(), type: "LIMIT" });

      expect(response.status).toBe(400);
      expectValidationDetails(response.body);
      expect(pathsOf(response.body)).toContain("limitPrice");
    });

    test("LIMIT with stopPrice is rejected", async () => {
      const response = await postOrder({
        ...marketBase(),
        type: "LIMIT",
        limitPrice: "250",
        stopPrice: "240",
      });

      expect(response.status).toBe(400);
      expectValidationDetails(response.body);
      expect(pathsOf(response.body)).toContain("stopPrice");
    });

    test("STOP_LOSS without stopPrice is rejected", async () => {
      const response = await postOrder({ ...marketBase(), type: "STOP_LOSS" });

      expect(response.status).toBe(400);
      expectValidationDetails(response.body);
      expect(pathsOf(response.body)).toContain("stopPrice");
    });

    test("STOP_LOSS with limitPrice is rejected", async () => {
      const response = await postOrder({
        ...marketBase(),
        type: "STOP_LOSS",
        stopPrice: "240",
        limitPrice: "250",
      });

      expect(response.status).toBe(400);
      expectValidationDetails(response.body);
      expect(pathsOf(response.body)).toContain("limitPrice");
    });

    test("TAKE_PROFIT without stopPrice is rejected", async () => {
      const response = await postOrder({
        ...marketBase(),
        type: "TAKE_PROFIT",
      });

      expect(response.status).toBe(400);
      expectValidationDetails(response.body);
      expect(pathsOf(response.body)).toContain("stopPrice");
    });

    test("invalid type enum is rejected", async () => {
      const response = await postOrder({ ...marketBase(), type: "ICEBERG" });

      expect(response.status).toBe(400);
      expectValidationDetails(response.body);
      expect(pathsOf(response.body)).toContain("type");
    });

    test("lowercase type is rejected (no case folding on enums)", async () => {
      const response = await postOrder({ ...marketBase(), type: "limit" });

      expect(response.status).toBe(400);
      expectValidationDetails(response.body);
      expect(pathsOf(response.body)).toContain("type");
    });

    test("price validation: zero limitPrice is rejected", async () => {
      const response = await postOrder({
        ...marketBase(),
        type: "LIMIT",
        limitPrice: "0",
      });

      expect(response.status).toBe(400);
      expectValidationDetails(response.body);
      expect(pathsOf(response.body)).toContain("limitPrice");
    });

    test("price validation: negative stopPrice is rejected", async () => {
      const response = await postOrder({
        ...marketBase(),
        type: "STOP_LOSS",
        stopPrice: "-240",
      });

      expect(response.status).toBe(400);
      expectValidationDetails(response.body);
      expect(pathsOf(response.body)).toContain("stopPrice");
    });

    test("price validation: 9 decimal places is rejected", async () => {
      const response = await postOrder({
        ...marketBase(),
        type: "LIMIT",
        limitPrice: "250.123456789",
      });

      expect(response.status).toBe(400);
      expectValidationDetails(response.body);
      expect(pathsOf(response.body)).toContain("limitPrice");
    });

    test("price validation: over Decimal(18,8) integer digits is rejected", async () => {
      const response = await postOrder({
        ...marketBase(),
        type: "LIMIT",
        limitPrice: "12345678901.5",
      });

      expect(response.status).toBe(400);
      expectValidationDetails(response.body);
      expect(pathsOf(response.body)).toContain("limitPrice");
    });

    test("price validation: non-numeric price is rejected", async () => {
      const response = await postOrder({
        ...marketBase(),
        type: "TAKE_PROFIT",
        stopPrice: "expensive",
      });

      expect(response.status).toBe(400);
      expectValidationDetails(response.body);
      expect(pathsOf(response.body)).toContain("stopPrice");
    });

    test("valid LIMIT order is accepted and echoes type and limitPrice", async () => {
      const response = await postOrder({
        ...marketBase(),
        type: "LIMIT",
        limitPrice: 250.5,
      });

      expect(response.status).toBe(201);
      expect(response.body.data.order.type).toBe("LIMIT");
      expect(typeof response.body.data.order.limitPrice).toBe("string");
      expect(response.body.data.order.limitPrice).toBe("250.5");
      expect(response.body.data.order.status).toBe("PENDING");

      if (response.status === 201) {
        createdOrderIds.push(response.body.data.order.id);
      }
    });

    test("valid STOP_LOSS order is accepted and echoes stopPrice", async () => {
      const response = await postOrder({
        ...marketBase(),
        type: "STOP_LOSS",
        stopPrice: "240.12345678",
      });

      expect(response.status).toBe(201);
      expect(response.body.data.order.type).toBe("STOP_LOSS");
      expect(response.body.data.order.stopPrice).toBe("240.12345678");

      if (response.status === 201) {
        createdOrderIds.push(response.body.data.order.id);
      }
    });

    test("valid TAKE_PROFIT order is accepted", async () => {
      const response = await postOrder({
        ...marketBase(),
        type: "TAKE_PROFIT",
        stopPrice: "260",
      });

      expect(response.status).toBe(201);
      expect(response.body.data.order.type).toBe("TAKE_PROFIT");

      if (response.status === 201) {
        createdOrderIds.push(response.body.data.order.id);
      }
    });

    test("client cannot forge status, source, or ownership via extra fields", async () => {
      const response = await postOrder({
        ...marketBase(),
        status: "EXECUTED",
        source: "ADMIN_OVERRIDE",
        executedPrice: "1",
        id: "forged-id",
      });

      expect(response.status).toBe(201);
      expect(response.body.data.order.status).toBe("PENDING");
      expect(response.body.data.order.source).toBe("MANUAL");

      if (response.status === 201) {
        createdOrderIds.push(response.body.data.order.id);
      }
    });
  });

  describe("accepting boundary-valid payloads (contract: clean data reaches the domain)", () => {
    const marketBase = () => ({
      portfolioId: mainPortfolioId,
      symbol: "AAPL",
      assetType: "STOCK",
      side: "BUY",
      quantity: "1.5",
    });

    test("symbol is trimmed and normalized to uppercase", async () => {
      const response = await postOrder({ ...marketBase(), symbol: "  aapl  " });

      expect(response.status).toBe(201);
      expect(response.body.data.order.symbol).toBe("AAPL");

      if (response.status === 201) {
        createdOrderIds.push(response.body.data.order.id);
      }
    });

    test("crypto ticker with digits is accepted", async () => {
      const response = await postOrder({
        ...marketBase(),
        assetType: "CRYPTO",
        symbol: "btcusdt",
        type: "LIMIT",
        limitPrice: "100",
      });

      expect(response.status).toBe(201);
      expect(response.body.data.order.symbol).toBe("BTCUSDT");

      if (response.status === 201) {
        createdOrderIds.push(response.body.data.order.id);
      }
    });

    test("symbol at max length (20) is accepted", async () => {
      const response = await postOrder({
        ...marketBase(),
        symbol: "A".repeat(20),
        type: "LIMIT",
        limitPrice: "100",
      });

      expect(response.status).toBe(201);

      if (response.status === 201) {
        createdOrderIds.push(response.body.data.order.id);
      }
    });

    test("numeric quantity is accepted and serialized as string", async () => {
      const response = await postOrder({ ...marketBase(), quantity: 2 });

      expect(response.status).toBe(201);
      expect(typeof response.body.data.order.quantity).toBe("string");
      expect(response.body.data.order.quantity).toBe("2");

      if (response.status === 201) {
        createdOrderIds.push(response.body.data.order.id);
      }
    });

    test("whitespace-padded quantity is accepted after trimming", async () => {
      const response = await postOrder({
        ...marketBase(),
        quantity: "  2.5  ",
      });

      expect(response.status).toBe(201);
      expect(response.body.data.order.quantity).toBe("2.5");

      if (response.status === 201) {
        createdOrderIds.push(response.body.data.order.id);
      }
    });

    test("quantity at 8 decimal places is accepted", async () => {
      const response = await postOrder({
        ...marketBase(),
        quantity: "1.12345678",
      });

      expect(response.status).toBe(201);
      expect(response.body.data.order.quantity).toBe("1.12345678");

      if (response.status === 201) {
        createdOrderIds.push(response.body.data.order.id);
      }
    });

    test("maximum representable quantity fits Decimal(18,8)", async () => {
      const response = await postOrder({
        ...marketBase(),
        quantity: "9999999999.99999999",
        type: "LIMIT",
        limitPrice: "0.00000001",
      });

      expect(response.status).toBe(201);

      if (response.status === 201) {
        createdOrderIds.push(response.body.data.order.id);
      }
    });

    test("leading-zero quantity is accepted", async () => {
      const response = await postOrder({ ...marketBase(), quantity: "007.5" });

      expect(response.status).toBe(201);
      expect(response.body.data.order.quantity).toBe("7.5");

      if (response.status === 201) {
        createdOrderIds.push(response.body.data.order.id);
      }
    });
  });

  describe("concurrent cash reservations", () => {
    test("only one concurrent BUY order can reserve the same available cash", async () => {
      // Create an isolated portfolio so this test does not depend on
      // reservations left behind by other order-creation tests.
      const portfolioResponse = await request(app)
        .post("/api/v1/portfolios")
        .set("Authorization", `Bearer ${accessToken}`)
        .send({
          name: `Concurrent Reservation ${timestamp}`,
        });

      expect(portfolioResponse.status).toBe(201);

      const portfolioId = portfolioResponse.body.data.portfolio.id;

      // Each order requires 700, but the portfolio has only 1,000 available.
      await prisma.portfolio.update({
        where: { id: portfolioId },
        data: {
          cashBalance: "1000",
          reservedCash: "0",
        },
      });

      const orderPayload = {
        portfolioId,
        symbol: "AAPL",
        assetType: "STOCK",
        side: "BUY",
        type: "LIMIT",
        quantity: "1",
        limitPrice: "700",
      };

      const responses = await Promise.all([
        postOrder(orderPayload),
        postOrder(orderPayload),
      ]);

      const successful = responses.filter(
        (response) => response.status === 201,
      );
      const rejected = responses.filter((response) => response.status === 400);

      expect(successful).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expectErrorEnvelope(rejected[0].body);
      expect(rejected[0].body.error.code).toBe("INSUFFICIENT_BALANCE");

      const successfulOrder = successful[0].body.data.order;
      createdOrderIds.push(successfulOrder.id);

      const [portfolio, orders] = await Promise.all([
        prisma.portfolio.findUnique({
          where: { id: portfolioId },
        }),
        prisma.order.findMany({
          where: { portfolioId },
        }),
      ]);

      expect(portfolio).not.toBeNull();
      expect(portfolio.reservedCash.toString()).toBe("700");

      expect(orders).toHaveLength(1);
      expect(orders[0].reservedCash.toString()).toBe("700");
      expect(orders[0].status).toBe("PENDING");
    });
  });

  describe("adversarial payloads (contract: rejected, never crashed on)", () => {
    test("non-object bodies are rejected with the unified envelope", async () => {
      const adversarialBodies = [
        JSON.stringify([]),
        JSON.stringify("str"),
        JSON.stringify(7),
        JSON.stringify(null),
      ];

      for (const body of adversarialBodies) {
        const response = await request(app)
          .post("/api/v1/orders")
          .set("Authorization", `Bearer ${accessToken}`)
          .set("Content-Type", "application/json")
          .send(body);

        expect(response.status).toBe(400);
        expectErrorEnvelope(response.body);
      }
    });
  });
});

describe("order detail endpoint (black-box via GET /orders/:id)", () => {
  const marketBase = () => ({
    portfolioId: mainPortfolioId,
    symbol: "AAPL",
    assetType: "STOCK",
    side: "BUY",
    quantity: "1.5",
  });

  let detailOrderId;
  let detailLimitOrderId;

  const serializerKeys = [
    "id",
    "portfolioId",
    "symbol",
    "assetType",
    "side",
    "type",
    "status",
    "quantity",
    "reservedCash",
    "limitPrice",
    "stopPrice",
    "executedPrice",
    "executedAt",
    "expiresAt",
    "notes",
    "source",
    "createdAt",
    "updatedAt",
  ].sort();

  beforeAll(async () => {
    jest.setTimeout(30000);

    // Set up user B (another account) with one order, for the
    // cross-account invisibility case.
    const registerB = await request(app)
      .post("/api/v1/auth/register")
      .send({
        name: "Order Detail User B",
        email: `order-detail-b-${timestamp}@stox.local`,
        password: validUser.password,
      });

    userBId = registerB.body.data.user.id;
    userBAccessToken = registerB.body.data.accessToken;

    const portfoliosB = await request(app)
      .get("/api/v1/portfolios")
      .set("Authorization", `Bearer ${userBAccessToken}`);

    const portfolioB = portfoliosB.body.data.portfolios.find(
      (portfolio) => portfolio.isDefault,
    );

    const orderB = await request(app)
      .post("/api/v1/orders")
      .set("Authorization", `Bearer ${userBAccessToken}`)
      .send({ ...marketBase(), portfolioId: portfolioB.id });

    userBOrderId = orderB.body.data.order.id;

    // User A's own orders for the success cases.
    const market = await postOrder(marketBase());
    detailOrderId = market.body.data.order.id;
    createdOrderIds.push(detailOrderId);

    const limit = await postOrder({
      ...marketBase(),
      type: "LIMIT",
      limitPrice: "250.5",
    });
    detailLimitOrderId = limit.body.data.order.id;
    createdOrderIds.push(detailLimitOrderId);
  });

  describe("middleware chain order (contract: identity before validity)", () => {
    test("missing token is 401 even with an invalid param", async () => {
      const response = await request(app).get("/api/v1/orders/not-a-uuid");

      expect(response.status).toBe(401);
      expectErrorEnvelope(response.body);
    });

    test("garbage token is 401 even with a valid uuid", async () => {
      const response = await request(app)
        .get("/api/v1/orders/8b2c1a4e-3f2d-4c5b-9a8e-7d6c5b4a3f2e")
        .set("Authorization", "Bearer garbage.token.here");

      expect(response.status).toBe(401);
      expectErrorEnvelope(response.body);
    });
  });

  describe("path parameter validation (contract: 400 VALIDATION_ERROR)", () => {
    test("invalid uuid is rejected with an issue on 'id'", async () => {
      const response = await request(app)
        .get("/api/v1/orders/not-a-uuid")
        .set("Authorization", `Bearer ${accessToken}`);

      expect(response.status).toBe(400);
      expectValidationDetails(response.body);
      expect(pathsOf(response.body)).toContain("id");
    });
  });

  describe("not-found contract (missing and foreign orders are indistinguishable)", () => {
    test("nonexistent but valid uuid is 404 ORDER_NOT_FOUND", async () => {
      const response = await request(app)
        .get("/api/v1/orders/8b2c1a4e-3f2d-4c5b-9a8e-7d6c5b4a3f2e")
        .set("Authorization", `Bearer ${accessToken}`);

      expect(response.status).toBe(404);
      expectErrorEnvelope(response.body);
      expect(response.body.error.code).toBe("ORDER_NOT_FOUND");
    });

    test("another user's order is 404 ORDER_NOT_FOUND (never 403)", async () => {
      const response = await request(app)
        .get(`/api/v1/orders/${userBOrderId}`)
        .set("Authorization", `Bearer ${accessToken}`);

      expect(response.status).toBe(404);
      expectErrorEnvelope(response.body);
      expect(response.body.error.code).toBe("ORDER_NOT_FOUND");
    });
  });

  describe("success contract (contract: 200 with the full serialized order)", () => {
    test("returns the authenticated user's own order", async () => {
      const response = await request(app)
        .get(`/api/v1/orders/${detailOrderId}`)
        .set("Authorization", `Bearer ${accessToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);

      const order = response.body.data.order;
      expect(order.id).toBe(detailOrderId);
      expect(order.portfolioId).toBe(mainPortfolioId);
      expect(order.symbol).toBe("AAPL");
      expect(order.assetType).toBe("STOCK");
      expect(order.side).toBe("BUY");
      expect(order.type).toBe("MARKET");
      expect(order.status).toBe("PENDING");
      expect(order.quantity).toBe("1.5");
      expect(order.limitPrice).toBeNull();
      expect(order.stopPrice).toBeNull();
      expect(order.executedPrice).toBeNull();
      expect(order.executedAt).toBeNull();
      expect(order.source).toBe("MANUAL");

      expect(Object.keys(order).sort()).toEqual(serializerKeys);
    });

    test("decimal fields are serialized as strings", async () => {
      const response = await request(app)
        .get(`/api/v1/orders/${detailLimitOrderId}`)
        .set("Authorization", `Bearer ${accessToken}`);

      expect(response.status).toBe(200);

      const order = response.body.data.order;
      expect(order.type).toBe("LIMIT");
      expect(typeof order.quantity).toBe("string");
      expect(order.limitPrice).toBe("250.5");
      expect(order.stopPrice).toBeNull();
    });
  });
});

describe("order list endpoint (black-box via GET /orders)", () => {
  const marketBase = () => ({
    portfolioId: mainPortfolioId,
    assetType: "STOCK",
    side: "BUY",
    quantity: "1",
  });

  // Three known-newest pending orders; symbol tags identify them without
  // relying on the symbol filter (which lands with the history task).
  let newestOrderId;
  let secondOrderId;
  let thirdOrderId;

  async function listOrders(query, token = accessToken) {
    const request_ = request(app).get("/api/v1/orders");

    if (token) {
      request_.set("Authorization", `Bearer ${token}`);
    }

    return request_.query(query);
  }

  beforeAll(async () => {
    jest.setTimeout(30000);

    const symbols = [
      `L${timestamp.toString().slice(-10)}3`,
      `L${timestamp.toString().slice(-10)}2`,
      `L${timestamp.toString().slice(-10)}1`,
    ];

    const created = [];

    for (const symbol of symbols) {
      const response = await postOrder({
        ...marketBase(),
        symbol,
        type: "LIMIT",
        limitPrice: "100",
      });

      expect(response.status).toBe(201);

      const orderId = response.body.data.order.id;
      createdOrderIds.push(orderId);
      created.push(orderId);
    }

    [thirdOrderId, secondOrderId, newestOrderId] = created;
  });

  describe("middleware chain order (contract: identity before validity)", () => {
    test("missing token is 401 even with invalid query params", async () => {
      const response = await listOrders({ page: "0" }, null);

      expect(response.status).toBe(401);
      expectErrorEnvelope(response.body);
    });

    test("garbage token is 401", async () => {
      const response = await request(app)
        .get("/api/v1/orders")
        .set("Authorization", "Bearer garbage.token.here");

      expect(response.status).toBe(401);
      expectErrorEnvelope(response.body);
    });
  });

  describe("query validation (contract: 400 VALIDATION_ERROR)", () => {
    const invalidQueries = [
      { case: "page zero", query: { page: "0" }, path: "page" },
      { case: "page non-numeric", query: { page: "abc" }, path: "page" },
      { case: "page non-integer", query: { page: "1.5" }, path: "page" },
      { case: "limit zero", query: { limit: "0" }, path: "limit" },
      { case: "limit over max", query: { limit: "101" }, path: "limit" },
      { case: "unknown status", query: { status: "FILLED" }, path: "status" },
      {
        case: "empty status segment",
        query: { status: "PENDING," },
        path: "status",
      },
    ];

    for (const { case: label, query, path } of invalidQueries) {
      test(label, async () => {
        const response = await listOrders(query);

        expect(response.status).toBe(400);
        expectValidationDetails(response.body);
        expect(pathsOf(response.body).some((p) => p.startsWith(path))).toBe(
          true,
        );
      });
    }

    test("invalid portfolioId filter is rejected", async () => {
      const response = await listOrders({ portfolioId: "not-a-uuid" });

      expect(response.status).toBe(400);
      expectValidationDetails(response.body);
      expect(pathsOf(response.body)).toContain("portfolioId");
    });
  });

  describe("success contract (contract: 200 with orders and pagination)", () => {
    test("default listing returns the envelope with sane pagination", async () => {
      const response = await listOrders({});

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data.orders)).toBe(true);
      expect(response.body.data.pagination).toEqual({
        page: 1,
        limit: 20,
        total: expect.any(Number),
        totalPages: expect.any(Number),
      });
    });

    test("listing is ownership-scoped: other users' orders never appear", async () => {
      const response = await listOrders({ limit: "100" });

      expect(response.status).toBe(200);

      const ids = response.body.data.orders.map((order) => order.id);
      expect(ids).not.toContain(userBOrderId);
      expect(ids).toContain(newestOrderId);
    });

    test("status=PENDING returns only pending orders and includes known ones", async () => {
      const response = await listOrders({ status: "PENDING", limit: "100" });

      expect(response.status).toBe(200);

      const orders = response.body.data.orders;
      expect(orders.length).toBeGreaterThan(0);

      for (const order of orders) {
        expect(order.status).toBe("PENDING");
      }

      const ids = orders.map((order) => order.id);
      expect(ids).toContain(newestOrderId);
    });

    test("orders are newest-first", async () => {
      const response = await listOrders({ status: "PENDING", limit: "1" });

      expect(response.status).toBe(200);
      expect(response.body.data.orders[0].id).toBe(newestOrderId);
      expect(response.body.data.pagination.page).toBe(1);
      expect(response.body.data.pagination.limit).toBe(1);
    });

    test("pagination walks the newest-first stream page by page", async () => {
      const page1 = await listOrders({
        status: "PENDING",
        limit: "1",
        page: "1",
      });
      const page2 = await listOrders({
        status: "PENDING",
        limit: "1",
        page: "2",
      });

      expect(page1.status).toBe(200);
      expect(page2.status).toBe(200);
      expect(page1.body.data.orders[0].id).toBe(newestOrderId);
      expect(page2.body.data.orders[0].id).toBe(secondOrderId);
    });

    test("page beyond the last one is empty, not an error", async () => {
      const response = await listOrders({ status: "PENDING", page: "5000" });

      expect(response.status).toBe(200);
      expect(response.body.data.orders).toEqual([]);
      expect(response.body.data.pagination.page).toBe(5000);
    });

    test("multi-status filter accepts a comma-separated list", async () => {
      const response = await listOrders({
        status: "PENDING,EXECUTED",
        limit: "100",
      });

      expect(response.status).toBe(200);

      for (const order of response.body.data.orders) {
        expect(["PENDING", "EXECUTED"]).toContain(order.status);
      }
    });
  });

  describe("unknown query params (contract: stripped, not rejected)", () => {
    test("unknown params do not break the request", async () => {
      const response = await listOrders({ page: "1", admin: "true" });

      expect(response.status).toBe(200);
      expect(response.body.data.pagination.page).toBe(1);
    });
  });
});

describe("order history filters (black-box via GET /orders filters)", () => {
  const marketBase = () => ({
    portfolioId: mainPortfolioId,
    assetType: "STOCK",
    side: "BUY",
    quantity: "1",
  });

  let historyConditionalBuyId;
  let historyMarketSellId;
  let historyLimitBuyId;
  let userBPortfolioId;

  beforeAll(async () => {
    jest.setTimeout(30000);

    const created = [];
    for (const [suffix, extra] of [
      ["1", { type: "STOP_LOSS", stopPrice: "10" }],
      ["2", { side: "SELL" }],
      ["3", { type: "LIMIT", limitPrice: "10" }],
    ]) {
      const response = await postOrder({
        ...marketBase(),
        symbol: `H${timestamp}${suffix}`,
        ...extra,
      });

      created.push(response.body.data.order.id);
      createdOrderIds.push(response.body.data.order.id);
    }

    [historyConditionalBuyId, historyMarketSellId, historyLimitBuyId] = created;

    const portfoliosB = await request(app)
      .get("/api/v1/portfolios")
      .set("Authorization", `Bearer ${userBAccessToken}`);

    userBPortfolioId = portfoliosB.body.data.portfolios.find(
      (portfolio) => portfolio.isDefault,
    ).id;
  });

  test("symbol filter is an exact match", async () => {
    const response = await request(app)
      .get("/api/v1/orders")
      .query({ symbol: `H${timestamp}1` })
      .set("Authorization", `Bearer ${accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.data.orders).toHaveLength(1);
    expect(response.body.data.orders[0].id).toBe(historyConditionalBuyId);
  });

  test("symbol filter normalizes case", async () => {
    const response = await request(app)
      .get("/api/v1/orders")
      .query({ symbol: `h${timestamp}1` })
      .set("Authorization", `Bearer ${accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.data.orders).toHaveLength(1);
    expect(response.body.data.orders[0].id).toBe(historyConditionalBuyId);
  });

  test("side filter returns only that side", async () => {
    const response = await request(app)
      .get("/api/v1/orders")
      .query({ side: "SELL", limit: "100" })
      .set("Authorization", `Bearer ${accessToken}`);

    expect(response.status).toBe(200);

    const orders = response.body.data.orders;
    const ids = orders.map((order) => order.id);

    for (const order of orders) {
      expect(order.side).toBe("SELL");
    }
    expect(ids).toContain(historyMarketSellId);
    expect(ids).not.toContain(historyConditionalBuyId);
  });

  test("type filter returns only that type", async () => {
    const response = await request(app)
      .get("/api/v1/orders")
      .query({ type: "LIMIT", limit: "100" })
      .set("Authorization", `Bearer ${accessToken}`);

    expect(response.status).toBe(200);

    const orders = response.body.data.orders;
    const ids = orders.map((order) => order.id);

    for (const order of orders) {
      expect(order.type).toBe("LIMIT");
    }
    expect(ids).toContain(historyLimitBuyId);
    expect(ids).not.toContain(historyConditionalBuyId);
  });

  test("filters compose (side AND type)", async () => {
    const response = await request(app)
      .get("/api/v1/orders")
      .query({ side: "BUY", type: "LIMIT", limit: "100" })
      .set("Authorization", `Bearer ${accessToken}`);

    expect(response.status).toBe(200);

    const matching = response.body.data.orders.filter(
      (order) => order.symbol === `H${timestamp}3`,
    );
    expect(matching).toHaveLength(1);
    expect(matching[0].id).toBe(historyLimitBuyId);
  });

  test("portfolioId filter narrows to that portfolio within ownership scope", async () => {
    const response = await request(app)
      .get("/api/v1/orders")
      .query({ portfolioId: mainPortfolioId, limit: "100" })
      .set("Authorization", `Bearer ${accessToken}`);

    expect(response.status).toBe(200);

    for (const order of response.body.data.orders) {
      expect(order.portfolioId).toBe(mainPortfolioId);
    }
    expect(response.body.data.orders.map((o) => o.id)).toContain(
      historyConditionalBuyId,
    );
  });

  test("portfolioId filter cannot cross ownership (empty, not leaked)", async () => {
    const response = await request(app)
      .get("/api/v1/orders")
      .query({ portfolioId: userBPortfolioId, limit: "100" })
      .set("Authorization", `Bearer ${accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.data.orders).toEqual([]);
  });

  test("owner sees their orders through the portfolioId filter", async () => {
    const response = await request(app)
      .get("/api/v1/orders")
      .query({ portfolioId: userBPortfolioId, limit: "100" })
      .set("Authorization", `Bearer ${userBAccessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.data.orders.map((o) => o.id)).toContain(userBOrderId);
  });

  test("to in the past yields an empty history, not an error", async () => {
    const response = await request(app)
      .get("/api/v1/orders")
      .query({ to: "2000-01-01T00:00:00.000Z", limit: "100" })
      .set("Authorization", `Bearer ${accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.data.orders).toEqual([]);
  });

  test("wide from includes known orders", async () => {
    const response = await request(app)
      .get("/api/v1/orders")
      .query({ from: "2000-01-01T00:00:00.000Z", limit: "100" })
      .set("Authorization", `Bearer ${accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.data.orders.map((o) => o.id)).toContain(
      historyConditionalBuyId,
    );
  });

  test("from after to is rejected with an issue on 'to'", async () => {
    const response = await request(app)
      .get("/api/v1/orders")
      .query({ from: "2026-10-09", to: "2026-10-01" })
      .set("Authorization", `Bearer ${accessToken}`);

    expect(response.status).toBe(400);
    expectValidationDetails(response.body);
    expect(pathsOf(response.body)).toContain("to");
  });

  test("invalid date strings are rejected", async () => {
    const response = await request(app)
      .get("/api/v1/orders")
      .query({ from: "not-a-date" })
      .set("Authorization", `Bearer ${accessToken}`);

    expect(response.status).toBe(400);
    expectValidationDetails(response.body);
    expect(pathsOf(response.body)).toContain("from");
  });

  test("timezone-less datetimes are rejected with an issue at the bound", async () => {
    const response = await request(app)
      .get("/api/v1/orders")
      .query({ to: "2026-10-10T18:00:00" })
      .set("Authorization", `Bearer ${accessToken}`);

    expect(response.status).toBe(400);
    expectValidationDetails(response.body);
    expect(pathsOf(response.body)).toContain("to");
  });

  test("date-only to includes orders created later on that day", async () => {
    const created = await postOrder({
      portfolioId: mainPortfolioId,
      symbol: "AAPL",
      assetType: "STOCK",
      side: "BUY",
      quantity: "1",
    });

    expect(created.status).toBe(201);
    createdOrderIds.push(created.body.data.order.id);

    const createdAt = created.body.data.order.createdAt; // full ISO datetime
    const dateOnly = createdAt.slice(0, 10); // "YYYY-MM-DD"

    const response = await request(app)
      .get("/api/v1/orders")
      .query({ to: dateOnly, limit: "100" })
      .set("Authorization", `Bearer ${accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.data.orders.map((o) => o.id)).toContain(
      created.body.data.order.id,
    );
  });

  test("date-only to on the last day of a month includes that whole day", async () => {
    const created = await postOrder({
      portfolioId: mainPortfolioId,
      symbol: "AAPL",
      assetType: "STOCK",
      side: "BUY",
      quantity: "1",
    });

    expect(created.status).toBe(201);
    createdOrderIds.push(created.body.data.order.id);

    // Pin the order to a month-end day so the window itself crosses a
    // month boundary when the date-only `to` bound is shifted by one day.
    const monthEndInstant = "2026-10-31T14:30:00.000Z";
    await prisma.order.update({
      where: { id: created.body.data.order.id },
      data: { createdAt: new Date(monthEndInstant) },
    });

    const response = await request(app)
      .get("/api/v1/orders")
      .query({ from: "2026-10-31", to: "2026-10-31", limit: "100" })
      .set("Authorization", `Bearer ${accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.data.orders.map((o) => o.id)).toContain(
      created.body.data.order.id,
    );
  });

  test("explicit datetime to is exclusive (half-open window)", async () => {
    const created = await postOrder({
      portfolioId: mainPortfolioId,
      symbol: "AAPL",
      assetType: "STOCK",
      side: "BUY",
      quantity: "1",
      type: "LIMIT",
      limitPrice: "0.00000001",
    });

    expect(created.status).toBe(201);
    createdOrderIds.push(created.body.data.order.id);

    const createdAt = created.body.data.order.createdAt;

    // to = the order's exact creation instant must exclude it.
    const atBoundary = await request(app)
      .get("/api/v1/orders")
      .query({ to: createdAt, limit: "100" })
      .set("Authorization", `Bearer ${accessToken}`);

    expect(atBoundary.status).toBe(200);
    expect(atBoundary.body.data.orders.map((o) => o.id)).not.toContain(
      created.body.data.order.id,
    );

    // One millisecond later must include it.
    const justAfter = new Date(new Date(createdAt).getTime() + 1).toISOString();
    const justAfterBoundary = await request(app)
      .get("/api/v1/orders")
      .query({ to: justAfter, limit: "100" })
      .set("Authorization", `Bearer ${accessToken}`);

    expect(justAfterBoundary.status).toBe(200);
    expect(justAfterBoundary.body.data.orders.map((o) => o.id)).toContain(
      created.body.data.order.id,
    );
  });

  test("history view combines status and date range", async () => {
    const response = await request(app)
      .get("/api/v1/orders")
      .query({
        status: "PENDING,CANCELLED,EXECUTED,EXPIRED,REJECTED",
        from: "2000-01-01T00:00:00.000Z",
        limit: "100",
      })
      .set("Authorization", `Bearer ${accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.data.orders.map((o) => o.id)).toContain(
      historyConditionalBuyId,
    );
  });
});

describe("cancel order endpoint (black-box via DELETE /orders/:id)", () => {
  const marketBase = () => ({
    portfolioId: mainPortfolioId,
    symbol: "AAPL",
    assetType: "STOCK",
    side: "BUY",
    quantity: "1",
  });

  let cancelMarketOrderId;
  let cancelLimitOrderId;
  let cancelOrderId;

  async function deleteOrder(orderId, token = accessToken) {
    const request_ = request(app).delete(`/api/v1/orders/${orderId}`);

    if (token) {
      request_.set("Authorization", `Bearer ${token}`);
    }

    return request_;
  }

  beforeAll(async () => {
    jest.setTimeout(30000);

    for (const [suffix, extra, assign] of [
      ["1", { side: "SELL" }, (id) => (cancelMarketOrderId = id)],
      [
        "2",
        { type: "LIMIT", limitPrice: "12" },
        (id) => (cancelLimitOrderId = id),
      ],
      ["3", { side: "SELL" }, (id) => (cancelOrderId = id)],
    ]) {
      const response = await postOrder({
        ...marketBase(),
        symbol: `C${timestamp}${suffix}`,
        ...extra,
      });

      createdOrderIds.push(response.body.data.order.id);
      assign(response.body.data.order.id);
    }
  });

  describe("middleware chain order (contract: identity before validity)", () => {
    test("missing token is 401 even with an invalid param", async () => {
      const response = await deleteOrder("not-a-uuid", null);

      expect(response.status).toBe(401);
      expectErrorEnvelope(response.body);
    });

    test("garbage token is 401", async () => {
      const response = await request(app)
        .delete("/api/v1/orders/8b2c1a4e-3f2d-4c5b-9a8e-7d6c5b4a3f2e")
        .set("Authorization", "Bearer garbage.token.here");

      expect(response.status).toBe(401);
      expectErrorEnvelope(response.body);
    });
  });

  describe("request validation (contract: 400 VALIDATION_ERROR)", () => {
    test("invalid uuid is rejected with an issue on 'id'", async () => {
      const response = await deleteOrder("not-a-uuid");

      expect(response.status).toBe(400);
      expectValidationDetails(response.body);
      expect(pathsOf(response.body)).toContain("id");
    });
  });

  describe("not-found contract", () => {
    test("nonexistent order is 404 ORDER_NOT_FOUND", async () => {
      const response = await deleteOrder(
        "8b2c1a4e-3f2d-4c5b-9a8e-7d6c5b4a3f2e",
      );

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe("ORDER_NOT_FOUND");
    });

    test("another user's order is 404 ORDER_NOT_FOUND (never 403)", async () => {
      const response = await deleteOrder(userBOrderId);

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe("ORDER_NOT_FOUND");
    });
  });

  describe("cancellation contract", () => {
    test("pending MARKET order is cancelled and returned serialized", async () => {
      const response = await deleteOrder(cancelMarketOrderId);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);

      const order = response.body.data.order;
      expect(order.id).toBe(cancelMarketOrderId);
      expect(order.status).toBe("CANCELLED");
      expect(order.symbol).toBe(`C${timestamp}1`);
      expect(typeof order.quantity).toBe("string");
    });

    test("pending LIMIT order is cancellable too", async () => {
      const response = await deleteOrder(cancelLimitOrderId);

      expect(response.status).toBe(200);
      expect(response.body.data.order.status).toBe("CANCELLED");
      expect(response.body.data.order.type).toBe("LIMIT");
    });

    test("already-cancelled order cannot be cancelled again", async () => {
      const response = await deleteOrder(cancelMarketOrderId);

      expect(response.status).toBe(400);
      expectErrorEnvelope(response.body);
      expect(response.body.error.code).toBe("ORDER_NOT_CANCELLABLE");
    });
  });

  describe("cross-endpoint consistency after cancellation", () => {
    test("cancelled order leaves the open view", async () => {
      const response = await request(app)
        .get("/api/v1/orders")
        .query({ status: "PENDING", limit: "100" })
        .set("Authorization", `Bearer ${accessToken}`);

      expect(response.status).toBe(200);
      expect(response.body.data.orders.map((o) => o.id)).not.toContain(
        cancelMarketOrderId,
      );
    });

    test("cancelled order appears in the cancelled view", async () => {
      const response = await request(app)
        .get("/api/v1/orders")
        .query({ status: "CANCELLED", limit: "100" })
        .set("Authorization", `Bearer ${accessToken}`);

      expect(response.status).toBe(200);
      expect(response.body.data.orders.map((o) => o.id)).toContain(
        cancelMarketOrderId,
      );
    });

    test("cancelled order remains retrievable by id with its final state", async () => {
      const response = await request(app)
        .get(`/api/v1/orders/${cancelMarketOrderId}`)
        .set("Authorization", `Bearer ${accessToken}`);

      expect(response.status).toBe(200);
      expect(response.body.data.order.status).toBe("CANCELLED");
    });
  });

  describe("conditional status transition (execution race guard)", () => {
    test("order executed between check and update is not overwritten to CANCELLED", async () => {
      // Simulate the race: another process (the order worker) executes the
      // order after the cancellation request's ownership/eligibility check
      // but before its write. The cancel must fail with
      // ORDER_NOT_CANCELLABLE and must NOT flip EXECUTED -> CANCELLED.
      const created = await postOrder({
        portfolioId: mainPortfolioId,
        symbol: `C${timestamp}RACE`,
        assetType: "STOCK",
        side: "SELL",
        quantity: "1",
      });

      expect(created.status).toBe(201);

      const orderId = created.body.data.order.id;
      createdOrderIds.push(orderId);

      await prisma.order.update({
        where: { id: orderId },
        data: { status: "EXECUTED", executedAt: new Date() },
      });

      const response = await deleteOrder(orderId);

      expect(response.status).toBe(400);
      expectErrorEnvelope(response.body);
      expect(response.body.error.code).toBe("ORDER_NOT_CANCELLABLE");

      const stored = await prisma.order.findUnique({
        where: { id: orderId },
        select: { status: true },
      });
      expect(stored.status).toBe("EXECUTED");
    });
  });

  describe("backend SELL order position validation", () => {
    test("rejects SELL order for an unowned symbol with 400 INSUFFICIENT_POSITION", async () => {
      const response = await postOrder({
        portfolioId: mainPortfolioId,
        symbol: `NO${timestamp % 1000000}`,
        assetType: "STOCK",
        side: "SELL",
        quantity: "5",
      });

      expect(response.status).toBe(400);
      expectErrorEnvelope(response.body);
      expect(response.body.error.code).toBe("INSUFFICIENT_POSITION");
      expect(response.body.error.details).toEqual({
        required: "5",
        available: "0",
      });
    });

    test("accounts for pending SELL orders against available holding", async () => {
      const testSymbol = `SL${timestamp % 1000000}`;
      await prisma.holding.create({
        data: {
          portfolioId: mainPortfolioId,
          symbol: testSymbol,
          assetType: "STOCK",
          quantity: 5,
          averageBuyPrice: 100,
          totalInvested: 500,
        },
      });

      // First order: SELL 4 shares (succeeds, 1 available)
      const first = await postOrder({
        portfolioId: mainPortfolioId,
        symbol: testSymbol,
        assetType: "STOCK",
        side: "SELL",
        quantity: "4",
      });
      expect(first.status).toBe(201);
      createdOrderIds.push(first.body.data.order.id);

      // Second order: attempt to SELL 2 shares (fails, only 1 available)
      const second = await postOrder({
        portfolioId: mainPortfolioId,
        symbol: testSymbol,
        assetType: "STOCK",
        side: "SELL",
        quantity: "2",
      });
      expect(second.status).toBe(400);
      expectErrorEnvelope(second.body);
      expect(second.body.error.code).toBe("INSUFFICIENT_POSITION");
      expect(second.body.error.details).toEqual({
        required: "2",
        available: "1",
      });

      // Cleanup test holding
      await prisma.holding.deleteMany({
        where: { portfolioId: mainPortfolioId, symbol: testSymbol },
      });
    });

    test("validates SELL orders matching canonical symbols across prefixed, slash, and unprefixed crypto notations", async () => {
      const cryptoHoldingSymbol = "BINANCE:BTCUSDT";
      await prisma.holding.deleteMany({
        where: {
          portfolioId: mainPortfolioId,
          symbol: { in: ["BINANCE:BTCUSDT", "BTCUSDT", "BTC/USDT"] },
        },
      });

      await prisma.holding.create({
        data: {
          portfolioId: mainPortfolioId,
          symbol: cryptoHoldingSymbol,
          assetType: "CRYPTO",
          quantity: 2.5,
          averageBuyPrice: 50000,
          totalInvested: 125000,
        },
      });

      // 1. Order with unprefixed BTCUSDT succeeds
      const first = await postOrder({
        portfolioId: mainPortfolioId,
        symbol: "BTCUSDT",
        assetType: "CRYPTO",
        side: "SELL",
        quantity: "1.0",
      });
      expect(first.status).toBe(201);
      createdOrderIds.push(first.body.data.order.id);

      // 2. Order with slash-separated BTC/USDT of 1.0 succeeds (leaving 0.5 available)
      const second = await postOrder({
        portfolioId: mainPortfolioId,
        symbol: "BTC/USDT",
        assetType: "CRYPTO",
        side: "SELL",
        quantity: "1.0",
      });
      expect(second.status).toBe(201);
      createdOrderIds.push(second.body.data.order.id);

      // 3. Order with 1.0 exceeds remaining 0.5 available -> 400 INSUFFICIENT_POSITION
      const third = await postOrder({
        portfolioId: mainPortfolioId,
        symbol: "BTCUSDT",
        assetType: "CRYPTO",
        side: "SELL",
        quantity: "1.0",
      });
      expect(third.status).toBe(400);
      expectErrorEnvelope(third.body);
      expect(third.body.error.code).toBe("INSUFFICIENT_POSITION");
      expect(third.body.error.details).toEqual({
        required: "1",
        available: "0.5",
      });

      // Cleanup
      await prisma.order.deleteMany({
        where: { id: { in: [first.body.data.order.id, second.body.data.order.id] } },
      });
      await prisma.holding.deleteMany({
        where: { portfolioId: mainPortfolioId, symbol: cryptoHoldingSymbol },
      });
    });

    test("validates holding stored as unprefixed BTCUSDT with SELL request using BINANCE:BTCUSDT and isolates unrelated symbols", async () => {
      const unprefixedSymbol = "BTCUSDT";
      await prisma.holding.deleteMany({
        where: {
          portfolioId: mainPortfolioId,
          symbol: { in: ["BINANCE:BTCUSDT", "BTCUSDT", "ETHUSDT"] },
        },
      });

      await prisma.holding.create({
        data: {
          portfolioId: mainPortfolioId,
          symbol: unprefixedSymbol,
          assetType: "CRYPTO",
          quantity: 2.0,
          averageBuyPrice: 50000,
          totalInvested: 100000,
        },
      });

      // 1. Unrelated crypto symbol ETHUSDT cannot be sold using BTCUSDT holding -> 400 INSUFFICIENT_POSITION
      const unrelatedRes = await postOrder({
        portfolioId: mainPortfolioId,
        symbol: "ETHUSDT",
        assetType: "CRYPTO",
        side: "SELL",
        quantity: "1.0",
      });
      expect(unrelatedRes.status).toBe(400);
      expectErrorEnvelope(unrelatedRes.body);
      expect(unrelatedRes.body.error.code).toBe("INSUFFICIENT_POSITION");
      expect(unrelatedRes.body.error.details).toEqual({
        required: "1",
        available: "0",
      });

      // 2. SELL using BINANCE:BTCUSDT succeeds against unprefixed BTCUSDT holding
      const prefixedOrder = await postOrder({
        portfolioId: mainPortfolioId,
        symbol: "BINANCE:BTCUSDT",
        assetType: "CRYPTO",
        side: "SELL",
        quantity: "1.5",
      });
      expect(prefixedOrder.status).toBe(201);
      createdOrderIds.push(prefixedOrder.body.data.order.id);

      // 3. Excess SELL fails because remaining available is 0.5
      const excessOrder = await postOrder({
        portfolioId: mainPortfolioId,
        symbol: "BTCUSDT",
        assetType: "CRYPTO",
        side: "SELL",
        quantity: "1.0",
      });
      expect(excessOrder.status).toBe(400);
      expect(excessOrder.body.error.code).toBe("INSUFFICIENT_POSITION");
      expect(excessOrder.body.error.details).toEqual({
        required: "1",
        available: "0.5",
      });

      // Cleanup
      await prisma.order.deleteMany({
        where: { id: prefixedOrder.body.data.order.id },
      });
      await prisma.holding.deleteMany({
        where: { portfolioId: mainPortfolioId, symbol: unprefixedSymbol },
      });
    });

    test("aggregates multiple holdings and pending orders for the same canonical instrument", async () => {
      await prisma.holding.deleteMany({
        where: {
          portfolioId: mainPortfolioId,
          symbol: { in: ["BINANCE:ETHUSDT", "ETHUSDT"] },
        },
      });

      await prisma.holding.createMany({
        data: [
          {
            portfolioId: mainPortfolioId,
            symbol: "BINANCE:ETHUSDT",
            assetType: "CRYPTO",
            quantity: 3.0,
            averageBuyPrice: 3000,
            totalInvested: 9000,
          },
          {
            portfolioId: mainPortfolioId,
            symbol: "ETHUSDT",
            assetType: "CRYPTO",
            quantity: 2.0,
            averageBuyPrice: 3000,
            totalInvested: 6000,
          },
        ],
      });

      // Total held is 5.0. Sell 4.5 using ETH/USDT -> succeeds
      const order = await postOrder({
        portfolioId: mainPortfolioId,
        symbol: "ETH/USDT",
        assetType: "CRYPTO",
        side: "SELL",
        quantity: "4.5",
      });
      expect(order.status).toBe(201);
      createdOrderIds.push(order.body.data.order.id);

      // Attempt to sell another 1.0 (available is 0.5) -> fails
      const excess = await postOrder({
        portfolioId: mainPortfolioId,
        symbol: "ETHUSDT",
        assetType: "CRYPTO",
        side: "SELL",
        quantity: "1.0",
      });
      expect(excess.status).toBe(400);
      expect(excess.body.error.code).toBe("INSUFFICIENT_POSITION");
      expect(excess.body.error.details).toEqual({
        required: "1",
        available: "0.5",
      });

      // Cleanup
      await prisma.order.deleteMany({
        where: { id: order.body.data.order.id },
      });
      await prisma.holding.deleteMany({
        where: {
          portfolioId: mainPortfolioId,
          symbol: { in: ["BINANCE:ETHUSDT", "ETHUSDT"] },
        },
      });
    });

    test("serializes concurrent SELL orders and rejects orders that exceed available position (stocks)", async () => {
      const stockSymbol = `CR${timestamp % 1000000}`;
      await prisma.holding.create({
        data: {
          portfolioId: mainPortfolioId,
          symbol: stockSymbol,
          assetType: "STOCK",
          quantity: 5,
          averageBuyPrice: 100,
          totalInvested: 500,
        },
      });

      // Two concurrent requests for 4 shares each. Total held is 5.
      // Exactly one must succeed (201) and one must fail (400 INSUFFICIENT_POSITION).
      const [res1, res2] = await Promise.all([
        postOrder({
          portfolioId: mainPortfolioId,
          symbol: stockSymbol,
          assetType: "STOCK",
          side: "SELL",
          quantity: "4",
        }),
        postOrder({
          portfolioId: mainPortfolioId,
          symbol: stockSymbol,
          assetType: "STOCK",
          side: "SELL",
          quantity: "4",
        }),
      ]);

      const statuses = [res1.status, res2.status].sort();
      expect(statuses).toEqual([201, 400]);

      const successRes = res1.status === 201 ? res1 : res2;
      const failedRes = res1.status === 400 ? res1 : res2;

      createdOrderIds.push(successRes.body.data.order.id);

      expectErrorEnvelope(failedRes.body);
      expect(failedRes.body.error.code).toBe("INSUFFICIENT_POSITION");
      expect(failedRes.body.error.details).toEqual({
        required: "4",
        available: "1",
      });

      const pendingOrders = await prisma.order.findMany({
        where: {
          portfolioId: mainPortfolioId,
          symbol: stockSymbol,
          side: "SELL",
          status: "PENDING",
        },
      });
      expect(pendingOrders).toHaveLength(1);
      expect(pendingOrders[0].quantity.toString()).toBe("4");

      // Cleanup
      await prisma.order.deleteMany({
        where: { id: successRes.body.data.order.id },
      });
      await prisma.holding.deleteMany({
        where: { portfolioId: mainPortfolioId, symbol: stockSymbol },
      });
    });

    test("serializes concurrent SELL orders with equivalent crypto notations and fractional quantities", async () => {
      await prisma.holding.deleteMany({
        where: {
          portfolioId: mainPortfolioId,
          symbol: { in: ["BINANCE:SOLUSDT", "SOLUSDT", "SOL/USDT"] },
        },
      });

      await prisma.holding.create({
        data: {
          portfolioId: mainPortfolioId,
          symbol: "BINANCE:SOLUSDT",
          assetType: "CRYPTO",
          quantity: 5.5,
          averageBuyPrice: 150,
          totalInvested: 825,
        },
      });

      const [res1, res2] = await Promise.all([
        postOrder({
          portfolioId: mainPortfolioId,
          symbol: "SOLUSDT",
          assetType: "CRYPTO",
          side: "SELL",
          quantity: "3.5",
        }),
        postOrder({
          portfolioId: mainPortfolioId,
          symbol: "SOL/USDT",
          assetType: "CRYPTO",
          side: "SELL",
          quantity: "3.5",
        }),
      ]);

      const statuses = [res1.status, res2.status].sort();
      expect(statuses).toEqual([201, 400]);

      const successRes = res1.status === 201 ? res1 : res2;
      const failedRes = res1.status === 400 ? res1 : res2;

      createdOrderIds.push(successRes.body.data.order.id);

      expectErrorEnvelope(failedRes.body);
      expect(failedRes.body.error.code).toBe("INSUFFICIENT_POSITION");
      expect(failedRes.body.error.details).toEqual({
        required: "3.5",
        available: "2",
      });

      const pendingOrders = await prisma.order.findMany({
        where: {
          portfolioId: mainPortfolioId,
          symbol: { in: ["SOLUSDT", "SOL/USDT"] },
          side: "SELL",
          status: "PENDING",
        },
      });
      expect(pendingOrders).toHaveLength(1);
      expect(pendingOrders[0].quantity.toString()).toBe("3.5");

      // Cleanup
      await prisma.order.deleteMany({
        where: { id: successRes.body.data.order.id },
      });
      await prisma.holding.deleteMany({
        where: {
          portfolioId: mainPortfolioId,
          symbol: { in: ["BINANCE:SOLUSDT", "SOLUSDT", "SOL/USDT"] },
        },
      });
    });
  });
});
