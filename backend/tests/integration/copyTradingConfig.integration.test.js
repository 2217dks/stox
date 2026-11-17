const request = require("supertest");

const app = require("../../src/app");
const prisma = require("../../src/config/database");

// Black-box contract for the copy-trading configuration API. The routes are
// owner-scoped: a caller can only see and mutate their own relationships, and
// a foreign relationship is indistinguishable from a missing one.

const timestamp = Date.now();

let copier;
let copierToken;
let copierDefaultPortfolioId;
let copierSecondPortfolioId;

let trader;
let otherUser;
let otherToken;

async function registerUser(label) {
  const response = await request(app).post("/api/v1/auth/register").send({
    name: `Copy Config ${label}`,
    email: `copy-config-${label}-${timestamp}@stox.local`,
    password: "TestPassword123!",
  });

  expect(response.status).toBe(201);

  const portfolios = await request(app)
    .get("/api/v1/portfolios")
    .set("Authorization", `Bearer ${response.body.data.accessToken}`);

  return {
    user: response.body.data.user,
    token: response.body.data.accessToken,
    portfolioId: portfolios.body.data.portfolios.find(
      (portfolio) => portfolio.isDefault,
    ).id,
  };
}

function postCopy(body, token = copierToken) {
  return request(app)
    .post("/api/v1/copy-trading")
    .set("Authorization", `Bearer ${token}`)
    .send(body);
}

function getCopy(query = "", token = copierToken) {
  return request(app)
    .get(`/api/v1/copy-trading${query}`)
    .set("Authorization", `Bearer ${token}`);
}

function patchCopy(id, body, token = copierToken) {
  return request(app)
    .patch(`/api/v1/copy-trading/${id}`)
    .set("Authorization", `Bearer ${token}`)
    .send(body);
}

function deleteCopy(id, token = copierToken) {
  return request(app)
    .delete(`/api/v1/copy-trading/${id}`)
    .set("Authorization", `Bearer ${token}`);
}

beforeAll(async () => {
  jest.setTimeout(30000);

  const copierState = await registerUser("copier");
  copier = copierState.user;
  copierToken = copierState.token;
  copierDefaultPortfolioId = copierState.portfolioId;

  const traderState = await registerUser("trader");
  trader = traderState.user;

  const otherState = await registerUser("other");
  otherUser = otherState.user;
  otherToken = otherState.token;

  const secondPortfolio = await request(app)
    .post("/api/v1/portfolios")
    .set("Authorization", `Bearer ${copierToken}`)
    .send({ name: `Copy Destination ${timestamp}` });

  expect(secondPortfolio.status).toBe(201);
  copierSecondPortfolioId = secondPortfolio.body.data.portfolio.id;
});

beforeEach(async () => {
  await prisma.copyTrader.deleteMany({
    where: { copierId: { in: [copier.id, otherUser.id] } },
  });
});

afterAll(async () => {
  await prisma.user.deleteMany({
    where: { id: { in: [copier.id, trader.id, otherUser.id] } },
  });

  await prisma.$disconnect();
});

