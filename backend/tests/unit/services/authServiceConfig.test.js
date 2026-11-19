jest.mock("dotenv", () => ({ config: jest.fn() }));

jest.mock("../../../src/config/database", () => ({
  user: {},
  refreshToken: {},
  $transaction: jest.fn(),
}));

describe("authService configuration", () => {
  const originalClientId = process.env.GOOGLE_CLIENT_ID;

  afterEach(() => {
    process.env.GOOGLE_CLIENT_ID = originalClientId;
    jest.resetModules();
  });

  test("refuses to load without GOOGLE_CLIENT_ID", () => {
    delete process.env.GOOGLE_CLIENT_ID;

    jest.isolateModules(() => {
      expect(() => require("../../../src/services/authService")).toThrow(
        /GOOGLE_CLIENT_ID/,
      );
    });
  });

  test("loads when GOOGLE_CLIENT_ID is set", () => {
    process.env.GOOGLE_CLIENT_ID = "test-client-id.apps.googleusercontent.com";

    jest.isolateModules(() => {
      expect(() => require("../../../src/services/authService")).not.toThrow();
    });
  });
});
