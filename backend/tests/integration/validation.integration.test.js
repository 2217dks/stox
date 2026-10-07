const request = require("supertest");

const app = require("../../src/app");
const prisma = require("../../src/config/database");

const timestamp = Date.now();

const validUser = {
  name: "Validation Test User",
  email: `validation-${timestamp}@stox.local`,
  password: "TestPassword123!",
};

let userId;
let accessToken;
let mainPortfolioId;
const createdOrderIds = [];

beforeAll(async () => {
  jest.setTimeout(20000);
});

afterAll(async () => {
  for (const orderId of createdOrderIds) {
    await prisma.order.delete({ where: { id: orderId } }).catch(() => {});
  }

  if (userId) {
    await prisma.user.delete({
      where: {
        id: userId,
      },
    });
  }

  await prisma.$disconnect();
});

// Contract invariants (docs/ERROR_HANDLING.md + docs/API.md):
// - failures: { success: false, error: { code, message, details? } }
// - validation failures: 400 VALIDATION_ERROR, details = [{ path, message }]
// - exact messages are NOT asserted (copy may change; contract may not).
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

describe("request validation middleware", () => {
  describe("rejecting invalid payloads (contract: 400 VALIDATION_ERROR)", () => {
    const invalidRegisters = [
      { case: "too-short name", body: { name: "A", email: `ok-${timestamp}@stox.local`, password: validUser.password }, paths: ["name"] },
      { case: "invalid email", body: { name: "Ok Name", email: "not-an-email", password: validUser.password }, paths: ["email"] },
      { case: "missing name", body: { email: `ok2-${timestamp}@stox.local`, password: validUser.password }, paths: ["name"] },
      { case: "missing email", body: { name: "Ok Name", password: validUser.password }, paths: ["email"] },
      { case: "missing password", body: { name: "Ok Name", email: `ok3-${timestamp}@stox.local` }, paths: ["password"] },
      { case: "wrong-type name (number)", body: { name: 123, email: `ok4-${timestamp}@stox.local`, password: validUser.password }, paths: ["name"] },
      { case: "wrong-type email (object)", body: { name: "Ok Name", email: { a: 1 }, password: validUser.password }, paths: ["email"] },
    ];

    for (const { case: label, body, paths } of invalidRegisters) {
      test(label, async () => {
        const response = await request(app)
          .post("/api/v1/auth/register")
          .send(body);

        expect(response.status).toBe(400);
        expectErrorEnvelope(response.body);
        expectValidationDetails(response.body);

        const actualPaths = pathsOf(response.body);
        for (const p of paths) {
          expect(actualPaths).toContain(p);
        }
      });
    }

    test("weak password surfaces password-path issues", async () => {
      const response = await request(app)
        .post("/api/v1/auth/register")
        .send({
          name: "Ok Name",
          email: `weak-${timestamp}@stox.local`,
          password: "weak",
        });

      expect(response.status).toBe(400);
      expectValidationDetails(response.body);
      expect(pathsOf(response.body)).toContain("password");
    });

    test("empty object body reports all missing fields at once", async () => {
      const response = await request(app)
        .post("/api/v1/auth/register")
        .send({});

      expect(response.status).toBe(400);
      expectValidationDetails(response.body);

      const actualPaths = pathsOf(response.body);
      expect(actualPaths).toContain("name");
      expect(actualPaths).toContain("email");
      expect(actualPaths).toContain("password");
    });

    test("non-object bodies are rejected, not crashed on", async () => {
      const adversarialBodies = [
        JSON.stringify([]),
        JSON.stringify("str"),
        JSON.stringify(7),
        JSON.stringify(null),
      ];

      for (const body of adversarialBodies) {
        const response = await request(app)
          .post("/api/v1/auth/register")
          .set("Content-Type", "application/json")
          .send(body);

        expect(response.status).toBe(400);
        expectErrorEnvelope(response.body);
      }
    });

    test("email boundary: 254 chars accepted (RFC 5321 limit), 255 rejected", async () => {
      // '@stox.local' is 11 chars → local part lengths 243 / 244
      const maxEmail = `${"a".repeat(243)}@stox.local`;
      const overEmail = `${"a".repeat(244)}@stox.local`;

      const accepted = await request(app)
        .post("/api/v1/auth/register")
        .send({
          name: "Max Email User",
          email: maxEmail,
          password: validUser.password,
        });

      expect(accepted.status).toBe(201);

      if (accepted.status === 201) {
        await prisma.user.delete({ where: { id: accepted.body.data.user.id } });
      }

      const rejected = await request(app)
        .post("/api/v1/auth/register")
        .send({
          name: "Over Email User",
          email: overEmail,
          password: validUser.password,
        });

      expect(rejected.status).toBe(400);
      expectValidationDetails(rejected.body);
      expect(pathsOf(rejected.body)).toContain("email");
    });

    test("login with missing password returns 400", async () => {
      const response = await request(app)
        .post("/api/v1/auth/login")
        .send({ email: validUser.email });

      expect(response.status).toBe(400);
      expectValidationDetails(response.body);
      expect(pathsOf(response.body)).toContain("password");
    });

    test("refresh with missing token returns 400", async () => {
      const response = await request(app)
        .post("/api/v1/auth/refresh")
        .send({});

      expect(response.status).toBe(400);
      expectValidationDetails(response.body);
      expect(pathsOf(response.body)).toContain("refreshToken");
    });

    test("logout with missing token returns 400", async () => {
      const response = await request(app)
        .post("/api/v1/auth/logout")
        .send({});

      expect(response.status).toBe(400);
      expectValidationDetails(response.body);
      expect(pathsOf(response.body)).toContain("refreshToken");
    });
  });

  describe("transforming valid payloads (contract: clean data reaches the domain)", () => {
    test("register trims and normalizes input", async () => {
      const response = await request(app)
        .post("/api/v1/auth/register")
        .send({
          name: "  Padded Name  ",
          email: `  padded-${timestamp}@stox.local  `,
          password: validUser.password,
        });

      expect(response.status).toBe(201);
      expect(response.body.data.user.name).toBe("Padded Name");
      expect(response.body.data.user.email).toBe(
        `padded-${timestamp}@stox.local`,
      );

      userId = response.body.data.user.id;
      accessToken = response.body.data.accessToken;

      const portfoliosResponse = await request(app)
        .get("/api/v1/portfolios")
        .set("Authorization", `Bearer ${accessToken}`);

      const mainPortfolio = portfoliosResponse.body.data.portfolios.find(
        (portfolio) => portfolio.isDefault,
      );
      mainPortfolioId = mainPortfolio.id;
    });
  });

  describe("middleware chain order (contract: identity before validity)", () => {
    test("garbage token wins over invalid body: 401, not 400", async () => {
      const response = await request(app)
        .patch("/api/v1/auth/profile")
        .set("Authorization", "Bearer garbage.token.here")
        .send({ name: "A" });

      expect(response.status).toBe(401);
      expectErrorEnvelope(response.body);
    });

    test("missing token on protected route is 401 even with empty body", async () => {
      const response = await request(app)
        .patch("/api/v1/auth/profile")
        .send({});

      expect(response.status).toBe(401);
      expectErrorEnvelope(response.body);
    });

    test("authenticated empty profile update is 400 (at least one field)", async () => {
      const response = await request(app)
        .patch("/api/v1/auth/profile")
        .set("Authorization", `Bearer ${accessToken}`)
        .send({});

      expect(response.status).toBe(400);
      expectValidationDetails(response.body);
    });

    test("authenticated valid profile update succeeds and trims", async () => {
      const response = await request(app)
        .patch("/api/v1/auth/profile")
        .set("Authorization", `Bearer ${accessToken}`)
        .send({ name: "  Updated Name  " });

      expect(response.status).toBe(200);
      expect(response.body.data.user.name).toBe("Updated Name");
    });

    test("profile update with wrong-type field is 400", async () => {
      const response = await request(app)
        .patch("/api/v1/auth/profile")
        .set("Authorization", `Bearer ${accessToken}`)
        .send({ name: 123 });

      expect(response.status).toBe(400);
      expectValidationDetails(response.body);
      expect(pathsOf(response.body)).toContain("name");
    });

    test("profile update with invalid avatarUrl is 400", async () => {
      const response = await request(app)
        .patch("/api/v1/auth/profile")
        .set("Authorization", `Bearer ${accessToken}`)
        .send({ avatarUrl: "not-a-url" });

      expect(response.status).toBe(400);
      expectValidationDetails(response.body);
      expect(pathsOf(response.body)).toContain("avatarUrl");
    });
  });

  describe("order route (contract: same validation shape everywhere)", () => {
    const orderBase = () => ({
      portfolioId: mainPortfolioId,
      symbol: "AAPL",
      assetType: "STOCK",
      side: "BUY",
      quantity: "1.5",
    });

    test("missing fields report all of them in the unified shape", async () => {
      const response = await request(app)
        .post("/api/v1/orders")
        .set("Authorization", `Bearer ${accessToken}`)
        .send({ assetType: "STOCK" });

      expect(response.status).toBe(400);
      expectValidationDetails(response.body);

      const actualPaths = pathsOf(response.body);
      expect(actualPaths).toContain("portfolioId");
      expect(actualPaths).toContain("symbol");
      expect(actualPaths).toContain("quantity");
    });

    const invalidOrders = [
      { case: "non-uuid portfolioId", override: { portfolioId: "not-a-uuid" } },
      { case: "symbol over max length", override: { symbol: "A".repeat(21) } },
      { case: "invalid assetType enum", override: { assetType: "BONDS" } },
      { case: "invalid side enum", override: { side: "HOLD" } },
      { case: "zero quantity", override: { quantity: "0" } },
      { case: "negative quantity", override: { quantity: "-1" } },
      { case: "quantity with 9 decimal places", override: { quantity: "1.123456789" } },
      { case: "non-numeric quantity", override: { quantity: "abc" } },
    ];

    for (const { case: label, override } of invalidOrders) {
      test(label, async () => {
        const response = await request(app)
          .post("/api/v1/orders")
          .set("Authorization", `Bearer ${accessToken}`)
          .send({ ...orderBase(), ...override });

        expect(response.status).toBe(400);
        expectErrorEnvelope(response.body);
        expectValidationDetails(response.body);
      });
    }

    test("symbol is normalized to uppercase by the schema", async () => {
      const response = await request(app)
        .post("/api/v1/orders")
        .set("Authorization", `Bearer ${accessToken}`)
        .send({ ...orderBase(), symbol: "aapl" });

      expect(response.status).toBe(201);
      expect(response.body.data.order.symbol).toBe("AAPL");

      if (response.status === 201) {
        createdOrderIds.push(response.body.data.order.id);
      }
    });

    test("unknown extra fields are stripped, not rejected or persisted as risk", async () => {
      const response = await request(app)
        .post("/api/v1/orders")
        .set("Authorization", `Bearer ${accessToken}`)
        .send({ ...orderBase(), status: "EXECUTED", source: "ADMIN_OVERRIDE" });

      expect(response.status).toBe(201);
      expect(response.body.data.order.status).toBe("PENDING");
      expect(response.body.data.order.source).toBe("MANUAL");

      if (response.status === 201) {
        createdOrderIds.push(response.body.data.order.id);
      }
    });

    test("numeric quantity is accepted and stringified (documented preprocess)", async () => {
      const response = await request(app)
        .post("/api/v1/orders")
        .set("Authorization", `Bearer ${accessToken}`)
        .send({ ...orderBase(), quantity: 2 });

      expect(response.status).toBe(201);
      expect(typeof response.body.data.order.quantity).toBe("string");

      if (response.status === 201) {
        createdOrderIds.push(response.body.data.order.id);
      }
    });
  });
});