describe("POST /copy-trading", () => {
  test("creates a relationship with the default allocation and destination portfolio", async () => {
    const response = await postCopy({ traderId: trader.id });

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);

    const { copyTrader } = response.body.data;

    expect(copyTrader).toMatchObject({
      traderId: trader.id,
      copyPortfolioId: copierDefaultPortfolioId,
      allocationPct: "100",
      maxTradeSize: null,
      isActive: true,
    });
    expect(copyTrader.trader).toMatchObject({
      id: trader.id,
      name: trader.name,
    });
    expect(copyTrader.copyPortfolio).toMatchObject({
      id: copierDefaultPortfolioId,
    });
  });

  test("accepts explicit allocation, max size, and destination portfolio", async () => {
    const response = await postCopy({
      traderId: trader.id,
      allocationPct: "25.50",
      maxTradeSize: "1000.25",
      copyPortfolioId: copierSecondPortfolioId,
    });

    expect(response.status).toBe(201);
    expect(response.body.data.copyTrader).toMatchObject({
      traderId: trader.id,
      copyPortfolioId: copierSecondPortfolioId,
      allocationPct: "25.5",
      maxTradeSize: "1000.25",
      isActive: true,
    });
  });

  test("rejects copying yourself", async () => {
    const response = await postCopy({ traderId: copier.id });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("COPY_TRADING_SELF_REFERENCE");
  });

  test("rejects an unknown trader", async () => {
    const response = await postCopy({
      traderId: "00000000-0000-4000-8000-000000000000",
    });

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("USER_NOT_FOUND");
  });

  test("rejects a duplicate relationship", async () => {
    const first = await postCopy({ traderId: trader.id });
    expect(first.status).toBe(201);

    const duplicate = await postCopy({ traderId: trader.id });

    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe("COPY_TRADING_ALREADY_EXISTS");
  });

  test("rejects a destination portfolio owned by another user", async () => {
    const otherPortfolios = await request(app)
      .get("/api/v1/portfolios")
      .set("Authorization", `Bearer ${otherToken}`);

    const response = await postCopy({
      traderId: trader.id,
      copyPortfolioId: otherPortfolios.body.data.portfolios[0].id,
    });

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("PORTFOLIO_NOT_FOUND");
  });

  test("rejects an inactive destination portfolio", async () => {
    const portfolio = await prisma.portfolio.create({
      data: {
        userId: copier.id,
        name: `Inactive Copy Destination ${timestamp}`,
        startingBalance: "10000",
        cashBalance: "10000",
        isActive: false,
      },
    });

    try {
      const response = await postCopy({
        traderId: trader.id,
        copyPortfolioId: portfolio.id,
      });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe("PORTFOLIO_INACTIVE");
    } finally {
      await prisma.portfolio.delete({ where: { id: portfolio.id } });
    }
  });

  test.each(["0", "100.01", "50.123", "-1"])(
    "rejects invalid allocationPct %s",
    async (allocationPct) => {
      const response = await postCopy({ traderId: trader.id, allocationPct });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe("VALIDATION_ERROR");
      expect(
        response.body.error.details.map((detail) => detail.path),
      ).toContain("allocationPct");
    },
  );

  test.each(["0", "-1", "1.123456789"])(
    "rejects invalid maxTradeSize %s",
    async (maxTradeSize) => {
      const response = await postCopy({ traderId: trader.id, maxTradeSize });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe("VALIDATION_ERROR");
      expect(
        response.body.error.details.map((detail) => detail.path),
      ).toContain("maxTradeSize");
    },
  );

  test("requires authentication", async () => {
    const response = await request(app)
      .post("/api/v1/copy-trading")
      .send({ traderId: trader.id });

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("UNAUTHORIZED");
  });

  test("strips unknown fields instead of persisting them", async () => {
    const response = await postCopy({
      traderId: trader.id,
      isActive: false,
      copierId: otherUser.id,
    });

    expect(response.status).toBe(201);
    // isActive is a supported field; copierId is not and must never override
    // the authenticated caller.
    expect(response.body.data.copyTrader.isActive).toBe(false);
    expect(response.body.data.copyTrader.traderId).toBe(trader.id);

    const stored = await prisma.copyTrader.findUnique({
      where: { id: response.body.data.copyTrader.id },
    });
    expect(stored.copierId).toBe(copier.id);
  });
});

