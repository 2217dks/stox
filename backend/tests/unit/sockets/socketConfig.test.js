const {
  DEFAULT_PING_INTERVAL_MS,
  DEFAULT_PING_TIMEOUT_MS,
  resolveSocketTiming,
} = require("../../../src/config/socketConfig");

describe("socket heartbeat configuration", () => {
  test("uses the Socket.IO defaults when nothing is configured", () => {
    expect(resolveSocketTiming({})).toEqual({
      pingInterval: DEFAULT_PING_INTERVAL_MS,
      pingTimeout: DEFAULT_PING_TIMEOUT_MS,
    });
    expect(DEFAULT_PING_INTERVAL_MS).toBe(25000);
    expect(DEFAULT_PING_TIMEOUT_MS).toBe(20000);
  });

  test("accepts positive environment overrides", () => {
    expect(
      resolveSocketTiming({
        SOCKET_PING_INTERVAL_MS: "10000",
        SOCKET_PING_TIMEOUT_MS: "5000",
      }),
    ).toEqual({ pingInterval: 10000, pingTimeout: 5000 });
  });

  test("falls back for invalid, zero, and negative values", () => {
    for (const value of ["", "abc", "0", "-1", "1.5", "Infinity"]) {
      expect(
        resolveSocketTiming({
          SOCKET_PING_INTERVAL_MS: value,
          SOCKET_PING_TIMEOUT_MS: value,
        }),
      ).toEqual({
        pingInterval: DEFAULT_PING_INTERVAL_MS,
        pingTimeout: DEFAULT_PING_TIMEOUT_MS,
      });
    }
  });
});
