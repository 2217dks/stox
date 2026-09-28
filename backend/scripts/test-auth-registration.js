const prisma = require("../src/config/database");

const {
  registerUser,
  loginUser,
  refreshAccessToken,
  revokeRefreshToken,
} = require("../src/services/authService");

async function main() {
  // ==========================================================
  // 1. WEAK PASSWORD TEST
  // ==========================================================

  console.log("Testing password policy...\n");

  const weakEmail = `weak-password-${Date.now()}@stox.local`;

  let weakPasswordRejected = false;

  try {
    await registerUser({
      name: "Weak Password Test",
      email: weakEmail,
      password: "1234",
    });
  } catch (error) {
    weakPasswordRejected = error.code === "WEAK_PASSWORD";
  }

  if (!weakPasswordRejected) {
    throw new Error("Weak password was accepted by registerUser().");
  }

  console.log("✓ Registration rejects weak passwords");

  // ==========================================================
  // 2. CREATE TEST ACCOUNT
  // ==========================================================

  const email = `auth-test-${Date.now()}@stox.local`;

  console.log("\nCreating test account...\n");

  const registration = await registerUser({
    name: "Auth Test User",
    email,
    password: "TestPassword123!",
    userAgent: "Task Auth Test",
    ipAddress: "127.0.0.1",
  });

  console.log("✓ Registration worked");
  console.log("User ID:", registration.user.id);

  // ==========================================================
  // 3. CHECK REGISTRATION RESPONSE
  // ==========================================================

  if (registration.user.email !== email) {
    throw new Error("Registration returned wrong user.");
  }

  if (!registration.accessToken) {
    throw new Error("Registration did not return access token.");
  }

  if (!registration.refreshToken) {
    throw new Error("Registration did not return refresh token.");
  }

  console.log("✓ Access and refresh tokens were generated");

  // ==========================================================
  // 4. ENSURE PASSWORD HASH IS NOT EXPOSED
  // ==========================================================

  if ("passwordHash" in registration.user) {
    throw new Error("passwordHash leaked in registration response.");
  }

  console.log("✓ Sensitive user fields are not exposed");

  // ==========================================================
  // 5. LOGIN
  // ==========================================================

  const login = await loginUser({
    email,
    password: "TestPassword123!",
    userAgent: "Task Auth Test",
    ipAddress: "127.0.0.1",
  });

  console.log("✓ Login worked");

  if (!login.accessToken || !login.refreshToken) {
    throw new Error("Login did not return both tokens.");
  }

  // ==========================================================
  // 6. REFRESH TOKEN ROTATION
  // ==========================================================

  const oldRefreshToken = login.refreshToken;

  const refreshed = await refreshAccessToken({
    refreshToken: oldRefreshToken,
    userAgent: "Task Auth Test",
    ipAddress: "127.0.0.1",
  });

  console.log("✓ Refresh-token rotation worked");

  if (!refreshed.accessToken || !refreshed.refreshToken) {
    throw new Error("Refresh did not issue a new token pair.");
  }

  // ==========================================================
  // 7. OLD REFRESH TOKEN MUST NOW BE INVALID
  // ==========================================================

  let oldTokenRejected = false;

  try {
    await refreshAccessToken({
      refreshToken: oldRefreshToken,
    });
  } catch (error) {
    oldTokenRejected = error.code === "REFRESH_TOKEN_REVOKED";
  }

  if (!oldTokenRejected) {
    throw new Error("Old refresh token was still accepted after rotation.");
  }

  console.log("✓ Old refresh token was rejected after rotation");

  // ==========================================================
  // 8. LOGOUT / REVOCATION HELPER
  // ==========================================================

  const revoked = await revokeRefreshToken(refreshed.refreshToken);

  if (!revoked) {
    throw new Error("Refresh token was not revoked.");
  }

  console.log("✓ Refresh-token revocation works");

  // ==========================================================
  // 9. VERIFY REVOKED TOKEN CANNOT BE USED
  // ==========================================================

  let revokedTokenRejected = false;

  try {
    await refreshAccessToken({
      refreshToken: refreshed.refreshToken,
    });
  } catch (error) {
    revokedTokenRejected = error.code === "REFRESH_TOKEN_REVOKED";
  }

  if (!revokedTokenRejected) {
    throw new Error("Revoked refresh token was still accepted.");
  }

  console.log("✓ Revoked refresh token was rejected");

  // ==========================================================
  // 10. CLEANUP
  // ==========================================================

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

  // The weak-password registration should never have created
  // a user, but clean it up defensively if one exists.
  const weakUser = await prisma.user.findUnique({
    where: {
      email: weakEmail,
    },
  });

  if (weakUser) {
    await prisma.user.delete({
      where: {
        id: weakUser.id,
      },
    });
  }

  console.log("✓ Test data cleaned up");

  console.log("\nAUTH SERVICE INTEGRATION TEST PASSED");
}

main()
  .catch((error) => {
    console.error("\nAUTH SERVICE INTEGRATION TEST FAILED");

    console.error(error);

    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