describe("GET /copy-trading", () => {
  test("lists only the caller's relationships", async () => {
    await postCopy({ traderId: trader.id, allocationPct: "40" });

    const otherRelationship = await postCopy(
      { traderId: trader.id },
      otherToken,
    );
    expect(otherRelationship.status).toBe(201);

    const response = await getCopy();

    expect(response.status).toBe(200);
    expect(response.body.data.copyTraders).toHaveLength(1);
    expect(response.body.data.copyTraders[0]).toMatchObject({
      traderId: trader.id,
      allocationPct: "40",
    });
    expect(response.body.data.pagination).toMatchObject({
      page: 1,
      total: 1,
    });
  });

  test("filters by active state and paginates", async () => {
    const active = await postCopy({ traderId: trader.id });
    const paused = await postCopy({ traderId: otherUser.id });

    await patchCopy(paused.body.data.copyTrader.id, { isActive: false });

    const activeOnly = await getCopy("?isActive=true");
    expect(activeOnly.status).toBe(200);
    expect(activeOnly.body.data.copyTraders.map((item) => item.id)).toEqual([
      active.body.data.copyTrader.id,
    ]);

    const pausedOnly = await getCopy("?isActive=false");
    expect(pausedOnly.status).toBe(200);
    expect(pausedOnly.body.data.copyTraders.map((item) => item.id)).toEqual([
      paused.body.data.copyTrader.id,
    ]);

    const firstPage = await getCopy("?page=1&limit=1");
    expect(firstPage.body.data.copyTraders).toHaveLength(1);
    expect(firstPage.body.data.pagination).toMatchObject({
      page: 1,
      limit: 1,
      total: 2,
      totalPages: 2,
    });
  });

  test("requires authentication", async () => {
    const response = await request(app).get("/api/v1/copy-trading");
    expect(response.status).toBe(401);
  });
});

describe("PATCH /copy-trading/:id", () => {
  test("updates allocation, max size, destination, and active state", async () => {
    const created = await postCopy({ traderId: trader.id });
    const id = created.body.data.copyTrader.id;

    const response = await patchCopy(id, {
      allocationPct: "75.25",
      maxTradeSize: "500",
      copyPortfolioId: copierSecondPortfolioId,
      isActive: false,
    });

    expect(response.status).toBe(200);
    expect(response.body.data.copyTrader).toMatchObject({
      id,
      allocationPct: "75.25",
      maxTradeSize: "500",
      copyPortfolioId: copierSecondPortfolioId,
      isActive: false,
    });
  });

  test("clears maxTradeSize with null", async () => {
    const created = await postCopy({
      traderId: trader.id,
      maxTradeSize: "500",
    });

    const response = await patchCopy(created.body.data.copyTrader.id, {
      maxTradeSize: null,
    });

    expect(response.status).toBe(200);
    expect(response.body.data.copyTrader.maxTradeSize).toBeNull();
  });

  test("rejects an empty body", async () => {
    const created = await postCopy({ traderId: trader.id });

    const response = await patchCopy(created.body.data.copyTrader.id, {});

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  test("rejects a foreign relationship as not found", async () => {
    const created = await postCopy({ traderId: trader.id });

    const response = await patchCopy(
      created.body.data.copyTrader.id,
      { allocationPct: "10" },
      otherToken,
    );

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("COPY_TRADING_NOT_FOUND");
  });

  test("rejects an unknown relationship", async () => {
    const response = await patchCopy(
      "00000000-0000-4000-8000-000000000000",
      { allocationPct: "10" },
    );

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("COPY_TRADING_NOT_FOUND");
  });
});

describe("DELETE /copy-trading/:id", () => {
  test("soft-deletes the relationship and is idempotent", async () => {
    const created = await postCopy({ traderId: trader.id });
    const id = created.body.data.copyTrader.id;

    const first = await deleteCopy(id);
    expect(first.status).toBe(200);
    expect(first.body.data.copyTrader.isActive).toBe(false);

    const second = await deleteCopy(id);
    expect(second.status).toBe(200);
    expect(second.body.data.copyTrader.isActive).toBe(false);

    // The row is retained for auditability, so the unique pair still exists.
    const stored = await prisma.copyTrader.findUnique({ where: { id } });
    expect(stored).not.toBeNull();
    expect(stored.isActive).toBe(false);
  });

  test("rejects a foreign relationship as not found", async () => {
    const created = await postCopy({ traderId: trader.id });

    const response = await deleteCopy(
      created.body.data.copyTrader.id,
      otherToken,
    );

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("COPY_TRADING_NOT_FOUND");
  });
});
