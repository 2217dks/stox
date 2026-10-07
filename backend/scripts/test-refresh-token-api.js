const express = require("express");
const request = require("supertest");

const authRoutes = require("../src/routes/authRoutes");
const errorHandler = require("../src/middleware/errorHandler");
const prisma = require("../src/config/database");

const app = express();

app.use(express.json());
app.use("/api/v1/auth", authRoutes);
app.use(errorHandler);

async function main() {
  const email = `refresh-test-${Date.now()}@stox.local`;
  const password = "TestPassword123!";

  console.log("Preparing refresh-token test user...\n");

  // ========================================================
  // 1. CREATE TEST USER
  // ========================================================

  const registrationResponse = await request(app)
    .post("/api/v1/auth/register")
    .send({
      name: "Refresh Test User",
      email,
      password,
    });

  if (registrationResponse.status !== 201) {
    console.dir(registrationResponse.body, {
      depth: null,
    });

    throw new Error("Unable to create refresh-token test user.");
  }

  console.log("✓ Test user created");

  // ========================================================
  // 2. GET A REFRESH TOKEN THROUGH LOGIN
  // ========================================================

  const loginResponse = await request(app).post("/api/v1/auth/login").send({
    email,
    password,
  });

  if (loginResponse.status !== 200) {
    console.dir(loginResponse.body, {
      depth: null,
    });

    throw new Error("Unable to login test user.");
  }

  const originalRefreshToken = loginResponse.body.data.refreshToken;

  if (!originalRefreshToken) {
    throw new Error("Login did not return a refresh token.");
  }

  console.log("✓ Initial refresh token obtained");

  // ========================================================
  // 3. VALID REFRESH
  // ========================================================

  console.log("\nTesting valid refresh...");

  const refreshResponse = await request(app).post("/api/v1/auth/refresh").send({
    refreshToken: originalRefreshToken,
  });

  if (refreshResponse.status !== 200) {
    console.dir(refreshResponse.body, {
      depth: null,
    });

    throw new Error("Valid refresh request did not return 200.");
  }

  const refreshData = refreshResponse.body.data;

  if (!refreshData) {
    throw new Error("Refresh response does not contain data.");
  }

  if (!refreshData.accessToken) {
    throw new Error("Refresh did not return an access token.");
  }

  if (!refreshData.refreshToken) {
    throw new Error("Refresh did not return a refresh token.");
  }

  if (!refreshData.user) {
    throw new Error("Refresh did not return the user.");
  }

  if ("passwordHash" in refreshData.user) {
    throw new Error("passwordHash leaked from refresh response.");
  }

  console.log("✓ Valid refresh works");
  console.log("✓ New access token returned");
  console.log("✓ New refresh token returned");
  console.log("✓ passwordHash not exposed");

  const rotatedRefreshToken = refreshData.refreshToken;

  // ========================================================
  // 4. OLD TOKEN MUST BE REJECTED
  // ========================================================

  console.log("\nTesting old refresh-token rejection...");

  const oldTokenResponse = await request(app)
    .post("/api/v1/auth/refresh")
    .send({
      refreshToken: originalRefreshToken,
    });

  if (oldTokenResponse.status !== 401) {
    console.dir(oldTokenResponse.body, {
      depth: null,
    });

    throw new Error("Old refresh token was accepted after rotation.");
  }

  if (oldTokenResponse.body.error?.code !== "REFRESH_TOKEN_REVOKED") {
    throw new Error("Old refresh token returned unexpected error code.");
  }

  console.log("✓ Old refresh token rejected");

  // ========================================================
  // 5. NEW TOKEN SHOULD WORK
  // ========================================================

  console.log("\nTesting new refresh token...");

  const secondRefreshResponse = await request(app)
    .post("/api/v1/auth/refresh")
    .send({
      refreshToken: rotatedRefreshToken,
    });

  if (secondRefreshResponse.status !== 200) {
    console.dir(secondRefreshResponse.body, {
      depth: null,
    });

    throw new Error("New refresh token was not accepted.");
  }

  console.log("✓ New refresh token works");

  const activeRefreshToken = secondRefreshResponse.body.data.refreshToken;

  // ========================================================
  // 6. MISSING REFRESH TOKEN
  // ========================================================

  console.log("\nTesting missing refresh token...");

  const missingTokenResponse = await request(app)
    .post("/api/v1/auth/refresh")
    .send({});

  if (missingTokenResponse.status !== 400) {
    throw new Error("Missing refresh token was not rejected with 400.");
  }

  if (missingTokenResponse.body.error?.code !== "VALIDATION_ERROR") {
    throw new Error("Missing refresh token returned unexpected error code.");
  }

  console.log("✓ Missing refresh token rejected");

  // ========================================================
  // 7. INVALID REFRESH TOKEN
  // ========================================================

  console.log("\nTesting invalid refresh token...");

  const invalidTokenResponse = await request(app)
    .post("/api/v1/auth/refresh")
    .send({
      refreshToken: "this-is-not-a-real-refresh-token",
    });

  if (invalidTokenResponse.status !== 401) {
    throw new Error("Invalid refresh token was not rejected with 401.");
  }

  if (invalidTokenResponse.body.error?.code !== "INVALID_REFRESH_TOKEN") {
    throw new Error("Invalid refresh token returned unexpected error code.");
  }

  console.log("✓ Invalid refresh token rejected");

  // ========================================================
  // 8. SUSPENDED USER
  // ========================================================

  console.log("\nTesting suspended user...");

  const testUser = await prisma.user.findUnique({
    where: {
      email,
    },
  });

  if (!testUser) {
    throw new Error("Test user not found before suspension test.");
  }

  await prisma.user.update({
    where: {
      id: testUser.id,
    },
    data: {
      isSuspended: true,
    },
  });

  const suspendedResponse = await request(app)
    .post("/api/v1/auth/refresh")
    .send({
      refreshToken: activeRefreshToken,
    });

  if (suspendedResponse.status !== 403) {
    console.dir(suspendedResponse.body, {
      depth: null,
    });

    throw new Error("Suspended user was not rejected with 403.");
  }

  if (suspendedResponse.body.error?.code !== "ACCOUNT_SUSPENDED") {
    throw new Error("Suspended user returned unexpected error code.");
  }

  console.log("✓ Suspended user rejected");

  // ========================================================
  // 9. RESTORE USER FOR CLEANUP
  // ========================================================

  await prisma.user.update({
    where: {
      id: testUser.id,
    },
    data: {
      isSuspended: false,
    },
  });

  // ========================================================
  // 10. CLEANUP
  // ========================================================

  await prisma.user.delete({
    where: {
      id: testUser.id,
    },
  });

  console.log("✓ Test data cleaned up");

  console.log("\nREFRESH TOKEN API TEST PASSED");
}

main()
  .catch((error) => {
    console.error("\nREFRESH TOKEN API TEST FAILED");

    console.error(error);

    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
