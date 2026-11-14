const request = require("supertest");

const app = require("../../src/app");
const prisma = require("../../src/config/database");

jest.setTimeout(30000);

// ============================================================
// Black-box contract tests for GET /api/v1/admin/orders.
//
// These tests treat the endpoint as an HTTP service: they import the real
// app (so the real middleware chain and centralized error handler are
// exercised) and assert only on status codes and JSON bodies. No service,
// controller, validator, or serializer module is imported, so the
// assertions cannot be satisfied by mirroring implementation details.
//
// Every expectation below is traceable to a documented contract:
// - docs/API.md          -> admin orders section (parameters, ordering,
//                           response shape, error codes, field allowlist)
// - docs/ERROR_HANDLING.md -> error envelope and Zod validation details
// - docs/phase-1-api-contract-review.md -> middleware order
//                           (auth -> RBAC -> validation -> controller)
//
// Prisma is used only to arrange fixtures the public API cannot produce
// (non-PENDING statuses, historical timestamps) and to read secret values
// that must never appear in a response.
// ============================================================

const timestamp = Date.now();
const symbolTag = `AO${timestamp}`;

const stockSymbol = `${symbolTag}STK`;
const cryptoSymbol = `${symbolTag}CRY`;
const apiSymbol = `${symbolTag}API`;

// Pinned instants keep date-window assertions exact instead of racing the
// clock. All are in the past and are distinct, so newest-first ordering is
// unambiguous and does not depend on any tie-break rule.
const AT = {
  aPending: "2026-10-01T10:00:00.000Z",
  aExecuted: "2026-10-02T10:00:00.000Z",
  aExpired: "2026-10-03T10:00:00.000Z",
  bPending: "2026-10-04T10:00:00.000Z",
  bCancelled: "2026-10-05T10:00:00.000Z",
};

// Values written to the owner's account. If any of them can be read back
// through the admin order list, private user data is leaking.
const secrets = {
  pushToken: `push-token-${timestamp}`,
  googleId: `google-id-${timestamp}`,
  refreshToken: `refresh-token-${timestamp}`,
};

const accounts = {
  admin: {
    name: "Admin Orders Test Admin",
    email: `admin-orders-admin-${timestamp}@stox.local`,
    password: "AdminPassword123!",
  },
  ownerA: {
    name: "Admin Orders Owner A",
    email: `admin-orders-owner-a-${timestamp}@stox.local`,
    password: "OwnerPassword123!",
  },
  ownerB: {
    name: "Admin Orders Owner B",
    email: `admin-orders-owner-b-${timestamp}@stox.local`,
    password: "OwnerPassword123!",
  },
};

const state = {
  adminUserId: null,
  ownerAId: null,
  ownerBId: null,
  adminToken: null,
  ownerAToken: null,
  ownerBToken: null,
  portfolioAId: null,
  portfolioBId: null,
  // password hashes read from the database, used for leak assertions
  passwordHashes: [],
  orders: {},
};

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------

function getAdminOrders(query = {}, token = state.adminToken) {
  const req = request(app).get("/api/v1/admin/orders");

  if (token) {
    req.set("Authorization", `Bearer ${token}`);
  }

  return req.query(query);
}

function expectErrorEnvelope(body) {
  expect(body).toHaveProperty("success", false);
  expect(typeof body.error?.code).toBe("string");
  expect(body.error.code.length).toBeGreaterThan(0);
  expect(typeof body.error?.message).toBe("string");
  expect(body.error.message.length).toBeGreaterThan(0);
}

function expectValidationError(body, expectedPath) {
  expectErrorEnvelope(body);
  expect(body.error.code).toBe("VALIDATION_ERROR");
  expect(Array.isArray(body.error.details)).toBe(true);
  expect(body.error.details.length).toBeGreaterThan(0);

  for (const issue of body.error.details) {
    expect(typeof issue.path).toBe("string");
    expect(typeof issue.message).toBe("string");
    expect(issue.message.length).toBeGreaterThan(0);
  }

  const paths = body.error.details.map((issue) => issue.path);
  expect(
    paths.some(
      (path) => path === expectedPath || path.startsWith(`${expectedPath}.`),
    ),
  ).toBe(true);
}

