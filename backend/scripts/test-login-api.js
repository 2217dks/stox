const express = require("express");
const request = require("supertest");

const authRoutes = require("../src/routes/authRoutes");
const prisma = require("../src/config/database");

const app = express();

app.use(express.json());
app.use("/api/v1/auth", authRoutes);

async function main() {
  const email = `login-test-${Date.now()}@stox.local`;
  const password = "TestPassword123!";

  console.log("Preparing login test user...\n");

  // ========================================================
  // 1. CREATE TEST USER
  // ========================================================

  const registerResponse = await request(app)
    .post("/api/v1/auth/register")
    .send({
      name: "Login Test User",
      email,
      password,
    });

  if (registerResponse.status !== 201) {
    console.dir(registerResponse.body, {
      depth: null,
    });

    throw new Error("Unable to create login test user.");
  }

  console.log("✓ Test user created");

  // ========================================================
  // 2. VALID LOGIN
  // ========================================================

  console.log("\nTesting valid login...");

  const loginResponse = await request(app).post("/api/v1/auth/login").send({
    email,
    password,
  });

  if (loginResponse.status !== 200) {
    console.dir(loginResponse.body, {
      depth: null,
    });

    throw new Error("Valid login did not return 200.");
  }

  const loginData = loginResponse.body.data;

  if (!loginData) {
    throw new Error("Login response does not contain data.");
  }

  if (!loginData.user) {
    throw new Error("Login response does not contain user.");
  }

  if (!loginData.accessToken) {
    throw new Error("Login did not return an access token.");
  }

  if (!loginData.refreshToken) {
    throw new Error("Login did not return a refresh token.");
  }

  if ("passwordHash" in loginData.user) {
    throw new Error("passwordHash leaked from login response.");
  }

  console.log("✓ Valid login works");
  console.log("✓ Access token returned");
  console.log("✓ Refresh token returned");
  console.log("✓ passwordHash not exposed");

  // ========================================================
  // 3. WRONG PASSWORD
  // ========================================================

  console.log("\nTesting wrong password...");

  const wrongPasswordResponse = await request(app)
    .post("/api/v1/auth/login")
    .send({
      email,
      password: "WrongPassword123!",
    });

  if (wrongPasswordResponse.status !== 401) {
    console.dir(wrongPasswordResponse.body, {
      depth: null,
    });

    throw new Error("Wrong password was not rejected with 401.");
  }

  if (wrongPasswordResponse.body.error?.code !== "INVALID_CREDENTIALS") {
    throw new Error("Wrong password returned unexpected error code.");
  }

  console.log("✓ Wrong password rejected");

  // ========================================================
  // 4. UNKNOWN EMAIL
  // ========================================================

  console.log("\nTesting unknown email...");

  const unknownEmailResponse = await request(app)
    .post("/api/v1/auth/login")
    .send({
      email: `does-not-exist-${Date.now()}@stox.local`,
      password,
    });

  if (unknownEmailResponse.status !== 401) {
    throw new Error("Unknown email was not rejected with 401.");
  }

  if (unknownEmailResponse.body.error?.code !== "INVALID_CREDENTIALS") {
    throw new Error("Unknown email returned unexpected error code.");
  }

  console.log("✓ Unknown email rejected");

  // ========================================================
  // 5. INVALID EMAIL FORMAT
  // ========================================================

  console.log("\nTesting invalid email format...");

  const invalidEmailResponse = await request(app)
    .post("/api/v1/auth/login")
    .send({
      email: "not-an-email",
      password,
    });

  if (invalidEmailResponse.status !== 400) {
    throw new Error("Invalid email format was not rejected with 400.");
  }

  if (invalidEmailResponse.body.error?.code !== "VALIDATION_ERROR") {
    throw new Error("Invalid email returned unexpected error code.");
  }

  console.log("✓ Invalid email format rejected");

  // ========================================================
  // 6. MISSING PASSWORD
  // ========================================================

  console.log("\nTesting missing password...");

  const missingPasswordResponse = await request(app)
    .post("/api/v1/auth/login")
    .send({
      email,
    });

  if (missingPasswordResponse.status !== 400) {
    throw new Error("Missing password was not rejected with 400.");
  }

  console.log("✓ Missing password rejected");

  // ========================================================
  // 7. SUSPENDED ACCOUNT
  // ========================================================

  console.log("\nTesting suspended account...");

  const testUser = await prisma.user.findUnique({
    where: {
      email,
    },
  });

  if (!testUser) {
    throw new Error("Test user disappeared before suspended test.");
  }

  await prisma.user.update({
    where: {
      id: testUser.id,
    },
    data: {
      isSuspended: true,
    },
  });

  const suspendedResponse = await request(app).post("/api/v1/auth/login").send({
    email,
    password,
  });

  if (suspendedResponse.status !== 403) {
    console.dir(suspendedResponse.body, {
      depth: null,
    });

    throw new Error("Suspended account was not rejected with 403.");
  }

  if (suspendedResponse.body.error?.code !== "ACCOUNT_SUSPENDED") {
    throw new Error("Suspended account returned unexpected error code.");
  }

  console.log("✓ Suspended account rejected");

  // ========================================================
  // 8. VERIFY lastLoginAt
  // ========================================================

  const finalUser = await prisma.user.findUnique({
    where: {
      id: testUser.id,
    },
  });

  if (!finalUser.lastLoginAt) {
    throw new Error("Successful login did not update lastLoginAt.");
  }

  console.log("✓ lastLoginAt updated");

  // ========================================================
  // 9. CLEANUP
  // ========================================================

  await prisma.user.delete({
    where: {
      id: testUser.id,
    },
  });

  console.log("✓ Test data cleaned up");

  console.log("\nLOGIN API TEST PASSED");
}

main()
  .catch((error) => {
    console.error("\nLOGIN API TEST FAILED");
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
