const prisma = require("../src/config/database");

const {
  hashPassword,
  verifyPassword,
  createAccessToken,
  generateRefreshToken,
  hashRefreshToken,
  validatePasswordStrength,
} = require("../src/services/authService");

async function main() {
  console.log("Starting auth service unit test...\n");

  // ----------------------------------------------------------
  // 1. Password hashing
  // ----------------------------------------------------------

  const password = "TestPassword123!";

  const passwordHash = await hashPassword(password);

  if (passwordHash === password) {
    throw new Error("Password was not hashed.");
  }

  console.log("✓ Password was hashed");

  // ----------------------------------------------------------
  // 2. Password verification
  // ----------------------------------------------------------

  const correctPassword = await verifyPassword(password, passwordHash);

  if (!correctPassword) {
    throw new Error("Correct password did not verify.");
  }

  const wrongPassword = await verifyPassword("WrongPassword123!", passwordHash);

  if (wrongPassword) {
    throw new Error("Wrong password incorrectly verified.");
  }

  console.log("✓ Password verification works");

  // ----------------------------------------------------------
  // 3. Password strength validation
  // ----------------------------------------------------------

  const weakPasswords = [
    "1234",
    "abcdef",
    "ABCDEF",
    "123456",
    "Abcdef",
    "abcdef1",
    "ABCDEF1",
  ];

  for (const password of weakPasswords) {
    const result = validatePasswordStrength(password);

    if (result.valid) {
      throw new Error(`Weak password was incorrectly accepted: ${password}`);
    }
  }

  console.log("✓ Weak passwords are rejected");

  const strongPassword = "Abc1!x";

  const strongResult = validatePasswordStrength(strongPassword);

  if (!strongResult.valid) {
    throw new Error(
      `Strong password was incorrectly rejected: ${strongResult.errors.join(", ")}`,
    );
  }

  console.log("✓ Strong password is accepted");

  // ----------------------------------------------------------
  // 3. Access token
  // ----------------------------------------------------------

  const fakeUser = {
    id: "test-user-id",
    email: "test@stox.local",
    role: "TRADER",
  };

  const accessToken = createAccessToken(fakeUser);

  if (!accessToken || typeof accessToken !== "string") {
    throw new Error("Access token was not generated.");
  }

  console.log("✓ Access token generated");

  // ----------------------------------------------------------
  // 4. Refresh token generation
  // ----------------------------------------------------------

  const refreshToken = generateRefreshToken();

  if (!refreshToken || typeof refreshToken !== "string") {
    throw new Error("Refresh token was not generated.");
  }

  console.log("✓ Refresh token generated");

  // ----------------------------------------------------------
  // 5. Refresh-token hashing
  // ----------------------------------------------------------

  const hashedRefreshToken = hashRefreshToken(refreshToken);

  if (hashedRefreshToken === refreshToken) {
    throw new Error("Refresh token was not transformed.");
  }

  if (hashedRefreshToken.length !== 64) {
    throw new Error("Unexpected SHA-256 hash length.");
  }

  console.log("✓ Refresh token hashing works");

  // ----------------------------------------------------------
  // 6. Database connectivity
  // ----------------------------------------------------------

  await prisma.$queryRaw`SELECT 1`;

  console.log("✓ Prisma database connection works");

  console.log("\nAUTH SERVICE TEST PASSED");
}

main()
  .catch((error) => {
    console.error("\nAUTH SERVICE TEST FAILED");
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