function idsOf(response) {
  return response.body.data.orders.map((order) => order.id);
}

function expectNewestFirst(orders) {
  for (let index = 1; index < orders.length; index += 1) {
    const previous = new Date(orders[index - 1].createdAt).getTime();
    const current = new Date(orders[index].createdAt).getTime();

    expect(previous).toBeGreaterThanOrEqual(current);
  }
}

async function register(account) {
  const response = await request(app)
    .post("/api/v1/auth/register")
    .send(account);

  expect(response.status).toBe(201);

  return response.body.data;
}

async function login(account) {
  const response = await request(app).post("/api/v1/auth/login").send({
    email: account.email,
    password: account.password,
  });

  expect(response.status).toBe(200);

  return response.body.data.accessToken;
}

function createOrderFixture(portfolioId, spec) {
  return prisma.order.create({
    data: {
      portfolioId,
      symbol: spec.symbol,
      assetType: spec.assetType,
      side: spec.side,
      type: spec.type,
      status: spec.status,
      quantity: spec.quantity,
      limitPrice: spec.limitPrice ?? null,
      stopPrice: spec.stopPrice ?? null,
      executedPrice: spec.executedPrice ?? null,
      executedAt: spec.executedAt ?? null,
      createdAt: new Date(spec.createdAt),
    },
  });
}

// ------------------------------------------------------------
// Fixtures
// ------------------------------------------------------------

