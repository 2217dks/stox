const express = require("express");
const request = require("supertest");

const authRoutes = require("../src/routes/authRoutes");
const prisma = require("../src/config/database");
const { hashRefreshToken } = require("../src/services/authService");

const app = express();

app.use(express.json());
app.use("/api/v1/auth", authRoutes);

async function main() {
  const email = `logout-test-${Date.now()}@stox.local`;
  const password = "TestPassword123!";

  console.log("Preparing logout test user...\n");

  // ========================================================
  // 1. REGISTER TEST USER
  // ========================================================

  const registrationResponse = await request(app)
    .post("/api/v1/auth/register")
    .send({
      name: "Logout Test User",
      email,
      password,
    });

  if (registrationResponse.status !== 201) {
    console.dir(registrationResponse.body, {
      depth: null,
    });

    throw new Error("Unable to create logout test user.");
  }

  console.log("✓ Test user created");

  // ========================================================
  // 2. LOGIN TO GET A REFRESH TOKEN
  // ========================================================

  const loginResponse = await request(app).post("/api/v1/auth/login").send({
    email,
    password,
  });

  if (loginResponse.status !== 200) {
    console.dir(loginResponse.body, {
      depth: null,
    });

    throw new Error("Unable to login logout test user.");
  }

  const refreshToken = loginResponse.body.data.refreshToken;

  if (!refreshToken) {
    throw new Error("Login did not return a refresh token.");
  }

  console.log("✓ Refresh token obtained");

  // ========================================================
  // 3. VERIFY TOKEN IS ACTIVE BEFORE LOGOUT
  // ========================================================

  const tokenBeforeLogout = await prisma.refreshToken.findMany({
    where: {
      user: {
        email,
      },
      revokedAt: null,
    },
  });

  if (tokenBeforeLogout.length < 1) {
    throw new Error(
      "Expected at least one active refresh token before logout.",
    );
  }

  console.log(`✓ ${tokenBeforeLogout.length} active refresh token(s) found`);

  // ========================================================
  // 4. LOGOUT
  // ========================================================

  console.log("\nTesting logout...");

  const logoutResponse = await request(app).post("/api/v1/auth/logout").send({
    refreshToken,
  });

  if (logoutResponse.status !== 200) {
    console.dir(logoutResponse.body, {
      depth: null,
    });

    throw new Error("Logout did not return 200.");
  }

  if (logoutResponse.body.data?.loggedOut !== true) {
    throw new Error("Logout response did not report loggedOut=true.");
  }

  if (logoutResponse.body.data?.tokenRevoked !== true) {
    throw new Error("Logout did not report tokenRevoked=true.");
  }

  console.log("✓ Logout endpoint works");

  // ========================================================
  // 5. VERIFY DATABASE REVOCATION
  // ========================================================

  const refreshTokenHash = hashRefreshToken(refreshToken);

  const tokenAfterLogout = await prisma.refreshToken.findUnique({
    where: {
      token: refreshTokenHash,
    },
  });

  if (!tokenAfterLogout) {
    throw new Error("Logged-out refresh token was not found in the database.");
  }

  if (!tokenAfterLogout.revokedAt) {
    throw new Error("Refresh token was not marked as revoked.");
  }

  console.log("✓ Database shows logged-out token as revoked");

  // ========================================================
  // 6. VERIFY REVOKED TOKEN CANNOT REFRESH
  // ========================================================

  console.log("\nTesting revoked token rejection...");

  const refreshResponse = await request(app).post("/api/v1/auth/refresh").send({
    refreshToken,
  });

  if (refreshResponse.status !== 401) {
    console.dir(refreshResponse.body, {
      depth: null,
    });

    throw new Error("Revoked token was still accepted for refresh.");
  }

  if (refreshResponse.body.error?.code !== "REFRESH_TOKEN_REVOKED") {
    throw new Error("Revoked token returned unexpected error code.");
  }

  console.log("✓ Revoked refresh token rejected");

  // ========================================================
  // 7. LOGOUT AGAIN
  // ========================================================

  console.log("\nTesting repeated logout...");

  const secondLogoutResponse = await request(app)
    .post("/api/v1/auth/logout")
    .send({
      refreshToken,
    });

  if (secondLogoutResponse.status !== 200) {
    throw new Error("Repeated logout should still return 200.");
  }

  if (secondLogoutResponse.body.data?.loggedOut !== true) {
    throw new Error("Repeated logout did not report loggedOut=true.");
  }

  if (secondLogoutResponse.body.data?.tokenRevoked !== false) {
    throw new Error("Already revoked token should report tokenRevoked=false.");
  }

  console.log("✓ Repeated logout handled safely");

  // ========================================================
  // 8. MISSING TOKEN
  // ========================================================

  console.log("\nTesting missing refresh token...");

  const missingTokenResponse = await request(app)
    .post("/api/v1/auth/logout")
    .send({});

  if (missingTokenResponse.status !== 400) {
    throw new Error("Missing refresh token was not rejected with 400.");
  }

  console.log("✓ Missing refresh token rejected");

  // ========================================================
  // 9. CLEANUP
  // ========================================================

  const testUser = await prisma.user.findUnique({
    where: {
      email,
    },
  });

  if (testUser) {
    await prisma.user.delete({
      where: {
        id: testUser.id,
      },
    });
  }

  console.log("✓ Test data cleaned up");

  console.log("\nLOGOUT API TEST PASSED");
}

main()
  .catch((error) => {
    console.error("\nLOGOUT API TEST FAILED");
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
