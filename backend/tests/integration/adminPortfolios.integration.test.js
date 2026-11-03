process.env.JWT_ACCESS_SECRET ||= "admin-portfolios-integration-test-secret";

function decimal(value) {
  return { toString: () => value };
}

const mockUsers = [
  {
    id: "00000000-0000-4000-8000-000000000001",
    email: "portfolio-admin@example.test",
    name: "Portfolio Admin",
    role: "ADMIN",
    isSuspended: false,
    passwordHash: "private-password-hash",
    pushToken: "private-push-token",
  },
  {
    id: "00000000-0000-4000-8000-000000000002",
    email: "owner-alpha@example.test",
    name: "Portfolio Owner Alpha",
    role: "TRADER",
    isSuspended: false,
    passwordHash: "private-owner-hash",
    pushToken: "private-owner-push-token",
  },
  {
    id: "00000000-0000-4000-8000-000000000003",
    email: "owner-beta@example.test",
    name: "Portfolio Owner Beta",
    role: "TRADER",
    isSuspended: false,
    passwordHash: "private-beta-hash",
    pushToken: "private-beta-push-token",
  },
];

const mockPortfolios = [
  {
    id: "00000000-0000-4000-8000-000000000011",
    userId: mockUsers[1].id,
    name: "Alpha Growth",
    description: "Growth portfolio",
    startingBalance: decimal("1234.12345678"),
    cashBalance: decimal("234.87654321"),
    isDefault: true,
    isActive: true,
    createdAt: new Date("2026-01-03T00:00:00.000Z"),
    updatedAt: new Date("2026-01-03T00:00:00.000Z"),
    user: mockUsers[1],
    holdings: [{ secret: "unselected relation" }],
  },
  {
    id: "00000000-0000-4000-8000-000000000012",
    userId: mockUsers[1].id,
    name: "Alpha Dividend",
    description: null,
    startingBalance: decimal("9999.99999999"),
    cashBalance: decimal("0.00000001"),
    isDefault: false,
    isActive: true,
    createdAt: new Date("2026-01-02T00:00:00.000Z"),
    updatedAt: new Date("2026-01-02T00:00:00.000Z"),
    user: mockUsers[1],
  },
  {
    id: "00000000-0000-4000-8000-000000000013",
    userId: mockUsers[1].id,
    name: "Alpha Archive",
    description: null,
    startingBalance: decimal("10.00000001"),
    cashBalance: decimal("0"),
    isDefault: false,
    isActive: false,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    user: mockUsers[1],
  },
  {
    id: "00000000-0000-4000-8000-000000000014",
    userId: mockUsers[2].id,
    name: "Beta Cash",
    description: null,
    startingBalance: decimal("500.50"),
    cashBalance: decimal("500.50"),
    isDefault: true,
    isActive: true,
    createdAt: new Date("2026-01-04T00:00:00.000Z"),
    updatedAt: new Date("2026-01-04T00:00:00.000Z"),
    user: mockUsers[2],
  },
];

function matchesWhere(portfolio, where = {}) {
  if (where.userId && portfolio.userId !== where.userId) return false;
  if (where.isActive !== undefined && portfolio.isActive !== where.isActive) {
    return false;
  }
  if (where.OR) {
    const matchesSearch = where.OR.some((clause) => {
      const filter =
        clause.name || clause.user?.is?.name || clause.user?.is?.email;
      const value = clause.name
        ? portfolio.name
        : clause.user?.is?.name
          ? portfolio.user.name
          : portfolio.user.email;
      return value.toLowerCase().includes(filter.contains.toLowerCase());
    });
    if (!matchesSearch) return false;
  }
  return true;
}

const mockPrisma = {
  user: {
    findUnique: jest.fn(
      async ({ where }) =>
        mockUsers.find((user) => user.id === where.id) || null,
    ),
  },
  portfolio: {
    findMany: jest.fn(async ({ where, skip, take }) =>
      mockPortfolios
        .filter((portfolio) => matchesWhere(portfolio, where))
        .sort(
          (left, right) =>
            right.createdAt.getTime() - left.createdAt.getTime() ||
            left.id.localeCompare(right.id),
        )
        .slice(skip, skip + take),
    ),
    count: jest.fn(
      async ({ where }) =>
        mockPortfolios.filter((portfolio) => matchesWhere(portfolio, where))
          .length,
    ),
    findUnique: jest.fn(
      async ({ where }) =>
        mockPortfolios.find((portfolio) => portfolio.id === where.id) || null,
    ),
    findFirst: jest.fn(
      async ({ where }) =>
        mockPortfolios.find(
          (portfolio) =>
            portfolio.id === where.id && portfolio.userId === where.userId,
        ) || null,
    ),
  },
};

jest.mock("../../src/config/database", () => mockPrisma);

const jwt = require("jsonwebtoken");
const request = require("supertest");
const app = require("../../src/app");

