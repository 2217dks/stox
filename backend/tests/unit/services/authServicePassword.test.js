jest.mock("dotenv", () => ({ config: jest.fn() }));

jest.mock("../../../src/config/database", () => ({
  user: {},
  refreshToken: {},
  $transaction: jest.fn(),
}));

const { validatePasswordStrength } = require("../../../src/services/authService");

describe("password length policy", () => {
  test("rejects a password longer than bcrypt's 72-byte limit", () => {
    // bcrypt ignores everything after the first 72 bytes, so two different
    // long passwords with the same prefix would be interchangeable.
    const result = validatePasswordStrength(`Aa1!${"x".repeat(69)}`);

    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toMatch(/72/);
  });

  test("accepts a password of exactly 72 bytes", () => {
    expect(validatePasswordStrength(`Aa1!${"x".repeat(68)}`).valid).toBe(true);
  });
});
