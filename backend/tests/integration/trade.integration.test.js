const request = require("supertest");

const app = require("../../src/app");
const prisma = require("../../src/config/database");

// Black-box tests for the trade read APIs, exercised through the HTTP layer
// only. Contract invariants (docs/API.md + repo-wide conventions):
// - failures: { success: false, error: { code, message, details? } }
// - validation failures: 400 VALIDATION_ERROR, details = [{ path, message }]
// - identity before validity: bad/missing auth is 401 even with a bad query
// - foreign/missing trades are 404, never 403
// - exact messages are NOT asserted (copy may change; contract may not).
//
// No execution path exists yet, so trade fixtures are inserted directly via
// Prisma (EXECUTED order + its 1:1 trade), the same way suites clean up
// through the Prisma client. Cleanup relies on the user cascade
// (User -> Portfolio -> Order/Trade).
const timestamp = Date.now();

const validUserA = {
  name: "Trade Test User A",
  email: `trade-a-${timestamp}@stox.local`,
  password: "TestPassword123!",
};

const validUserB = {
  name: "Trade Test User B",
  email: `trade-b-${timestamp}@stox.local`,
  password: "TestPassword123!",
};

let userAId;
let accessTokenA;
let portfolioAId;

let userBId;
let accessTokenB;
let portfolioBId;
let tradeBId;

// User A fixtures, oldest first so "newest first" ordering is observable.
const day = 24 * 60 * 60 * 1000;
const fixtureSpecs = [
  {
    key: "aapl-buy",
    symbol: "AAPL",
    assetType: "STOCK",
    side: "BUY",
    quantity: "10",
    price: "175.50",
    totalValue: "1755.00",
    executedAt: new Date(Date.now() - 5 * day),
    realizedPnl: null,
    realizedPnlPct: null,
  },
  {
    key: "aapl-sell",
    symbol: "AAPL",
    assetType: "STOCK",
    side: "SELL",
    quantity: "4",
    price: "182.00",
    totalValue: "728.00",
    executedAt: new Date(Date.now() - 2 * day),
    realizedPnl: "26.00",
    realizedPnlPct: "3.70",
  },
  {
    key: "btc-buy",
    symbol: "BTCUSDT",
    assetType: "CRYPTO",
    side: "BUY",
    quantity: "0.5",
    price: "59850.00",
    totalValue: "29925.00",
    executedAt: new Date(Date.now() - 1 * day),
    realizedPnl: null,
    realizedPnlPct: null,
  },
];

let tradeAaplBuyId;
let tradeAaplSellId;
let tradeBtcBuyId;

async function createTradeFixture(userId, portfolioId, spec) {
  const order = await prisma.order.create({
    data: {
      portfolioId,
      symbol: spec.symbol,
      assetType: spec.assetType,
      side: spec.side,
      type: "MARKET",
      status: "EXECUTED",
      quantity: spec.quantity,
      executedPrice: spec.price,
      executedAt: spec.executedAt,
    },
  });

  return prisma.trade.create({
    data: {
      portfolioId,
      orderId: order.id,
      symbol: spec.symbol,
      assetType: spec.assetType,
      side: spec.side,
      quantity: spec.quantity,
      price: spec.price,
      totalValue: spec.totalValue,
      realizedPnl: spec.realizedPnl,
      realizedPnlPct: spec.realizedPnlPct,
      executedAt: spec.executedAt,
    },
  });
}

beforeAll(async () => {
  jest.setTimeout(30000);

  const registerA = await request(app)
    .post("/api/v1/auth/register")
    .send(validUserA);

  userAId = registerA.body.data.user.id;
  accessTokenA = registerA.body.data.accessToken;

  const portfoliosA = await request(app)
    .get("/api/v1/portfolios")
    .set("Authorization", `Bearer ${accessTokenA}`);

  portfolioAId = portfoliosA.body.data.portfolios.find(
    (portfolio) => portfolio.isDefault,
  ).id;

  const registerB = await request(app)
    .post("/api/v1/auth/register")
    .send(validUserB);

  userBId = registerB.body.data.user.id;
  accessTokenB = registerB.body.data.accessToken;

  const portfoliosB = await request(app)
    .get("/api/v1/portfolios")
    .set("Authorization", `Bearer ${accessTokenB}`);

  portfolioBId = portfoliosB.body.data.portfolios.find(
    (portfolio) => portfolio.isDefault,
  ).id;

  const [, aaplBuy, aaplSell, btcBuy] = await Promise.all([
    createTradeFixture(userBId, portfolioBId, {
      ...fixtureSpecs[0],
      key: "b-fixture",
    }),
    createTradeFixture(userAId, portfolioAId, fixtureSpecs[0]),
    createTradeFixture(userAId, portfolioAId, fixtureSpecs[1]),
    createTradeFixture(userAId, portfolioAId, fixtureSpecs[2]),
  ]);

  tradeAaplBuyId = aaplBuy.id;
  tradeAaplSellId = aaplSell.id;
  tradeBtcBuyId = btcBuy.id;
  tradeBId = (await createTradeFixture(userBId, portfolioBId, {
    ...fixtureSpecs[1],
    key: "b-fixture",
  })).id;
});

