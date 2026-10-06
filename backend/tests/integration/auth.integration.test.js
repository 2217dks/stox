const request = require("supertest");

const app = require("../../src/app");
const prisma = require("../../src/config/database");

const timestamp = Date.now();

const user = {
  name: "Auth Integration Test User",
  email: `auth-integration-${timestamp}@stox.local`,
  password: "TestPassword123!",
};

let userId;
let accessToken;
let refreshToken;

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

describe("Authentication integration API", () => {
  test("registers a new user", async () => {
    const response = await request(app)
      .post("/api/v1/auth/register")
      .send(user);

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);

    const registeredUser = response.body.data.user;

    expect(registeredUser).toBeDefined();
    expect(registeredUser.email).toBe(user.email);
    expect(registeredUser.name).toBe(user.name);

    expect(response.body.data.accessToken).toBeDefined();
    expect(response.body.data.refreshToken).toBeDefined();

    expect(registeredUser.passwordHash).toBeUndefined();

    userId = registeredUser.id;

    // Registration also creates the default portfolio.
    const portfolio = await prisma.portfolio.findFirst({
      where: {
        userId,
        isDefault: true,
      },
    });

    expect(portfolio).not.toBeNull();
    expect(portfolio.name).toBe("Main Portfolio");
    expect(portfolio.startingBalance.toString()).toBe("10000");
    expect(portfolio.cashBalance.toString()).toBe("10000");

    accessToken = response.body.data.accessToken;
    refreshToken = response.body.data.refreshToken;
  });

  test("rejects duplicate email registration", async () => {
    const response = await request(app)
      .post("/api/v1/auth/register")
      .send(user);

    expect(response.status).toBe(409);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("EMAIL_ALREADY_EXISTS");
  });

  test("rejects invalid passwords during registration", async () => {
    const response = await request(app)
      .post("/api/v1/auth/register")
      .send({
        name: "Weak Password User",
        email: `weak-auth-${timestamp}@stox.local`,
        password: "password123",
      });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  test("logs in with valid credentials", async () => {
    const response = await request(app).post("/api/v1/auth/login").send({
      email: user.email,
      password: user.password,
    });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);

    const loginData = response.body.data;

    expect(loginData.user).toBeDefined();
    expect(loginData.user.id).toBe(userId);
    expect(loginData.user.email).toBe(user.email);

    expect(loginData.accessToken).toBeDefined();
    expect(loginData.refreshToken).toBeDefined();

    expect(loginData.user.passwordHash).toBeUndefined();

    accessToken = loginData.accessToken;
    refreshToken = loginData.refreshToken;
  });

  test("rejects invalid credentials", async () => {
    const response = await request(app).post("/api/v1/auth/login").send({
      email: user.email,
      password: "WrongPassword123!",
    });

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("INVALID_CREDENTIALS");
  });

  test("rejects unauthenticated current-user requests", async () => {
    const response = await request(app).get("/api/v1/auth/me");

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("UNAUTHORIZED");
  });

  test("rejects invalid access tokens", async () => {
    const response = await request(app)
      .get("/api/v1/auth/me")
      .set("Authorization", "Bearer invalid-token");

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
  });

  test("returns the authenticated current user", async () => {
    const response = await request(app)
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);

    const currentUser = response.body.data.user;

    expect(currentUser).toBeDefined();
    expect(currentUser.id).toBe(userId);
    expect(currentUser.email).toBe(user.email);
    expect(currentUser.passwordHash).toBeUndefined();
  });

  test("rotates the refresh token", async () => {
    const originalRefreshToken = refreshToken;

    const response = await request(app).post("/api/v1/auth/refresh").send({
      refreshToken: originalRefreshToken,
    });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);

    const data = response.body.data;

    expect(data.accessToken).toBeDefined();
    expect(data.refreshToken).toBeDefined();
    expect(data.user.id).toBe(userId);
    expect(data.user.passwordHash).toBeUndefined();

    expect(data.refreshToken).not.toBe(originalRefreshToken);

    accessToken = data.accessToken;
    refreshToken = data.refreshToken;
  });

  test("rejects the previous refresh token after rotation", async () => {
    // The previous token is the one immediately before the current
    // refreshToken. We create a fresh token specifically for this test.
    const loginResponse = await request(app).post("/api/v1/auth/login").send({
      email: user.email,
      password: user.password,
    });

    expect(loginResponse.status).toBe(200);

    const originalToken = loginResponse.body.data.refreshToken;

    const refreshResponse = await request(app)
      .post("/api/v1/auth/refresh")
      .send({
        refreshToken: originalToken,
      });

    expect(refreshResponse.status).toBe(200);

    const rotatedToken = refreshResponse.body.data.refreshToken;

    expect(rotatedToken).toBeDefined();
    expect(rotatedToken).not.toBe(originalToken);

    const oldTokenResponse = await request(app)
      .post("/api/v1/auth/refresh")
      .send({
        refreshToken: originalToken,
      });

    expect(oldTokenResponse.status).toBe(401);
    expect(oldTokenResponse.body.success).toBe(false);
    expect(oldTokenResponse.body.error.code).toBe("REFRESH_TOKEN_REVOKED");

    // Keep a valid token for the logout test.
    refreshToken = rotatedToken;
  });

  test("logs out and revokes the refresh token", async () => {
    const tokenToRevoke = refreshToken;

    const response = await request(app).post("/api/v1/auth/logout").send({
      refreshToken: tokenToRevoke,
    });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.loggedOut).toBe(true);
    expect(response.body.data.tokenRevoked).toBe(true);

    const refreshResponse = await request(app)
      .post("/api/v1/auth/refresh")
      .send({
        refreshToken: tokenToRevoke,
      });

    expect(refreshResponse.status).toBe(401);
    expect(refreshResponse.body.error.code).toBe("REFRESH_TOKEN_REVOKED");
  });
});
