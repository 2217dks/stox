const request = require("supertest");

const app = require("../../src/app");
const prisma = require("../../src/config/database");

const timestamp = Date.now();

const users = {
  admin: {
    name: "Admin Integration User",
    email: `admin-users-admin-${timestamp}@stox.local`,
    password: "AdminPassword123!",
  },

  trader: {
    name: "Trader Integration User",
    email: `admin-users-trader-${timestamp}@stox.local`,
    password: "TraderPassword123!",
  },

  suspended: {
    name: "Suspended Integration User",
    email: `admin-users-suspended-${timestamp}@stox.local`,
    password: "SuspendedPassword123!",
  },

  verified: {
    name: "Verified Integration User",
    email: `admin-users-verified-${timestamp}@stox.local`,
    password: "VerifiedPassword123!",
  },
};

let adminUserId;
let traderUserId;
let suspendedUserId;
let verifiedUserId;

let adminAccessToken;
let traderAccessToken;

function expectErrorEnvelope(body) {
  expect(body).toHaveProperty("success", false);
  expect(typeof body.error?.code).toBe("string");
  expect(body.error.code.length).toBeGreaterThan(0);
  expect(typeof body.error?.message).toBe("string");
  expect(body.error.message.length).toBeGreaterThan(0);
}

beforeAll(async () => {
  jest.setTimeout(20000);

  const adminRegister = await request(app)
    .post("/api/v1/auth/register")
    .send(users.admin);

  expect(adminRegister.status).toBe(201);

  adminUserId = adminRegister.body.data.user.id;

  const traderRegister = await request(app)
    .post("/api/v1/auth/register")
    .send(users.trader);

  expect(traderRegister.status).toBe(201);

  traderUserId = traderRegister.body.data.user.id;
  traderAccessToken = traderRegister.body.data.accessToken;

  const suspendedRegister = await request(app)
    .post("/api/v1/auth/register")
    .send(users.suspended);

  expect(suspendedRegister.status).toBe(201);

  suspendedUserId = suspendedRegister.body.data.user.id;

  const verifiedRegister = await request(app)
    .post("/api/v1/auth/register")
    .send(users.verified);

  expect(verifiedRegister.status).toBe(201);

  verifiedUserId = verifiedRegister.body.data.user.id;

  await prisma.user.update({
    where: {
      id: adminUserId,
    },
    data: {
      role: "ADMIN",
    },
  });

  await prisma.user.update({
    where: {
      id: suspendedUserId,
    },
    data: {
      isSuspended: true,
    },
  });

  await prisma.user.update({
    where: {
      id: verifiedUserId,
    },
    data: {
      isVerified: true,
    },
  });

  // Login again so the admin JWT contains role=ADMIN.
  const adminLogin = await request(app).post("/api/v1/auth/login").send({
    email: users.admin.email,
    password: users.admin.password,
  });

  expect(adminLogin.status).toBe(200);

  adminAccessToken = adminLogin.body.data.accessToken;
});

afterAll(async () => {
  const userIds = [
    adminUserId,
    traderUserId,
    suspendedUserId,
    verifiedUserId,
  ].filter(Boolean);

  if (userIds.length > 0) {
    await prisma.user.deleteMany({
      where: {
        id: {
          in: userIds,
        },
      },
    });
  }

  await prisma.$disconnect();
});

