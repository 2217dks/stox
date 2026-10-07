const request = require("supertest");

const app = require("../../src/app");
const prisma = require("../../src/config/database");
const authService = require("../../src/services/authService");
const errorHandler = require("../../src/middleware/errorHandler");
const { AppError } = require("../../src/utils/errors");

jest.mock("../../src/services/authService", () => ({
  ...jest.requireActual("../../src/services/authService"),
  getCurrentUser: jest.fn(),
}));

const timestamp = Date.now();

const validUser = {
  name: "Error Handling Test User",
  email: `error-handling-${timestamp}@stox.local`,
  password: "TestPassword123!",
};

let userId;
let accessToken;

beforeAll(async () => {
  jest.setTimeout(20000);
});

afterAll(async () => {
  if (userId) {
    await prisma.user.delete({
      where: {
        id: userId,
      },
    });
  }

  await prisma.$disconnect();
});

// Contract invariant (docs/ERROR_HANDLING.md): every failure response is
// { success: false, error: { code: string, message: string, details?: any } }.
// Assertions here must be derivable from the documented contract —
// exact messages are deliberately NOT asserted (copy can change freely).
function expectErrorEnvelope(body) {
  expect(body).toHaveProperty("success", false);
  expect(typeof body.error?.code).toBe("string");
  expect(body.error.code.length).toBeGreaterThan(0);
  expect(typeof body.error?.message).toBe("string");
  expect(body.error.message.length).toBeGreaterThan(0);
}