const [admin, trader] = mockUsers;
const adminToken = jwt.sign(
  { userId: admin.id, role: "ADMIN" },
  process.env.JWT_ACCESS_SECRET,
  { issuer: "stox", expiresIn: "5m" },
);
const traderToken = jwt.sign(
  { userId: trader.id, role: "TRADER" },
  process.env.JWT_ACCESS_SECRET,
  { issuer: "stox", expiresIn: "5m" },
);
const portfolios = {
  alphaGrowth: mockPortfolios[0],
  alphaDividend: mockPortfolios[1],
  alphaArchived: mockPortfolios[2],
  betaCash: mockPortfolios[3],
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe("Admin portfolio inspection API", () => {
  test("requires authentication before validating list filters", async () => {
    const response = await request(app).get(
      "/api/v1/admin/portfolios?page=invalid",
    );

    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({
      success: false,
      error: { code: "UNAUTHORIZED" },
    });
  });

  test("forbids authenticated non-admins", async () => {
    const response = await request(app)
      .get("/api/v1/admin/portfolios")
      .set("Authorization", `Bearer ${traderToken}`);

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({
      success: false,
      error: { code: "FORBIDDEN" },
    });
  });

  test("allows admins to inspect portfolios owned by different users", async () => {
    const response = await request(app)
      .get("/api/v1/admin/portfolios")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    const resultIds = response.body.data.portfolios.map((item) => item.id);
    expect(resultIds).toEqual(
      expect.arrayContaining([
        portfolios.alphaGrowth.id,
        portfolios.betaCash.id,
      ]),
    );
  });

  test("filters by owner, name, and active status and paginates results", async () => {
    const firstPage = await request(app)
      .get("/api/v1/admin/portfolios")
      .query({
        userId: trader.id,
        search: "Alpha",
        isActive: "true",
        page: "1",
        limit: "1",
      })
      .set("Authorization", `Bearer ${adminToken}`);

    expect(firstPage.status).toBe(200);
    expect(firstPage.body.data.portfolios).toHaveLength(1);
    expect(firstPage.body.data.pagination).toEqual({
      page: 1,
      limit: 1,
      total: 2,
      totalPages: 2,
    });

    const secondPage = await request(app)
      .get("/api/v1/admin/portfolios")
      .query({
        userId: trader.id,
        search: "Alpha",
        isActive: "true",
        page: "2",
        limit: "1",
      })
      .set("Authorization", `Bearer ${adminToken}`);

    expect(secondPage.status).toBe(200);
    expect(secondPage.body.data.portfolios).toHaveLength(1);
    expect(secondPage.body.data.portfolios[0].id).not.toBe(
      firstPage.body.data.portfolios[0].id,
    );
  });

  test("serializes Decimal values exactly and exposes only safe portfolio and owner fields", async () => {
    const response = await request(app)
      .get(`/api/v1/admin/portfolios/${portfolios.alphaGrowth.id}`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    const portfolio = response.body.data.portfolio;
    expect(portfolio).toMatchObject({
      id: portfolios.alphaGrowth.id,
      userId: trader.id,
      startingBalance: "1234.12345678",
      cashBalance: "234.87654321",
      owner: {
        id: trader.id,
        name: trader.name,
        email: trader.email,
      },
    });
    expect(Object.keys(portfolio).sort()).toEqual(
      [
        "id",
        "userId",
        "name",
        "description",
        "startingBalance",
        "cashBalance",
        "isDefault",
        "isActive",
        "createdAt",
        "updatedAt",
        "owner",
      ].sort(),
    );
    expect(Object.keys(portfolio.owner).sort()).toEqual(
      ["id", "name", "email"].sort(),
    );
    expect(JSON.stringify(portfolio)).not.toMatch(
      /passwordHash|pushToken|refreshTokens|googleId|secret/i,
    );
    expect(mockPrisma.portfolio.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          user: { select: { id: true, name: true, email: true } },
        }),
      }),
    );
  });

  test("filters inactive portfolios by owner and name", async () => {
    const response = await request(app)
      .get("/api/v1/admin/portfolios")
      .query({ userId: trader.id, search: "Archive", isActive: "false" })
      .set("Authorization", `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(response.body.data.portfolios.map((item) => item.id)).toEqual([
      portfolios.alphaArchived.id,
    ]);
  });

  test("supports search by owner name and email", async () => {
    const response = await request(app)
      .get("/api/v1/admin/portfolios")
      .query({ search: "owner-beta" })
      .set("Authorization", `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(response.body.data.portfolios.map((item) => item.id)).toEqual([
      portfolios.betaCash.id,
    ]);
  });

  test.each([
    ["zero page", { page: "0" }],
    ["excessive page number", { page: "100001" }],
    ["unsafe page number", { page: "9007199254740992" }],
    ["excessive page size", { limit: "101" }],
    ["invalid owner ID", { userId: "not-a-uuid" }],
    ["invalid active filter", { isActive: "yes" }],
    ["empty search", { search: " " }],
  ])("rejects %s filters", async (_label, query) => {
    const response = await request(app)
      .get("/api/v1/admin/portfolios")
      .query(query)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  test("returns validation and not-found errors for portfolio inspection", async () => {
    const invalid = await request(app)
      .get("/api/v1/admin/portfolios/not-a-uuid")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe("VALIDATION_ERROR");

    const missing = await request(app)
      .get("/api/v1/admin/portfolios/00000000-0000-4000-8000-000000000099")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe("PORTFOLIO_NOT_FOUND");
  });

  test("keeps ordinary portfolio access owner-scoped", async () => {
    const response = await request(app)
      .get(`/api/v1/portfolios/${portfolios.betaCash.id}`)
      .set("Authorization", `Bearer ${traderToken}`);

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("PORTFOLIO_NOT_FOUND");
  });
});
