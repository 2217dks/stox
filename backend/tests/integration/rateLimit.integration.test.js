const request = require("supertest");

// Each describe below builds a fresh src/app.js via jest.isolateModules so
// every tier gets its own limiter store and env-driven limits. Re-running
// config/database.js per graph would spawn multiple Prisma engine instances
// in one process (crashes with "encoded data was not valid for encoding
// utf-8"), so the client is created once here and every graph shares it.
const mockPrisma = jest.requireActual("../../src/config/database");
jest.mock("../../src/config/database", () => mockPrisma);
const prisma = mockPrisma;

const WAIT_AFTER_WINDOW_MS = 1400;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Contract invariants (docs/SECURITY.md "Rate Limiting" + response envelope):
// - three tiers: global (per-IP on /api), auth (per-IP on login/register/refresh),
//   order (per-USER on order creation)
// - every 429 uses the standard envelope with code RATE_LIMITED
// - every 429 exposes draft-8 RateLimit-* headers so clients can back off
// - every limiter RESETS once its window elapses (in-memory store, wall clock)
// Each describe builds a FRESH src/app.js via jest.isolateModules with its own
// env-driven limits and therefore its own limiter stores.

const ORIGINAL_ENV = { ...process.env };

function buildApp(env) {
  for (const [key, value] of Object.entries(env)) {
    process.env[key] = value;
  }

  let app;
  jest.isolateModules(() => {
    app = require("../../src/app");
  });
  return app;
}

const timestamp = Date.now();

async function registerUser(app, suffix) {
  const res = await request(app)
    .post("/api/v1/auth/register")
    .send({
      name: `Rate Limit User ${suffix}`,
      email: `rate-limit-${suffix}-${timestamp}@stox.local`,
      password: "TestPassword123!",
    })
    .expect(201);

  const token = res.body.data.accessToken;
  const payload = JSON.parse(
    Buffer.from(token.split(".")[1], "base64").toString(),
  );

  return { token, userId: payload.userId };
}

async function createPortfolio(app, token, name) {
  const res = await request(app)
    .post("/api/v1/portfolios")
    .set("Authorization", `Bearer ${token}`)
    .send({ name })
    .expect(201);
  return res.body.data.portfolio.id;
}

function placeOrder(app, token, portfolioId) {
  return request(app)
    .post("/api/v1/orders")
    .set("Authorization", `Bearer ${token}`)
    .send({
      portfolioId,
      symbol: "AAPL",
      assetType: "STOCK",
      side: "BUY",
      quantity: 1,
    });
}

function expectRateLimited(res, limit) {
  expect(res.status).toBe(429);
  expect(res.body.success).toBe(false);
  expect(res.body.error.code).toBe("RATE_LIMITED");
  expect(typeof res.body.error.message).toBe("string");
  expect(res.headers["ratelimit-limit"]).toBe(String(limit));
  expect(res.headers["ratelimit-remaining"]).toBe("0");
  expect(res.headers["ratelimit-reset"]).toBeDefined();
}

afterAll(async () => {
  process.env = { ...ORIGINAL_ENV };
  await prisma.$disconnect();
});

describe("global limiter (per-IP on /api)", () => {
  const GLOBAL_MAX = 5;
  const app = buildApp({
    RATE_LIMIT_ENABLED: "true",
    RATE_LIMIT_GLOBAL_MAX: String(GLOBAL_MAX),
    RATE_LIMIT_WINDOW_MS: "1000",
    RATE_LIMIT_AUTH_MAX: "1000",
    RATE_LIMIT_ORDER_WINDOW_MS: "1000",
    RATE_LIMIT_ORDER_MAX: "1000",
  });

  test("requests under the limit pass through", async () => {
    for (let i = 0; i < GLOBAL_MAX; i += 1) {
      await request(app).get("/api/v1/health").expect(200);
    }
  });

  test("the request after the limit is rejected with 429, envelope, and headers", async () => {
    const res = await request(app).get("/api/v1/health");
    expectRateLimited(res, GLOBAL_MAX);
  });

  test("the limiter resets once the window elapses", async () => {
    await wait(WAIT_AFTER_WINDOW_MS);
    await request(app).get("/api/v1/health").expect(200);
  });
});

