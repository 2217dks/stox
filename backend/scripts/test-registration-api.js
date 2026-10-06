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
  const email = `api-test-${Date.now()}@stox.local`;

  // ========================================================
  // 1. VALID REGISTRATION
  // ========================================================

  console.log("Testing valid registration...\n");

  const registrationResponse = await request(app)
    .post("/api/v1/auth/register")
    .send({
      name: "API Test User",
      email,
      password: "TestPassword123!",
    });

  console.log("Registration status:", registrationResponse.status);

  if (registrationResponse.status !== 201) {
    console.dir(registrationResponse.body, {
      depth: null,
    });

    throw new Error("Valid registration did not return 201.");
  }

  const registration = registrationResponse.body.data;

  if (!registration) {
    throw new Error("Registration response has no data.");
  }

  if (!registration.user) {
    throw new Error("Registration response has no user.");
  }

  if (!registration.accessToken) {
    throw new Error("Registration response has no access token.");
  }

  if (!registration.refreshToken) {
    throw new Error("Registration response has no refresh token.");
  }

  if ("passwordHash" in registration.user) {
    throw new Error("passwordHash leaked from registration API.");
  }

  console.log("✓ Valid registration works");
  console.log("✓ Access token returned");
  console.log("✓ Refresh token returned");
  console.log("✓ passwordHash not exposed");

  // ========================================================
  // 2. WEAK PASSWORD
  // ========================================================

  console.log("\nTesting weak password rejection...");

  const weakResponse = await request(app)
    .post("/api/v1/auth/register")
    .send({
      name: "Weak Password User",
      email: `weak-${Date.now()}@stox.local`,
      password: "1234",
    });

  if (weakResponse.status !== 400) {
    console.dir(weakResponse.body, {
      depth: null,
    });

    throw new Error("Weak password was not rejected with 400.");
  }

  console.log("✓ Weak password rejected");

  // ========================================================
  // 3. INVALID EMAIL
  // ========================================================

  console.log("\nTesting invalid email rejection...");

  const invalidEmailResponse = await request(app)
    .post("/api/v1/auth/register")
    .send({
      name: "Invalid Email User",
      email: "not-an-email",
      password: "TestPassword123!",
    });

  if (invalidEmailResponse.status !== 400) {
    throw new Error("Invalid email was not rejected with 400.");
  }

  console.log("✓ Invalid email rejected");

  // ========================================================
  // 4. MISSING FIELDS
  // ========================================================

  console.log("\nTesting missing fields...");

  const missingFieldsResponse = await request(app)
    .post("/api/v1/auth/register")
    .send({
      email: `missing-${Date.now()}@stox.local`,
    });

  if (missingFieldsResponse.status !== 400) {
    throw new Error("Missing fields were not rejected with 400.");
  }

  console.log("✓ Missing fields rejected");

  // ========================================================
  // 5. DUPLICATE EMAIL
  // ========================================================

  console.log("\nTesting duplicate email rejection...");

  const duplicateResponse = await request(app)
    .post("/api/v1/auth/register")
    .send({
      name: "Duplicate User",
      email,
      password: "TestPassword123!",
    });

  if (duplicateResponse.status !== 409) {
    console.dir(duplicateResponse.body, {
      depth: null,
    });

    throw new Error("Duplicate email was not rejected with 409.");
  }

  console.log("✓ Duplicate email rejected");

  // ========================================================
  // 6. VERIFY DATABASE STATE
  // ========================================================

  console.log("\nChecking database state...");

  const createdUser = await prisma.user.findUnique({
    where: {
      email,
    },
    include: {
      portfolios: true,
      refreshTokens: true,
    },
  });

  if (!createdUser) {
    throw new Error("Registered user was not found in database.");
  }

  if (createdUser.portfolios.length !== 1) {
    throw new Error("Default portfolio was not created.");
  }

  if (createdUser.refreshTokens.length !== 1) {
    throw new Error("Refresh token was not stored.");
  }

  console.log("✓ User exists in database");
  console.log("✓ Main portfolio created");
  console.log("✓ Refresh token stored");

  // ========================================================
  // 7. CLEANUP
  // ========================================================

  await prisma.user.delete({
    where: {
      id: createdUser.id,
    },
  });

  console.log("✓ Test data cleaned up");

  console.log("\nREGISTRATION API TEST PASSED");
}

main()
  .catch((error) => {
    console.error("\nREGISTRATION API TEST FAILED");

    console.error(error);

    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