beforeAll(async () => {
  const admin = await register(accounts.admin);
  const ownerA = await register(accounts.ownerA);
  const ownerB = await register(accounts.ownerB);

  state.adminUserId = admin.user.id;
  state.ownerAId = ownerA.user.id;
  state.ownerBId = ownerB.user.id;
  state.ownerAToken = ownerA.accessToken;
  state.ownerBToken = ownerB.accessToken;

  await prisma.user.update({
    where: { id: state.adminUserId },
    data: { role: "ADMIN" },
  });

  // The role is carried in the JWT, so the admin must sign in again after the
  // database role change.
  state.adminToken = await login(accounts.admin);

  const portfolioA = await prisma.portfolio.findFirst({
    where: { userId: state.ownerAId, isDefault: true },
  });
  const portfolioB = await prisma.portfolio.findFirst({
    where: { userId: state.ownerBId, isDefault: true },
  });

  expect(portfolioA).not.toBeNull();
  expect(portfolioB).not.toBeNull();

  state.portfolioAId = portfolioA.id;
  state.portfolioBId = portfolioB.id;

  // Plant values on owner B that must never be serialized.
  await prisma.user.update({
    where: { id: state.ownerBId },
    data: {
      pushToken: secrets.pushToken,
      googleId: secrets.googleId,
      pushEnabled: true,
    },
  });

  await prisma.refreshToken.create({
    data: {
      token: secrets.refreshToken,
      userId: state.ownerBId,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  });

  const users = await prisma.user.findMany({
    where: { id: { in: [state.ownerAId, state.ownerBId] } },
    select: { passwordHash: true },
  });

  state.passwordHashes = users
    .map((user) => user.passwordHash)
    .filter((hash) => typeof hash === "string" && hash.length > 0);

  // One order is created through the public API so the suite proves that a
  // real write-path order is visible to the admin view.
  const apiOrder = await request(app)
    .post("/api/v1/orders")
    .set("Authorization", `Bearer ${state.ownerAToken}`)
    .send({
      portfolioId: state.portfolioAId,
      symbol: apiSymbol,
      assetType: "STOCK",
      side: "BUY",
      type: "LIMIT",
      quantity: "1",
      limitPrice: "100",
    });

  expect(apiOrder.status).toBe(201);
  state.orders.api = apiOrder.body.data.order;

  const [aPending, aExecuted, aExpired, bPending, bCancelled] =
    await Promise.all([
      createOrderFixture(state.portfolioAId, {
        symbol: stockSymbol,
        assetType: "STOCK",
        side: "BUY",
        type: "LIMIT",
        status: "PENDING",
        quantity: "10",
        limitPrice: "250.5",
        createdAt: AT.aPending,
      }),
      createOrderFixture(state.portfolioAId, {
        symbol: stockSymbol,
        assetType: "STOCK",
        side: "SELL",
        type: "MARKET",
        status: "EXECUTED",
        quantity: "4",
        executedPrice: "260",
        executedAt: new Date(AT.aExecuted),
        createdAt: AT.aExecuted,
      }),
      createOrderFixture(state.portfolioAId, {
        symbol: cryptoSymbol,
        assetType: "CRYPTO",
        side: "SELL",
        type: "TAKE_PROFIT",
        status: "EXPIRED",
        quantity: "0.5",
        stopPrice: "300",
        createdAt: AT.aExpired,
      }),
      createOrderFixture(state.portfolioBId, {
        symbol: cryptoSymbol,
        assetType: "CRYPTO",
        side: "BUY",
        type: "MARKET",
        status: "PENDING",
        quantity: "1.25",
        createdAt: AT.bPending,
      }),
      createOrderFixture(state.portfolioBId, {
        symbol: stockSymbol,
        assetType: "STOCK",
        side: "BUY",
        type: "STOP_LOSS",
        status: "CANCELLED",
        quantity: "2",
        stopPrice: "240",
        createdAt: AT.bCancelled,
      }),
    ]);

  state.orders.aPending = aPending;
  state.orders.aExecuted = aExecuted;
  state.orders.aExpired = aExpired;
  state.orders.bPending = bPending;
  state.orders.bCancelled = bCancelled;
});

afterAll(async () => {
  const userIds = [state.adminUserId, state.ownerAId, state.ownerBId].filter(
    Boolean,
  );

  if (userIds.length > 0) {
    // Portfolios, orders, and refresh tokens cascade from the user row.
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }

  await prisma.$disconnect();
});

// ------------------------------------------------------------
// Authentication and authorization
// ------------------------------------------------------------

describe("authentication and authorization", () => {
  test("rejects a request without credentials with 401 UNAUTHORIZED", async () => {
    const response = await getAdminOrders({}, null);

    expect(response.status).toBe(401);
    expectErrorEnvelope(response.body);
    expect(response.body.error.code).toBe("UNAUTHORIZED");
  });

  test("rejects a malformed token with 401 INVALID_ACCESS_TOKEN", async () => {
    const response = await getAdminOrders({}, "not.a.real.token");

    expect(response.status).toBe(401);
    expectErrorEnvelope(response.body);
    expect(response.body.error.code).toBe("INVALID_ACCESS_TOKEN");
  });

  test("rejects an authenticated non-admin with 403 FORBIDDEN", async () => {
    const response = await getAdminOrders({}, state.ownerAToken);

    expect(response.status).toBe(403);
    expectErrorEnvelope(response.body);
    expect(response.body.error.code).toBe("FORBIDDEN");
    expect(response.body.error.message).toBe("Administrator access required.");
  });

  // The documented middleware order is auth -> RBAC -> validation, so
  // identity failures must win over an invalid query.
  test("missing credentials outrank query validation", async () => {
    const response = await getAdminOrders({ limit: "not-a-number" }, null);

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("UNAUTHORIZED");
  });

  test("authorization outranks query validation", async () => {
    const response = await getAdminOrders(
      { limit: "not-a-number" },
      state.ownerAToken,
    );

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });

  test("allows an admin to read the listing", async () => {
    const response = await getAdminOrders({ limit: "100" });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(Array.isArray(response.body.data.orders)).toBe(true);
  });
});

// ------------------------------------------------------------
// Read-only surface
// ------------------------------------------------------------

describe("read-only surface", () => {
  for (const method of ["post", "patch", "delete"]) {
    test(`does not expose ${method.toUpperCase()} /api/v1/admin/orders`, async () => {
      const response = await request(app)
        [method]("/api/v1/admin/orders")
        .set("Authorization", `Bearer ${state.adminToken}`)
        .send({});

      expect(response.status).toBe(404);
      expectErrorEnvelope(response.body);
      expect(response.body.error.code).toBe("ROUTE_NOT_FOUND");
    });
  }
});

// ------------------------------------------------------------
// Cross-user visibility
// ------------------------------------------------------------

describe("cross-user visibility", () => {
  test("returns orders belonging to more than one owner", async () => {
    const response = await getAdminOrders({
      symbol: stockSymbol,
      limit: "100",
    });

    expect(response.status).toBe(200);

    const orders = response.body.data.orders;
    expect(orders.map((order) => order.id).sort()).toEqual(
      [
        state.orders.aPending.id,
        state.orders.aExecuted.id,
        state.orders.bCancelled.id,
      ].sort(),
    );

    expect(new Set(orders.map((order) => order.owner.id))).toEqual(
      new Set([state.ownerAId, state.ownerBId]),
    );
  });

  test("includes an order created through POST /orders", async () => {
    const response = await getAdminOrders({ symbol: apiSymbol });

    expect(response.status).toBe(200);
    expect(idsOf(response)).toEqual([state.orders.api.id]);
  });

  test("userId narrows the listing to one owner", async () => {
    const response = await getAdminOrders({
      userId: state.ownerBId,
      limit: "100",
    });

    expect(response.status).toBe(200);

    const orders = response.body.data.orders;
    expect(orders.length).toBeGreaterThan(0);

    for (const order of orders) {
      expect(order.owner.id).toBe(state.ownerBId);
    }

    const ids = idsOf(response);
    expect(ids).toContain(state.orders.bPending.id);
    expect(ids).toContain(state.orders.bCancelled.id);
    expect(ids).not.toContain(state.orders.aPending.id);
  });

  test("portfolioId narrows the listing to one portfolio", async () => {
    const response = await getAdminOrders({
      portfolioId: state.portfolioBId,
      limit: "100",
    });

    expect(response.status).toBe(200);
    expect(idsOf(response).sort()).toEqual(
      [state.orders.bPending.id, state.orders.bCancelled.id].sort(),
    );

    for (const order of response.body.data.orders) {
      expect(order.portfolio.id).toBe(state.portfolioBId);
    }
  });

  test("userId and portfolioId combine with AND, not OR", async () => {
    // Owner A's userId with owner B's portfolio cannot match anything.
    const response = await getAdminOrders({
      userId: state.ownerAId,
      portfolioId: state.portfolioBId,
    });

    expect(response.status).toBe(200);
    expect(response.body.data.orders).toEqual([]);
    expect(response.body.data.pagination.total).toBe(0);
  });
});

// ------------------------------------------------------------
// Pagination
// ------------------------------------------------------------

describe("pagination", () => {
  test("defaults to page 1 with a page size of 20", async () => {
    const response = await getAdminOrders({ userId: state.ownerAId });

    expect(response.status).toBe(200);
    expect(response.body.data.pagination).toEqual({
      page: 1,
      limit: 20,
      total: expect.any(Number),
      totalPages: expect.any(Number),
    });
  });

  test("total reflects the filtered row count, not the page size", async () => {
    const response = await getAdminOrders({
      portfolioId: state.portfolioBId,
      limit: "1",
    });

    expect(response.status).toBe(200);
    expect(response.body.data.orders).toHaveLength(1);
    expect(response.body.data.pagination.total).toBe(2);
    expect(response.body.data.pagination.limit).toBe(1);
  });

  test("consecutive pages partition the result set without overlap", async () => {
    const query = { portfolioId: state.portfolioAId, limit: "2" };

    const page1 = await getAdminOrders({ ...query, page: "1" });
    const page2 = await getAdminOrders({ ...query, page: "2" });

    expect(page1.status).toBe(200);
    expect(page2.status).toBe(200);

    const expected = [
      state.orders.api.id,
      state.orders.aPending.id,
      state.orders.aExecuted.id,
      state.orders.aExpired.id,
    ].sort();

    const page1Ids = idsOf(page1);
    const page2Ids = idsOf(page2);

    expect(page1Ids).toHaveLength(2);
    expect(page2Ids).toHaveLength(2);

    // No duplicates between pages, and together they cover every row.
    expect(page1Ids.filter((id) => page2Ids.includes(id))).toEqual([]);
    expect([...page1Ids, ...page2Ids].sort()).toEqual(expected);

    // Pagination metadata is stable across pages.
    expect(page1.body.data.pagination.total).toBe(4);
    expect(page1.body.data.pagination.totalPages).toBe(2);
    expect(page2.body.data.pagination.total).toBe(4);
    expect(page2.body.data.pagination.totalPages).toBe(2);

    // Ordering is continuous across the page boundary.
    const lastOfPage1 = page1.body.data.orders.at(-1);
    const firstOfPage2 = page2.body.data.orders[0];

    expect(new Date(lastOfPage1.createdAt).getTime()).toBeGreaterThanOrEqual(
      new Date(firstOfPage2.createdAt).getTime(),
    );
  });

  test("orders newest first", async () => {
    const response = await getAdminOrders({
      portfolioId: state.portfolioAId,
      limit: "100",
    });

    expect(response.status).toBe(200);
    expect(response.body.data.orders).toHaveLength(4);
    expectNewestFirst(response.body.data.orders);
  });

  test("a page past the end is empty, not an error", async () => {
    const response = await getAdminOrders({
      portfolioId: state.portfolioBId,
      page: "999",
      limit: "20",
    });

    expect(response.status).toBe(200);
    expect(response.body.data.orders).toEqual([]);
    expect(response.body.data.pagination.page).toBe(999);
    expect(response.body.data.pagination.total).toBe(2);
  });
});

// ------------------------------------------------------------
// Filters
// ------------------------------------------------------------

describe("filters", () => {
  test("status matches a single value", async () => {
    const response = await getAdminOrders({
      userId: state.ownerAId,
      status: "EXPIRED",
      limit: "100",
    });

    expect(response.status).toBe(200);
    expect(idsOf(response)).toEqual([state.orders.aExpired.id]);
  });

  test("status accepts a comma-separated list", async () => {
    const response = await getAdminOrders({
      userId: state.ownerAId,
      status: "PENDING,EXECUTED",
      limit: "100",
    });

    expect(response.status).toBe(200);

    const orders = response.body.data.orders;
    for (const order of orders) {
      expect(["PENDING", "EXECUTED"]).toContain(order.status);
    }

    const ids = idsOf(response);
    expect(ids).toContain(state.orders.aPending.id);
    expect(ids).toContain(state.orders.aExecuted.id);
    expect(ids).toContain(state.orders.api.id);
    expect(ids).not.toContain(state.orders.aExpired.id);
  });

  test("symbol matches exactly after normalizing case", async () => {
    const response = await getAdminOrders({
      symbol: stockSymbol.toLowerCase(),
      limit: "100",
    });

    expect(response.status).toBe(200);

    const orders = response.body.data.orders;
    expect(orders.length).toBeGreaterThan(0);

    for (const order of orders) {
      expect(order.symbol).toBe(stockSymbol);
    }
  });

  test("symbol is not a prefix or substring match", async () => {
    const response = await getAdminOrders({ symbol: symbolTag, limit: "100" });

    expect(response.status).toBe(200);
    expect(response.body.data.orders).toEqual([]);
  });

  test("side matches only that side", async () => {
    const response = await getAdminOrders({
      userId: state.ownerAId,
      side: "SELL",
      limit: "100",
    });

    expect(response.status).toBe(200);

    for (const order of response.body.data.orders) {
      expect(order.side).toBe("SELL");
    }

    const ids = idsOf(response);
    expect(ids).toContain(state.orders.aExecuted.id);
    expect(ids).toContain(state.orders.aExpired.id);
    expect(ids).not.toContain(state.orders.aPending.id);
  });

  test("type matches only that type", async () => {
    const response = await getAdminOrders({
      userId: state.ownerAId,
      type: "TAKE_PROFIT",
      limit: "100",
    });

    expect(response.status).toBe(200);
    expect(idsOf(response)).toEqual([state.orders.aExpired.id]);
  });

  test("from and to define a half-open window on createdAt", async () => {
    const response = await getAdminOrders({
      userId: state.ownerAId,
      from: "2026-10-02T00:00:00.000Z",
      to: "2026-10-04T00:00:00.000Z",
      limit: "100",
    });

    expect(response.status).toBe(200);
    // Newest first: 10-03 then 10-02.
    expect(idsOf(response)).toEqual([
      state.orders.aExpired.id,
      state.orders.aExecuted.id,
    ]);
  });

  test("from is inclusive at the exact boundary", async () => {
    const response = await getAdminOrders({
      userId: state.ownerAId,
      from: AT.aExecuted,
      to: "2026-10-04T00:00:00.000Z",
      limit: "100",
    });

    expect(response.status).toBe(200);

    const ids = idsOf(response);
    expect(ids).toContain(state.orders.aExecuted.id);
    expect(ids).not.toContain(state.orders.aPending.id);
  });

  test("to is exclusive at the exact boundary", async () => {
    const response = await getAdminOrders({
      userId: state.ownerAId,
      from: "2026-10-01T00:00:00.000Z",
      to: AT.aExpired,
      limit: "100",
    });

    expect(response.status).toBe(200);

    const ids = idsOf(response);
    expect(ids).toContain(state.orders.aExecuted.id);
    expect(ids).not.toContain(state.orders.aExpired.id);
  });

  test("a date-only to covers the whole selected day", async () => {
    const response = await getAdminOrders({
      from: "2026-10-05",
      to: "2026-10-05",
      limit: "100",
    });

    expect(response.status).toBe(200);

    const ids = idsOf(response);
    expect(ids).toEqual([state.orders.bCancelled.id]);
  });

  test("filters compose across every dimension", async () => {
    const response = await getAdminOrders({
      userId: state.ownerAId,
      portfolioId: state.portfolioAId,
      symbol: cryptoSymbol,
      side: "SELL",
      type: "TAKE_PROFIT",
      status: "EXPIRED",
      from: "2026-10-01T00:00:00.000Z",
      to: "2026-10-04T00:00:00.000Z",
    });

    expect(response.status).toBe(200);
    expect(idsOf(response)).toEqual([state.orders.aExpired.id]);
    expect(response.body.data.pagination.total).toBe(1);
  });

  test("unknown query parameters are ignored", async () => {
    const plain = await getAdminOrders({
      userId: state.ownerAId,
      limit: "100",
    });
    const decorated = await getAdminOrders({
      userId: state.ownerAId,
      limit: "100",
      sort: "-createdAt",
      admin: "true",
    });

    expect(plain.status).toBe(200);
    expect(decorated.status).toBe(200);
    expect(idsOf(decorated)).toEqual(idsOf(plain));
  });

  test("valid but unknown owner and portfolio ids return an empty page", async () => {
    const unknownId = "550e8400-e29b-41d4-a716-446655440000";

    const byOwner = await getAdminOrders({ userId: unknownId });
    const byPortfolio = await getAdminOrders({ portfolioId: unknownId });

    for (const response of [byOwner, byPortfolio]) {
      expect(response.status).toBe(200);
      expect(response.body.data.orders).toEqual([]);
      expect(response.body.data.pagination.total).toBe(0);
    }
  });
});

// ------------------------------------------------------------
// Query validation
// ------------------------------------------------------------

describe("query validation", () => {
  const invalidQueries = [
    { label: "page below 1", query: { page: "0" }, path: "page" },
    { label: "non-numeric page", query: { page: "abc" }, path: "page" },
    { label: "non-integer page", query: { page: "1.5" }, path: "page" },
    { label: "limit below 1", query: { limit: "0" }, path: "limit" },
    { label: "limit above 100", query: { limit: "101" }, path: "limit" },
    { label: "unknown status", query: { status: "FILLED" }, path: "status" },
    {
      label: "empty status segment",
      query: { status: "PENDING," },
      path: "status",
    },
    { label: "unknown side", query: { side: "HOLD" }, path: "side" },
    { label: "unknown type", query: { type: "ICEBERG" }, path: "type" },
    {
      label: "non-uuid portfolioId",
      query: { portfolioId: "not-a-uuid" },
      path: "portfolioId",
    },
    {
      label: "non-uuid userId",
      query: { userId: "not-a-uuid" },
      path: "userId",
    },
    {
      label: "datetime without a UTC offset",
      query: { from: "2026-10-01T10:00:00" },
      path: "from",
    },
    {
      label: "impossible calendar date",
      query: { from: "2026-02-30" },
      path: "from",
    },
    {
      label: "to earlier than from",
      query: { from: "2026-10-05", to: "2026-10-04" },
      path: "to",
    },
  ];

  for (const { label, query, path } of invalidQueries) {
    test(`rejects ${label} with 400 VALIDATION_ERROR`, async () => {
      const response = await getAdminOrders(query);

      expect(response.status).toBe(400);
      expectValidationError(response.body, path);
    });
  }
});

// ------------------------------------------------------------
// Response contract and safe serialization
// ------------------------------------------------------------

const DOCUMENTED_ORDER_FIELDS = [
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
  "portfolio",
  "owner",
].sort();

describe("response contract", () => {
  test("uses the standard success envelope", async () => {
    const response = await getAdminOrders({ limit: "1" });

    expect(response.status).toBe(200);
    expect(response.type).toBe("application/json");
    expect(Object.keys(response.body).sort()).toEqual(["data", "success"]);
    expect(Object.keys(response.body.data).sort()).toEqual([
      "orders",
      "pagination",
    ]);
    expect(Object.keys(response.body.data.pagination).sort()).toEqual([
      "limit",
      "page",
      "total",
      "totalPages",
    ]);
  });

  test("serializes exactly the documented order, portfolio, and owner fields", async () => {
    const response = await getAdminOrders({
      symbol: stockSymbol,
      limit: "100",
    });

    expect(response.status).toBe(200);
    expect(response.body.data.orders.length).toBeGreaterThan(0);

    for (const order of response.body.data.orders) {
      expect(Object.keys(order).sort()).toEqual(DOCUMENTED_ORDER_FIELDS);
      expect(Object.keys(order.portfolio).sort()).toEqual([
        "id",
        "isActive",
        "name",
      ]);
      expect(Object.keys(order.owner).sort()).toEqual(["email", "id", "name"]);

      // The embedded portfolio is the same record the order points at.
      expect(order.portfolio.id).toBe(order.portfolioId);

      // Related records are always materialized, never null.
      expect(typeof order.portfolio.id).toBe("string");
      expect(typeof order.owner.id).toBe("string");
      expect(order.portfolio.id.length).toBeGreaterThan(0);
      expect(order.owner.id.length).toBeGreaterThan(0);

      expect(order).not.toHaveProperty("trade");
    }
  });

  test("owner context identifies the right account", async () => {
    const response = await getAdminOrders({ portfolioId: state.portfolioBId });

    expect(response.status).toBe(200);

    const order = response.body.data.orders.find(
      (candidate) => candidate.id === state.orders.bPending.id,
    );

    expect(order.owner).toEqual({
      id: state.ownerBId,
      name: accounts.ownerB.name,
      email: accounts.ownerB.email,
    });
    expect(order.portfolio).toEqual({
      id: state.portfolioBId,
      name: expect.any(String),
      isActive: true,
    });
  });

  test("decimal columns are serialized as strings", async () => {
    const response = await getAdminOrders({ limit: "100" });

    expect(response.status).toBe(200);

    const byId = new Map(
      response.body.data.orders.map((order) => [order.id, order]),
    );

    for (const order of response.body.data.orders) {
      expect(typeof order.quantity).toBe("string");

      for (const field of ["limitPrice", "stopPrice", "executedPrice"]) {
        expect(order[field] === null || typeof order[field] === "string").toBe(
          true,
        );
      }
    }

    expect(byId.get(state.orders.aPending.id)).toMatchObject({
      quantity: "10",
      limitPrice: "250.5",
      stopPrice: null,
    });
    expect(byId.get(state.orders.aExecuted.id)).toMatchObject({
      quantity: "4",
      executedPrice: "260",
    });
    expect(byId.get(state.orders.aExpired.id)).toMatchObject({
      quantity: "0.5",
      stopPrice: "300",
    });
    expect(byId.get(state.orders.bCancelled.id)).toMatchObject({
      quantity: "2",
      stopPrice: "240",
    });
  });

  test("never exposes credentials, tokens, or unrelated account fields", async () => {
    const response = await getAdminOrders({ limit: "100" });

    expect(response.status).toBe(200);
    expect(response.body.data.orders.length).toBeGreaterThan(0);

    const serialized = JSON.stringify(response.body);

    // Values that exist in the database must never be readable through the
    // API, not even indirectly.
    const forbiddenValues = [
      ...state.passwordHashes,
      secrets.pushToken,
      secrets.googleId,
      secrets.refreshToken,
    ];

    expect(forbiddenValues.length).toBeGreaterThan(0);

    for (const value of forbiddenValues) {
      expect(serialized).not.toContain(value);
    }

    // Sensitive field names must not appear either.
    for (const field of [
      "passwordHash",
      "googleId",
      "pushToken",
      "refreshTokens",
      "emailAlerts",
      "emailDigest",
      "pushEnabled",
      "isVerified",
      "isSuspended",
      "avatarUrl",
      "lastLoginAt",
    ]) {
      expect(serialized).not.toContain(`"${field}"`);
    }

    // The owner block is the documented allowlist, nothing more.
    for (const order of response.body.data.orders) {
      expect(Object.keys(order.owner).sort()).toEqual(["email", "id", "name"]);
      expect(order.owner).not.toHaveProperty("role");
    }
  });
});

// ------------------------------------------------------------
// User-facing ownership isolation must remain intact
// ------------------------------------------------------------

describe("user-facing order isolation is unchanged", () => {
  test("GET /orders still hides other users' orders", async () => {
    const response = await request(app)
      .get("/api/v1/orders")
      .set("Authorization", `Bearer ${state.ownerAToken}`)
      .query({ limit: "100" });

    expect(response.status).toBe(200);

    const ids = response.body.data.orders.map((order) => order.id);
    expect(ids).toContain(state.orders.aPending.id);
    expect(ids).not.toContain(state.orders.bPending.id);
    expect(ids).not.toContain(state.orders.bCancelled.id);
  });

  test("GET /orders still refuses another user's portfolio", async () => {
    const response = await request(app)
      .get("/api/v1/orders")
      .set("Authorization", `Bearer ${state.ownerAToken}`)
      .query({ portfolioId: state.portfolioBId, limit: "100" });

    expect(response.status).toBe(200);
    expect(response.body.data.orders).toEqual([]);
  });
});