afterAll(async () => {
  if (userAId) {
    await prisma.user.delete({ where: { id: userAId } }).catch(() => {});
  }

  if (userBId) {
    await prisma.user.delete({ where: { id: userBId } }).catch(() => {});
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

async function listTrades(query, token = accessTokenA) {
  const request_ = request(app).get("/api/v1/trades");

  if (token) {
    request_.set("Authorization", `Bearer ${token}`);
  }

  return request_.query(query);
}

async function getTrade(tradeId, token = accessTokenA) {
  const request_ = request(app).get(`/api/v1/trades/${tradeId}`);

  if (token) {
    request_.set("Authorization", `Bearer ${token}`);
  }

  return request_;
}

describe("trade history (black-box via GET /trades)", () => {
  describe("authentication", () => {
    test("missing token is 401 even with an invalid query", async () => {
      const response = await listTrades({ limit: "not-a-number" }, null);

      expect(response.status).toBe(401);
      expectErrorEnvelope(response.body);
    });

    test("garbage token is 401", async () => {
      const response = await listTrades({}, "garbage.token.here");

      expect(response.status).toBe(401);
      expectErrorEnvelope(response.body);
    });
  });

  describe("list contract", () => {
    test("returns only the authenticated user's trades, newest first", async () => {
      const response = await listTrades({});

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);

      const { trades, pagination } = response.body.data;
      expect(Array.isArray(trades)).toBe(true);
      expect(trades).toHaveLength(3);
      expect(trades.map((trade) => trade.id)).toEqual([
        tradeBtcBuyId,
        tradeAaplSellId,
        tradeAaplBuyId,
      ]);

      for (const trade of trades) {
        expect(trade.portfolioId).toBe(portfolioAId);
      }

      expect(pagination).toEqual({
        page: 1,
        limit: 20,
        total: 3,
        totalPages: 1,
      });
    });

    test("decimal fields are serialized as strings preserving precision", async () => {
      const response = await listTrades({ symbol: "aapl", side: "SELL" });

      expect(response.status).toBe(200);

      const trade = response.body.data.trades[0];
      expect(trade.id).toBe(tradeAaplSellId);
      expect(typeof trade.quantity).toBe("string");
      expect(typeof trade.price).toBe("string");
      expect(typeof trade.totalValue).toBe("string");
      expect(typeof trade.fees).toBe("string");
      expect(trade.realizedPnl).toBe("26");
      expect(trade.realizedPnlPct).toBe("3.7");
    });

    test("symbol filter is normalized (case-insensitive)", async () => {
      const response = await listTrades({ symbol: "aapl" });

      expect(response.status).toBe(200);
      expect(response.body.data.trades).toHaveLength(2);

      for (const trade of response.body.data.trades) {
        expect(trade.symbol).toBe("AAPL");
      }
    });

    test("side filter accepts enum values only", async () => {
      const response = await listTrades({ side: "BUY" });

      expect(response.status).toBe(200);
      expect(response.body.data.trades).toHaveLength(2);

      for (const trade of response.body.data.trades) {
        expect(trade.side).toBe("BUY");
      }
    });

    test("own portfolioId filter returns that portfolio's trades", async () => {
      const response = await listTrades({ portfolioId: portfolioAId });

      expect(response.status).toBe(200);
      expect(response.body.data.trades).toHaveLength(3);
    });

    test("foreign portfolioId yields an empty list, not an error", async () => {
      const response = await listTrades({ portfolioId: portfolioBId });

      expect(response.status).toBe(200);
      expect(response.body.data.trades).toEqual([]);
      expect(response.body.data.pagination.total).toBe(0);
      expect(response.body.data.pagination.totalPages).toBe(0);
    });

    test("date window [from, to) filters on executedAt", async () => {
      const from = new Date(Date.now() - 3 * day).toISOString();
      const to = new Date().toISOString();
      const response = await listTrades({ from, to });

      expect(response.status).toBe(200);
      expect(response.body.data.trades.map((trade) => trade.id)).toEqual([
        tradeBtcBuyId,
        tradeAaplSellId,
      ]);
    });

    test("date-only bounds cover whole days (to is exclusive next midnight)", async () => {
      const fromDate = new Date(Date.now() - 3 * day)
        .toISOString()
        .slice(0, 10);
      const toDate = new Date().toISOString().slice(0, 10);
      const response = await listTrades({ from: fromDate, to: toDate });

      expect(response.status).toBe(200);
      expect(response.body.data.trades.map((trade) => trade.id)).toEqual([
        tradeBtcBuyId,
        tradeAaplSellId,
      ]);
    });

    test("pagination returns the requested slice with metadata", async () => {
      const response = await listTrades({ page: "2", limit: "1" });

      expect(response.status).toBe(200);
      expect(response.body.data.trades.map((trade) => trade.id)).toEqual([
        tradeAaplSellId,
      ]);
      expect(response.body.data.pagination).toEqual({
        page: 2,
        limit: 1,
        total: 3,
        totalPages: 3,
      });
    });

    test("allowlisted sort reorders results (totalValue asc)", async () => {
      const response = await listTrades({ sort: "totalValue", order: "asc" });

      expect(response.status).toBe(200);
      expect(response.body.data.trades.map((trade) => trade.id)).toEqual([
        tradeAaplSellId,
        tradeAaplBuyId,
        tradeBtcBuyId,
      ]);
    });

    test("sort without order defaults to desc", async () => {
      const response = await listTrades({ sort: "totalValue" });

      expect(response.status).toBe(200);
      expect(response.body.data.trades.map((trade) => trade.id)).toEqual([
        tradeBtcBuyId,
        tradeAaplBuyId,
        tradeAaplSellId,
      ]);
    });
  });

  describe("query validation", () => {
    const invalidQueries = [
      { case: "page below 1", query: { page: "0" }, path: "page" },
      { case: "non-integer page", query: { page: "1.5" }, path: "page" },
      { case: "limit above 100", query: { limit: "101" }, path: "limit" },
      { case: "invalid side", query: { side: "HOLD" }, path: "side" },
      {
        case: "invalid portfolioId",
        query: { portfolioId: "not-a-uuid" },
        path: "portfolioId",
      },
      {
        case: "datetime without UTC offset",
        query: { from: "2026-10-01T10:00:00" },
        path: "from",
      },
      {
        case: "impossible calendar date",
        query: { from: "2026-02-30" },
        path: "from",
      },
      {
        case: "'to' before 'from'",
        query: { from: "2026-10-05", to: "2026-10-04" },
        path: "to",
      },
      { case: "sort outside allowlist", query: { sort: "price" }, path: "sort" },
      { case: "invalid order", query: { order: "ASC" }, path: "order" },
    ];

    for (const { case: label, query, path } of invalidQueries) {
      test(`rejects ${label} with 400 VALIDATION_ERROR`, async () => {
        const response = await listTrades(query);

        expect(response.status).toBe(400);
        expectValidationDetails(response.body);
        expect(pathsOf(response.body)).toContain(path);
      });
    }
  });
});

describe("trade detail (black-box via GET /trades/:id)", () => {
  test("missing token is 401", async () => {
    const response = await getTrade(tradeAaplBuyId, null);

    expect(response.status).toBe(401);
    expectErrorEnvelope(response.body);
  });

  test("returns the owner's trade with the flat serialized shape", async () => {
    const response = await getTrade(tradeAaplBuyId);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);

    const trade = response.body.data.trade;
    expect(trade.id).toBe(tradeAaplBuyId);
    expect(trade.portfolioId).toBe(portfolioAId);
    expect(trade).toHaveProperty("orderId");
    expect(trade.symbol).toBe("AAPL");
    expect(trade.side).toBe("BUY");
    expect(trade.quantity).toBe("10");
    expect(trade.price).toBe("175.5");
    expect(trade.totalValue).toBe("1755");
    expect(trade.fees).toBe("0");
    expect(trade.realizedPnl).toBeNull();
    expect(trade.realizedPnlPct).toBeNull();
    expect(new Date(trade.executedAt).getTime()).toBe(
      fixtureSpecs[0].executedAt.getTime(),
    );
  });

  test("foreign trade is 404 TRADE_NOT_FOUND, never 403", async () => {
    const response = await getTrade(tradeBId);

    expect(response.status).toBe(404);
    expectErrorEnvelope(response.body);
    expect(response.body.error.code).toBe("TRADE_NOT_FOUND");
  });

  test("nonexistent trade id is 404 TRADE_NOT_FOUND", async () => {
    const response = await getTrade(
      "8b2c1a4e-3f2d-4c5b-9a8e-7d6c5b4a3f2e",
    );

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("TRADE_NOT_FOUND");
  });

  test("invalid uuid param is 400 VALIDATION_ERROR", async () => {
    const response = await getTrade("not-a-uuid");

    expect(response.status).toBe(400);
    expectValidationDetails(response.body);
    expect(pathsOf(response.body)).toContain("id");
  });
});