describe("centralized error handling", () => {
  beforeAll(async () => {
    const registerResponse = await request(app)
      .post("/api/v1/auth/register")
      .send(validUser);

    if (registerResponse.status === 201) {
      userId = registerResponse.body.data.user.id;
      accessToken = registerResponse.body.data.accessToken;
    }
  });

  describe("error response envelope (contract invariant)", () => {
    test("404 unknown route", async () => {
      const response = await request(app).get("/api/v1/definitely-not-a-route");

      expect(response.status).toBe(404);
      expectErrorEnvelope(response.body);
      expect(response.body.error.code).toBe("ROUTE_NOT_FOUND");
    });

    test("401 missing header", async () => {
      const response = await request(app).get("/api/v1/auth/me");

      expect(response.status).toBe(401);
      expectErrorEnvelope(response.body);
      expect(response.body.error.code).toBe("UNAUTHORIZED");
    });

    test("401 malformed header", async () => {
      const response = await request(app)
        .get("/api/v1/auth/me")
        .set("Authorization", "Token abc123");

      expect(response.status).toBe(401);
      expectErrorEnvelope(response.body);
      expect(response.body.error.code).toBe("INVALID_AUTH_HEADER");
    });

    test("401 empty bearer token", async () => {
      const response = await request(app)
        .get("/api/v1/auth/me")
        .set("Authorization", "Bearer ");

      expect(response.status).toBe(401);
      expectErrorEnvelope(response.body);
    });

    test("409 duplicate email", async () => {
      const response = await request(app)
        .post("/api/v1/auth/register")
        .send(validUser);

      expect(response.status).toBe(409);
      expectErrorEnvelope(response.body);
      expect(response.body.error.code).toBe("EMAIL_ALREADY_EXISTS");
    });

    test("400 validation failure with field-level details", async () => {
      const response = await request(app)
        .post("/api/v1/auth/register")
        .send({
          name: "A",
          email: "not-an-email",
          password: "x",
        });

      expect(response.status).toBe(400);
      expectErrorEnvelope(response.body);
      expect(response.body.error.code).toBe("VALIDATION_ERROR");
      expect(Array.isArray(response.body.error.details)).toBe(true);

      for (const issue of response.body.error.details) {
        expect(typeof issue.path).toBe("string");
        expect(typeof issue.message).toBe("string");
        expect(issue.message.length).toBeGreaterThan(0);
      }
    });
  });

  describe("AppError rung (service errors flow through unchanged)", () => {
    test("wrong password returns 401 with contract code", async () => {
      const response = await request(app)
        .post("/api/v1/auth/login")
        .send({
          email: validUser.email,
          password: "WrongPassword123!",
        });

      expect(response.status).toBe(401);
      expectErrorEnvelope(response.body);
      expect(response.body.error.code).toBe("INVALID_CREDENTIALS");
    });

    test("unknown email is indistinguishable from wrong password", async () => {
      // Security property: no user-enumeration oracle.
      const wrongEmailResponse = await request(app)
        .post("/api/v1/auth/login")
        .send({
          email: `no-such-user-${timestamp}@stox.local`,
          password: "Whatever123!",
        });

      const wrongPasswordResponse = await request(app)
        .post("/api/v1/auth/login")
        .send({
          email: validUser.email,
          password: "Whatever123!",
        });

      expect(wrongEmailResponse.status).toBe(401);
      expect(wrongPasswordResponse.status).toBe(401);
      expect(wrongEmailResponse.body.error.code).toBe(
        wrongPasswordResponse.body.error.code,
      );
      expect(wrongEmailResponse.body.error.message).toBe(
        wrongPasswordResponse.body.error.message,
      );
    });
  });

  describe("unknown error rung (no internals leak)", () => {
    test("unexpected error returns generic 500", async () => {
      authService.getCurrentUser.mockRejectedValueOnce(
        new Error("boom: secret internal detail"),
      );

      const response = await request(app)
        .get("/api/v1/auth/me")
        .set("Authorization", `Bearer ${accessToken}`);

      expect(response.status).toBe(500);
      expectErrorEnvelope(response.body);
      expect(response.body.error.code).toBe("INTERNAL_SERVER_ERROR");

      const bodyString = JSON.stringify(response.body);
      expect(bodyString).not.toContain("boom");
      expect(bodyString).not.toContain("secret internal detail");
      expect(bodyString).not.toContain("stack");
    });
  });

  describe("adversarial inputs (behavior must stay a valid envelope)", () => {
    const adversarialBodies = [
      { name: "JSON array", body: JSON.stringify([1, 2, 3]) },
      { name: "JSON string", body: JSON.stringify("just a string") },
      { name: "JSON number", body: JSON.stringify(42) },
      { name: "JSON null", body: JSON.stringify(null) },
      { name: "JSON boolean", body: JSON.stringify(true) },
    ];

    for (const { name, body } of adversarialBodies) {
      test(`${name} body is rejected with a 400 envelope, not a 500`, async () => {
        const response = await request(app)
          .post("/api/v1/auth/register")
          .set("Content-Type", "application/json")
          .send(body);

        expect(response.status).toBe(400);
        expectErrorEnvelope(response.body);
      });
    }

    test("text/plain content type is rejected with a 400 envelope, not a 500", async () => {
      const response = await request(app)
        .post("/api/v1/auth/register")
        .set("Content-Type", "text/plain")
        .send("garbage");

      expect(response.status).toBe(400);
      expectErrorEnvelope(response.body);
    });

    test("empty body with JSON content type is rejected with a 400 envelope", async () => {
      const response = await request(app)
        .post("/api/v1/auth/register")
        .set("Content-Type", "application/json")
        .send("");

      expect(response.status).toBe(400);
      expectErrorEnvelope(response.body);
    });

    test("duplicate JSON keys resolve to last value (documented behavior)", async () => {
      const rawBody = JSON.stringify({
        name: "Dup Keys User",
        email: `dup-keys-${timestamp}@stox.local`,
        password: "ValidPassword123!",
      }).replace(
        '"ValidPassword123!"',
        '"x","password":"ValidPassword123!"',
      );

      const response = await request(app)
        .post("/api/v1/auth/register")
        .set("Content-Type", "application/json")
        .send(rawBody);

      // last key wins → the valid password is used → 201
      expect(response.status).toBe(201);

      if (response.status === 201) {
        await prisma.user.delete({
          where: { id: response.body.data.user.id },
        });
      }
    });

    test("10KB name is rejected with a 400 envelope", async () => {
      const response = await request(app)
        .post("/api/v1/auth/register")
        .send({
          name: "A".repeat(10000),
          email: `huge-${timestamp}@stox.local`,
          password: validUser.password,
        });

      expect(response.status).toBe(400);
      expectErrorEnvelope(response.body);
    });

    test("unicode name round-trips through validation", async () => {
      const response = await request(app)
        .post("/api/v1/auth/register")
        .send({
          name: "  张伟 Müller 🚀  ",
          email: `unicode-${timestamp}@stox.local`,
          password: validUser.password,
        });

      expect(response.status).toBe(201);
      expect(response.body.data.user.name).toBe("张伟 Müller 🚀");

      if (response.status === 201) {
        await prisma.user.delete({
          where: { id: response.body.data.user.id },
        });
      }
    });

    test("privilege-escalation fields in payload do not reach the model", async () => {
      const response = await request(app)
        .post("/api/v1/auth/register")
        .send({
          ...validUser,
          email: `escalation-${timestamp}@stox.local`,
          role: "ADMIN",
          isSuspended: false,
          isAdmin: true,
        });

      expect(response.status).toBe(201);
      expect(response.body.data.user.role).not.toBe("ADMIN");

      if (response.status === 201) {
        await prisma.user.delete({
          where: { id: response.body.data.user.id },
        });
      }
    });

    test("auth scheme is case-insensitive per RFC 7235", async () => {
      for (const scheme of ["bearer", "Bearer", "BEARER", "BeArEr"]) {
        const response = await request(app)
          .get("/api/v1/auth/me")
          .set("Authorization", `${scheme} ${accessToken}`);

        expect(response.status).toBe(200);
      }
    });

    test("case-insensitive scheme parsing does not weaken token validation", async () => {
      // a garbage token must still be 401 even with a lowercase scheme —
      // the relaxation must not become an authentication bypass
      const response = await request(app)
        .get("/api/v1/auth/me")
        .set("Authorization", `bearer garbage.token.here`);

      expect(response.status).toBe(401);
      expectErrorEnvelope(response.body);
      expect(response.body.error.code).toBe("INVALID_ACCESS_TOKEN");
    });
  });

  describe("legacy fallback rung", () => {
    function makeMockRes() {
      return {
        statusCode: null,
        body: null,
        status(code) {
          this.statusCode = code;
          return this;
        },
        json(body) {
          this.body = body;
          return this;
        },
      };
    }

    test("errors carrying a numeric 4xx/5xx statusCode are honored", () => {
      const res = makeMockRes();

      const legacyError = new Error("old-style failure");
      legacyError.statusCode = 418;
      legacyError.code = "IM_A_TEAPOT";

      errorHandler(
        legacyError,
        { method: "GET", originalUrl: "/test" },
        res,
        () => {},
      );

      expect(res.statusCode).toBe(418);
      expect(res.body.error.code).toBe("IM_A_TEAPOT");
      expectErrorEnvelope(res.body);
    });

    test("errors with out-of-range statusCode stay generic 500", () => {
      const res = makeMockRes();

      const badError = new Error("bad status");
      badError.statusCode = 999;

      errorHandler(
        badError,
        { method: "GET", originalUrl: "/test" },
        res,
        () => {},
      );

      expect(res.statusCode).toBe(500);
      expect(res.body.error.code).toBe("INTERNAL_SERVER_ERROR");
      expectErrorEnvelope(res.body);
    });
  });

  describe("AppError class invariants", () => {
    test("factories produce operational errors with correct status", () => {
      const statuses = [
        [AppError.badRequest, 400],
        [AppError.unauthorized, 401],
        [AppError.forbidden, 403],
        [AppError.notFound, 404],
        [AppError.conflict, 409],
        [AppError.unprocessableEntity, 422],
        [AppError.tooManyRequests, 429],
        [AppError.internal, 500],
      ];

      for (const [factory, expectedStatus] of statuses) {
        const error = factory("Test message.");
        expect(error).toBeInstanceOf(Error);
        expect(error.statusCode).toBe(expectedStatus);
        expect(error.isOperational).toBe(true);
        expect(error.stack).toBeDefined();
        expect(typeof error.code).toBe("string");
        expect(error.code.length).toBeGreaterThan(0);
      }
    });

    test("custom code overrides the default", () => {
      const error = AppError.conflict("Custom conflict.", "CUSTOM_CODE");
      expect(error.code).toBe("CUSTOM_CODE");
      expect(error.statusCode).toBe(409);
    });
  });
});
