const express = require("express");
const request = require("supertest");

const authRoutes = require("../src/routes/authRoutes");
const prisma = require("../src/config/database");

const app = express();

app.use(express.json());
app.use("/api/v1/auth", authRoutes);

async function main() {
  const email = `profile-test-${Date.now()}@stox.local`;
  const password = "TestPassword123!";

  console.log("Preparing update-profile test user...\n");

  // ========================================================
  // 1. REGISTER
  // ========================================================

  const registrationResponse = await request(app)
    .post("/api/v1/auth/register")
    .send({
      name: "Profile Test User",
      email,
      password,
    });

  if (registrationResponse.status !== 201) {
    console.dir(registrationResponse.body, {
      depth: null,
    });

    throw new Error("Unable to create profile test user.");
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

    throw new Error("Unable to login profile test user.");
  }

  const accessToken =
    loginResponse.body.data?.tokens?.accessToken ||
    loginResponse.body.data?.accessToken;

  if (!accessToken) {
    throw new Error("Login did not return an access token.");
  }

  console.log("✓ Access token obtained");

  // ========================================================
  // 3. MISSING AUTH
  // ========================================================

  console.log("\nTesting update-profile without authentication...");

  const unauthenticatedResponse = await request(app)
    .patch("/api/v1/auth/profile")
    .send({
      name: "Should Not Work",
    });

  if (unauthenticatedResponse.status !== 401) {
    console.dir(unauthenticatedResponse.body, { depth: null });

    throw new Error("Unauthenticated profile update was not rejected.");
  }

  console.log("✓ Unauthenticated update rejected");

  // ========================================================
  // 4. INVALID EMPTY BODY
  // ========================================================

  console.log("\nTesting empty profile update...");

  const emptyResponse = await request(app)
    .patch("/api/v1/auth/profile")
    .set("Authorization", `Bearer ${accessToken}`)
    .send({});

  if (emptyResponse.status !== 400) {
    console.dir(emptyResponse.body, {
      depth: null,
    });

    throw new Error("Empty profile update was not rejected.");
  }

  console.log("✓ Empty update rejected");

  // ========================================================
  // 5. UPDATE NAME
  // ========================================================

  console.log("\nTesting name update...");

  const nameResponse = await request(app)
    .patch("/api/v1/auth/profile")
    .set("Authorization", `Bearer ${accessToken}`)
    .send({
      name: "Updated Profile User",
    });

  if (nameResponse.status !== 200) {
    console.dir(nameResponse.body, {
      depth: null,
    });

    throw new Error("Name update did not return 200.");
  }

  const updatedUser = nameResponse.body.data?.user;

  if (!updatedUser) {
    throw new Error("Profile update response did not include user.");
  }

  if (updatedUser.name !== "Updated Profile User") {
    throw new Error("Updated name was not returned.");
  }

  if (updatedUser.passwordHash !== undefined) {
    throw new Error("Profile update leaked passwordHash.");
  }

  console.log("✓ Name updated");

  // ========================================================
  // 6. UPDATE AVATAR
  // ========================================================

  console.log("\nTesting avatar update...");

  const avatarUrl = "https://example.com/avatar.png";

  const avatarResponse = await request(app)
    .patch("/api/v1/auth/profile")
    .set("Authorization", `Bearer ${accessToken}`)
    .send({
      avatarUrl,
    });

  if (avatarResponse.status !== 200) {
    console.dir(avatarResponse.body, {
      depth: null,
    });

    throw new Error("Avatar update did not return 200.");
  }

  if (avatarResponse.body.data?.user?.avatarUrl !== avatarUrl) {
    throw new Error("Updated avatar URL was not returned.");
  }

  console.log("✓ Avatar updated");

  // ========================================================
  // 7. UPDATE BOTH FIELDS
  // ========================================================

  console.log("\nTesting combined profile update...");

  const combinedResponse = await request(app)
    .patch("/api/v1/auth/profile")
    .set("Authorization", `Bearer ${accessToken}`)
    .send({
      name: "Final Profile Name",
      avatarUrl: "https://example.com/final-avatar.png",
    });

  if (combinedResponse.status !== 200) {
    console.dir(combinedResponse.body, {
      depth: null,
    });

    throw new Error("Combined profile update failed.");
  }

  console.log("✓ Combined update works");

  // ========================================================
  // 8. VERIFY PRIVILEGED FIELDS CANNOT CHANGE
  // ========================================================

  console.log("\nTesting protected fields...");

  const beforeProtectedAttempt = await prisma.user.findUnique({
    where: {
      email,
    },
  });

  const protectedResponse = await request(app)
    .patch("/api/v1/auth/profile")
    .set("Authorization", `Bearer ${accessToken}`)
    .send({
      name: "Safe Name",
      role: "ADMIN",
      isSuspended: true,
      googleId: "attacker-google-id",
      passwordHash: "attacker-password-hash",
    });

  if (protectedResponse.status !== 200) {
    console.dir(protectedResponse.body, { depth: null });

    throw new Error(
      "Valid profile update failed when protected fields were included.",
    );
  }

  const afterProtectedAttempt = await prisma.user.findUnique({
    where: {
      email,
    },
  });

  if (afterProtectedAttempt.role !== beforeProtectedAttempt.role) {
    throw new Error("Profile update changed role.");
  }

  if (
    afterProtectedAttempt.isSuspended !== beforeProtectedAttempt.isSuspended
  ) {
    throw new Error("Profile update changed suspension state.");
  }

  if (afterProtectedAttempt.googleId !== beforeProtectedAttempt.googleId) {
    throw new Error("Profile update changed googleId.");
  }

  if (
    afterProtectedAttempt.passwordHash !== beforeProtectedAttempt.passwordHash
  ) {
    throw new Error("Profile update changed passwordHash.");
  }

  console.log("✓ Protected fields remained unchanged");

  // ========================================================
  // 9. VERIFY DATABASE
  // ========================================================

  const databaseUser = await prisma.user.findUnique({
    where: {
      email,
    },
  });

  if (databaseUser.name !== "Safe Name") {
    throw new Error("Database did not persist updated name.");
  }

  if (databaseUser.avatarUrl !== "https://example.com/final-avatar.png") {
    throw new Error("Database did not persist updated avatar.");
  }

  console.log("✓ Database changes persisted");

  // ========================================================
  // 10. CLEANUP
  // ========================================================

  if (databaseUser) {
    await prisma.user.delete({
      where: {
        id: databaseUser.id,
      },
    });
  }

  console.log("✓ Test data cleaned up");

  console.log("\nUPDATE PROFILE API TEST PASSED");
}

main()
  .catch((error) => {
    console.error("\nUPDATE PROFILE API TEST FAILED");
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
