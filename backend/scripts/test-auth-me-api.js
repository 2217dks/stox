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
  const email = `me-test-${Date.now()}@stox.local`;
  const password = "TestPassword123!";

  console.log("Preparing /me test user...\n");

  // ========================================================
  // 1. REGISTER
  // ========================================================

  const registrationResponse = await request(app)
    .post("/api/v1/auth/register")
    .send({
      name: "Current User Test",
      email,
      password,
    });

  if (registrationResponse.status !== 201) {
    console.dir(registrationResponse.body, {
      depth: null,
    });

    throw new Error("Unable to create /me test user.");
  }

  console.log("✓ Test user created");

  // ========================================================
  // 2. LOGIN
  // ========================================================

  const loginResponse = await request(app).post("/api/v1/auth/login").send({
    email,
    password,
  });

  if (loginResponse.status !== 200) {
    console.dir(loginResponse.body, {
      depth: null,
    });

    throw new Error("Unable to login /me test user.");
  }

  const accessToken =
    loginResponse.body.data?.tokens?.accessToken ||
    loginResponse.body.data?.accessToken;

  if (!accessToken) {
    throw new Error("Login did not return an access token.");
  }

  console.log("✓ Access token obtained");

  // ========================================================
  // 3. NO TOKEN
  // ========================================================

  console.log("\nTesting /me without authentication...");

  const unauthenticatedResponse = await request(app).get("/api/v1/auth/me");

  if (unauthenticatedResponse.status !== 401) {
    console.dir(unauthenticatedResponse.body, {
      depth: null,
    });

    throw new Error("/me without token was not rejected with 401.");
  }

  console.log("✓ Missing token rejected");

  // ========================================================
  // 4. INVALID TOKEN
  // ========================================================

  console.log("\nTesting /me with invalid token...");

  const invalidResponse = await request(app)
    .get("/api/v1/auth/me")
    .set("Authorization", "Bearer invalid-token");

  if (invalidResponse.status !== 401) {
    console.dir(invalidResponse.body, {
      depth: null,
    });

    throw new Error("Invalid token was not rejected with 401.");
  }

  console.log("✓ Invalid token rejected");

  // ========================================================
  // 5. VALID TOKEN
  // ========================================================

  console.log("\nTesting /me with valid token...");

  const meResponse = await request(app)
    .get("/api/v1/auth/me")
    .set("Authorization", `Bearer ${accessToken}`);

  if (meResponse.status !== 200) {
    console.dir(meResponse.body, {
      depth: null,
    });

    throw new Error("/me with valid token did not return 200.");
  }

  const user = meResponse.body.data?.user;

  if (!user) {
    throw new Error("/me response did not include a user.");
  }

  if (user.email !== email) {
    throw new Error("/me returned the wrong user.");
  }

  if (user.passwordHash !== undefined) {
    throw new Error("/me response leaked passwordHash.");
  }

  console.log("✓ Valid token authenticated correctly");
  console.log(`✓ Correct user returned: ${user.email}`);

  // ========================================================
  // 6. CLEANUP
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
  console.log("\nAUTH ME API TEST PASSED");
}

main()
  .catch((error) => {
    console.error("\nAUTH ME API TEST FAILED");
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