describe("auth limiter (per-IP on login/register/refresh)", () => {
  const AUTH_MAX = 3;
  const app = buildApp({
    RATE_LIMIT_ENABLED: "true",
    RATE_LIMIT_AUTH_MAX: String(AUTH_MAX),
    RATE_LIMIT_WINDOW_MS: "1000",
    RATE_LIMIT_GLOBAL_MAX: "1000",
    RATE_LIMIT_ORDER_WINDOW_MS: "1000",
    RATE_LIMIT_ORDER_MAX: "1000",
  });

  const badLogin = () =>
    request(app)
      .post("/api/v1/auth/login")
      .send({ email: "ghost@stox.local", password: "WrongPass123!" });

  test("failed attempts under the limit get their normal status code", async () => {
    for (let i = 0; i < AUTH_MAX; i += 1) {
      await badLogin().expect(401);
    }
  });

  test("the next attempt is rate limited with envelope and headers", async () => {
    expectRateLimited(await badLogin(), AUTH_MAX);
  });

  test("the budget is shared across login, register, and refresh", async () => {
    const registerRes = await request(app)
      .post("/api/v1/auth/register")
      .send({
        name: "Shared Budget Probe",
        email: `shared-budget-${timestamp}@stox.local`,
        password: "TestPassword123!",
      });
    expect(registerRes.status).toBe(429);
    expect(registerRes.body.error.code).toBe("RATE_LIMITED");
  });

  test("endpoints outside the tier are untouched while the budget is exhausted", async () => {
    const res = await request(app).get("/api/v1/auth/me");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  test("the limiter resets once the window elapses", async () => {
    await wait(WAIT_AFTER_WINDOW_MS);
    await badLogin().expect(401);
  });
});

describe("order limiter (per-USER on order creation)", () => {
  const ORDER_MAX = 2;
  const app = buildApp({
    RATE_LIMIT_ENABLED: "true",
    RATE_LIMIT_ORDER_MAX: String(ORDER_MAX),
    RATE_LIMIT_ORDER_WINDOW_MS: "1000",
    RATE_LIMIT_WINDOW_MS: "1000",
    RATE_LIMIT_AUTH_MAX: "1000",
    RATE_LIMIT_GLOBAL_MAX: "1000",
  });

  let userA;
  let userAPortfolioId;
  let userB;
  let userBPortfolioId;

  beforeAll(async () => {
    userA = await registerUser(app, "order-a");
    userAPortfolioId = await createPortfolio(
      app,
      userA.token,
      "Order Limiter A",
    );
    userB = await registerUser(app, "order-b");
    userBPortfolioId = await createPortfolio(
      app,
      userB.token,
      "Order Limiter B",
    );
  });

  test("a user can place orders up to the limit", async () => {
    for (let i = 0; i < ORDER_MAX; i += 1) {
      await placeOrder(app, userA.token, userAPortfolioId).expect(201);
    }
  });

  test("exceeding the personal limit returns 429 with envelope and headers", async () => {
    expectRateLimited(
      await placeOrder(app, userA.token, userAPortfolioId),
      ORDER_MAX,
    );
  });

  test("another user's budget is untouched (per-user keying)", async () => {
    await placeOrder(app, userB.token, userBPortfolioId).expect(201);
  });

  test("unauthenticated requests are rejected by auth before the limiter", async () => {
    const res = await request(app).post("/api/v1/orders").send({
      portfolioId: userAPortfolioId,
      symbol: "AAPL",
      assetType: "STOCK",
      side: "BUY",
      quantity: 1,
    });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  test("the user's limiter resets once the window elapses", async () => {
    await wait(WAIT_AFTER_WINDOW_MS);
    await placeOrder(app, userA.token, userAPortfolioId).expect(201);
  });

  afterAll(async () => {
    const userIds = [userA.userId, userB.userId];
    await prisma.order.deleteMany({
      where: { portfolio: { userId: { in: userIds } } },
    });
    await prisma.portfolio.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  });
});
