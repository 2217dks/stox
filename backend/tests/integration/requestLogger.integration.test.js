const request = require("supertest");

const app = require("../../src/app");
const prisma = require("../../src/config/database");
const logger = require("../../src/utils/logger");
const authService = require("../../src/services/authService");

jest.mock("../../src/services/authService", () => ({
  ...jest.requireActual("../../src/services/authService"),
  getCurrentUser: jest.fn(),
}));

const timestamp = Date.now();

const validUser = {
  name: "Request Logger Test User",
  email: `request-logger-${timestamp}@stox.local`,
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

// Contract invariants (task requirement "API request logging"):
// - every request logs exactly one entry with { method, url, statusCode, durationMs }
// - level: info < 400, warn 400-499, error >= 500
// - logs never contain request bodies or credentials
function loggedPayloads(levelSpy, url) {
  return levelSpy.mock.calls
    .map((call) => call[1])
    .filter(
      (payload) =>
        payload && payload.url === url && payload.durationMs !== undefined,
    );
}

describe("request logging middleware", () => {
  let infoSpy;
  let warnSpy;
  let errorSpy;

  beforeEach(() => {
    infoSpy = jest.spyOn(logger, "info").mockImplementation(() => {});
    warnSpy = jest.spyOn(logger, "warn").mockImplementation(() => {});
    errorSpy = jest.spyOn(logger, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("level split (contract: info < 400, warn 4xx, error >= 500)", () => {
    test("successful request logs at info level", async () => {
      const response = await request(app).get("/api/v1/health");

      expect(response.status).toBe(200);

      const payloads = loggedPayloads(infoSpy, "/api/v1/health");
      expect(payloads.length).toBe(1);
      expect(payloads[0].statusCode).toBe(200);
    });

    test("unknown route (404) logs at warn level", async () => {
      await request(app).get("/api/v1/definitely-not-a-route");

      const payloads = loggedPayloads(warnSpy, "/api/v1/definitely-not-a-route");
      expect(payloads.length).toBe(1);
      expect(payloads[0].statusCode).toBe(404);
    });

    test("validation failure (400) logs at warn level", async () => {
      await request(app)
        .post("/api/v1/auth/register")
        .send({ name: "A", email: "not-an-email", password: "x" });

      const payloads = loggedPayloads(warnSpy, "/api/v1/auth/register");
      expect(payloads.length).toBe(1);
      expect(payloads[0].statusCode).toBe(400);
    });

    test("server error (500) logs at error level", async () => {
      const registerResponse = await request(app)
        .post("/api/v1/auth/register")
        .send(validUser);

      if (registerResponse.status === 201) {
        userId = registerResponse.body.data.user.id;
        accessToken = registerResponse.body.data.accessToken;
      }

      authService.getCurrentUser.mockRejectedValueOnce(new Error("boom"));

      await request(app)
        .get("/api/v1/auth/me")
        .set("Authorization", `Bearer ${accessToken}`);

      const payloads = loggedPayloads(errorSpy, "/api/v1/auth/me");
      expect(payloads.length).toBe(1);
      expect(payloads[0].statusCode).toBe(500);
    });

    test("successful login logs at info level, failed login at warn", async () => {
      const good = await request(app)
        .post("/api/v1/auth/login")
        .send(validUser);

      if (good.status === 200) {
        const goodPayloads = loggedPayloads(infoSpy, "/api/v1/auth/login");
        expect(goodPayloads.length).toBe(1);
        expect(goodPayloads[0].statusCode).toBe(200);
      }

      await request(app)
        .post("/api/v1/auth/login")
        .send({ email: validUser.email, password: "WrongPassword123!" });

      const warnPayloads = loggedPayloads(warnSpy, "/api/v1/auth/login");
      expect(warnPayloads.length).toBe(1);
      expect(warnPayloads[0].statusCode).toBe(401);
    });
  });

  describe("payload shape (contract: exactly these fields)", () => {
    test("entries contain method, url, statusCode, durationMs and nothing else", async () => {
      await request(app).get("/api/v1/health");

      const payloads = loggedPayloads(infoSpy, "/api/v1/health");
      expect(payloads.length).toBeGreaterThanOrEqual(1);

      const payload = payloads[payloads.length - 1];
      const keys = Object.keys(payload).sort();
      expect(keys).toEqual(["durationMs", "method", "statusCode", "url"]);

      expect(typeof payload.method).toBe("string");
      expect(typeof payload.url).toBe("string");
      expect(payload.url.startsWith("/api/v1") || payload.url === "/api/v1/health").toBe(true);
      expect(Number.isInteger(payload.statusCode)).toBe(true);
      expect(Number.isInteger(payload.durationMs)).toBe(true);
      expect(payload.durationMs).toBeGreaterThanOrEqual(0);
    });

    test("method and url reflect the actual request", async () => {
      await request(app)
        .post("/api/v1/auth/login")
        .send({ email: "whatever@stox.local", password: "x" });

      const payloads = loggedPayloads(warnSpy, "/api/v1/auth/login");
      expect(payloads.length).toBe(1);
      expect(payloads[0].method).toBe("POST");
    });
  });

  describe("sensitive data exclusion (contract: bodies/credentials never logged)", () => {
    test("passwords and user content never appear in any log level", async () => {
      const secretPassword = "SuperSecretPassword123!";
      const secretName = "Secrets Test User Name";
      const secretEmail = `secrets-${timestamp}-2@stox.local`;

      const registerResponse = await request(app)
        .post("/api/v1/auth/register")
        .send({
          name: secretName,
          email: secretEmail,
          password: secretPassword,
        });

      const secretsUserId = registerResponse.body?.data?.user?.id;

      const allCalls = JSON.stringify([
        infoSpy.mock.calls,
        warnSpy.mock.calls,
        errorSpy.mock.calls,
      ]);

      expect(allCalls).not.toContain(secretPassword);
      expect(allCalls).not.toContain(secretName);
      expect(allCalls).not.toContain(secretEmail);

      if (secretsUserId) {
        await prisma.user.delete({ where: { id: secretsUserId } });
      }
    });

    test("tokens sent in requests never appear in logs", async () => {
      const registerResponse = await request(app)
        .post("/api/v1/auth/register")
        .send(validUser);

      if (registerResponse.status === 201) {
        userId = registerResponse.body.data.user.id;
        accessToken = registerResponse.body.data.accessToken;
      }

      await request(app)
        .get("/api/v1/auth/me")
        .set("Authorization", `Bearer ${accessToken}`);

      const allCalls = JSON.stringify([
        infoSpy.mock.calls,
        warnSpy.mock.calls,
        errorSpy.mock.calls,
      ]);

      expect(allCalls).not.toContain(accessToken);
    });
  });
});
