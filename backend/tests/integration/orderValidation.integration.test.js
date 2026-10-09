const request = require("supertest");

const app = require("../../src/app");
const prisma = require("../../src/config/database");

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

// Second user, used to prove orders are invisible across accounts.
let userBId;
let userBAccessToken;
let userBOrderId;

beforeAll(async () => {
  jest.setTimeout(30000);

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
});

afterAll(async () => {
  for (const orderId of createdOrderIds) {
    await prisma.order.delete({ where: { id: orderId } }).catch(() => {});
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
      { case: "quantity with 9 decimal places", override: { quantity: "1.123456789" } },
      { case: "non-numeric quantity", override: { quantity: "abc" } },
      { case: "empty-string quantity", override: { quantity: "" } },
      { case: "boolean quantity", override: { quantity: true } },
      { case: "null quantity", override: { quantity: null } },
      { case: "exponent-notation quantity", override: { quantity: 1e-8 } },
      {
        case: "quantity overflowing Decimal(18,8) integer digits",
        override: { quantity: "12345678901" },
      },
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
      const response = await postOrder({ ...marketBase(), quantity: "-5.123456789" });

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
      const response = await postOrder({ ...marketBase(), type: "TAKE_PROFIT" });

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
      const response = await postOrder({ ...marketBase(), quantity: "  2.5  " });

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