describe("Admin users integration API", () => {
  describe("RBAC", () => {
    test("rejects unauthenticated admin user list requests", async () => {
      const response = await request(app).get("/api/v1/admin/users");

      expect(response.status).toBe(401);
      expectErrorEnvelope(response.body);
      expect(response.body.error.code).toBe("UNAUTHORIZED");
    });

    test("rejects non-admin users from admin user list", async () => {
      const response = await request(app)
        .get("/api/v1/admin/users")
        .set("Authorization", `Bearer ${traderAccessToken}`);

      expect(response.status).toBe(403);
      expectErrorEnvelope(response.body);
      expect(response.body.error.code).toBe("FORBIDDEN");
      expect(response.body.error.message).toBe(
        "Administrator access required.",
      );
    });

    test("allows admins to access the user list", async () => {
      const response = await request(app)
        .get("/api/v1/admin/users")
        .set("Authorization", `Bearer ${adminAccessToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data.users)).toBe(true);
      expect(response.body.data.pagination).toBeDefined();
    });
  });

  describe("Admin user list", () => {
    test("returns users in newest-first order with pagination metadata", async () => {
      const response = await request(app)
        .get("/api/v1/admin/users?page=1&limit=2")
        .set("Authorization", `Bearer ${adminAccessToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);

      const { users: resultUsers, pagination } = response.body.data;

      expect(resultUsers).toHaveLength(2);

      expect(pagination).toEqual(
        expect.objectContaining({
          page: 1,
          limit: 2,
          total: expect.any(Number),
          totalPages: expect.any(Number),
        }),
      );

      expect(pagination.total).toBeGreaterThanOrEqual(4);
      expect(pagination.totalPages).toBe(
        Math.ceil(pagination.total / pagination.limit),
      );

      expect(
        new Date(resultUsers[0].createdAt).getTime(),
      ).toBeGreaterThanOrEqual(new Date(resultUsers[1].createdAt).getTime());
    });

    test("searches users by name", async () => {
      const response = await request(app)
        .get("/api/v1/admin/users")
        .query({
          search: "Suspended Integration",
        })
        .set("Authorization", `Bearer ${adminAccessToken}`);

      expect(response.status).toBe(200);

      const resultUsers = response.body.data.users;

      expect(resultUsers.some((user) => user.id === suspendedUserId)).toBe(
        true,
      );
    });

    test("searches users by email", async () => {
      const response = await request(app)
        .get("/api/v1/admin/users")
        .query({
          search: users.verified.email,
        })
        .set("Authorization", `Bearer ${adminAccessToken}`);

      expect(response.status).toBe(200);

      const resultUsers = response.body.data.users;

      expect(resultUsers).toHaveLength(1);
      expect(resultUsers[0].id).toBe(verifiedUserId);
    });

    test("filters by role", async () => {
      const response = await request(app)
        .get("/api/v1/admin/users")
        .query({
          role: "ADMIN",
        })
        .set("Authorization", `Bearer ${adminAccessToken}`);

      expect(response.status).toBe(200);

      const resultUsers = response.body.data.users;

      expect(resultUsers.length).toBeGreaterThanOrEqual(1);

      for (const user of resultUsers) {
        expect(user.role).toBe("ADMIN");
      }

      expect(resultUsers.some((user) => user.id === adminUserId)).toBe(true);
    });

    test("filters by suspended status", async () => {
      const response = await request(app)
        .get("/api/v1/admin/users")
        .query({
          isSuspended: "true",
        })
        .set("Authorization", `Bearer ${adminAccessToken}`);

      expect(response.status).toBe(200);

      const resultUsers = response.body.data.users;

      expect(resultUsers.some((user) => user.id === suspendedUserId)).toBe(
        true,
      );

      for (const user of resultUsers) {
        expect(user.isSuspended).toBe(true);
      }
    });

    test("filters by verification status", async () => {
      const response = await request(app)
        .get("/api/v1/admin/users")
        .query({
          isVerified: "true",
        })
        .set("Authorization", `Bearer ${adminAccessToken}`);

      expect(response.status).toBe(200);

      const resultUsers = response.body.data.users;

      expect(resultUsers.some((user) => user.id === verifiedUserId)).toBe(true);

      for (const user of resultUsers) {
        expect(user.isVerified).toBe(true);
      }
    });

    test("rejects invalid query parameters", async () => {
      const response = await request(app)
        .get("/api/v1/admin/users")
        .query({
          page: 0,
          limit: 101,
          role: "INVALID_ROLE",
          isSuspended: "not-a-boolean",
        })
        .set("Authorization", `Bearer ${adminAccessToken}`);

      expect(response.status).toBe(400);
      expectErrorEnvelope(response.body);
      expect(response.body.error.code).toBe("VALIDATION_ERROR");
      expect(Array.isArray(response.body.error.details)).toBe(true);
    });

    test("does not expose sensitive user fields", async () => {
      const response = await request(app)
        .get("/api/v1/admin/users")
        .set("Authorization", `Bearer ${adminAccessToken}`);

      expect(response.status).toBe(200);

      for (const user of response.body.data.users) {
        expect(user.passwordHash).toBeUndefined();
        expect(user.googleId).toBeUndefined();
        expect(user.pushToken).toBeUndefined();
        expect(user.refreshTokens).toBeUndefined();
      }
    });
  });

  describe("Admin user detail", () => {
    test("rejects unauthenticated detail requests", async () => {
      const response = await request(app).get(
        `/api/v1/admin/users/${traderUserId}`,
      );

      expect(response.status).toBe(401);
      expectErrorEnvelope(response.body);
      expect(response.body.error.code).toBe("UNAUTHORIZED");
    });

    test("rejects non-admin detail requests", async () => {
      const response = await request(app)
        .get(`/api/v1/admin/users/${adminUserId}`)
        .set("Authorization", `Bearer ${traderAccessToken}`);

      expect(response.status).toBe(403);
      expectErrorEnvelope(response.body);
      expect(response.body.error.code).toBe("FORBIDDEN");
    });

    test("rejects an invalid user UUID", async () => {
      const response = await request(app)
        .get("/api/v1/admin/users/not-a-uuid")
        .set("Authorization", `Bearer ${adminAccessToken}`);

      expect(response.status).toBe(400);
      expectErrorEnvelope(response.body);
      expect(response.body.error.code).toBe("VALIDATION_ERROR");
    });

    test("returns USER_NOT_FOUND for a valid but nonexistent UUID", async () => {
      const nonexistentUserId = "550e8400-e29b-41d4-a716-446655440000";

      const response = await request(app)
        .get(`/api/v1/admin/users/${nonexistentUserId}`)
        .set("Authorization", `Bearer ${adminAccessToken}`);

      expect(response.status).toBe(404);
      expectErrorEnvelope(response.body);
      expect(response.body.error.code).toBe("USER_NOT_FOUND");
    });

    test("returns the requested user with safe fields only", async () => {
      const response = await request(app)
        .get(`/api/v1/admin/users/${traderUserId}`)
        .set("Authorization", `Bearer ${adminAccessToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);

      const user = response.body.data.user;

      expect(user).toBeDefined();
      expect(user.id).toBe(traderUserId);
      expect(user.email).toBe(users.trader.email);
      expect(user.name).toBe(users.trader.name);
      expect(user.role).toBe("TRADER");

      expect(user.passwordHash).toBeUndefined();
      expect(user.googleId).toBeUndefined();
      expect(user.pushToken).toBeUndefined();
      expect(user.refreshTokens).toBeUndefined();
    });
  });
});
