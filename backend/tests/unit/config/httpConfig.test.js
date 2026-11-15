const {
  DEFAULT_BODY_LIMIT,
  resolveBodyLimit,
  resolveSecurityHeadersEnabled,
  resolveMetricsConfig,
} = require("../../../src/config/httpConfig");

describe("http config", () => {
  describe("resolveBodyLimit", () => {
    test("defaults to 100kb", () => {
      expect(DEFAULT_BODY_LIMIT).toBe("100kb");
      expect(resolveBodyLimit(undefined)).toBe("100kb");
      expect(resolveBodyLimit("")).toBe("100kb");
      expect(resolveBodyLimit("   ")).toBe("100kb");
    });

    test("accepts an explicit limit", () => {
      expect(resolveBodyLimit("256kb")).toBe("256kb");
      expect(resolveBodyLimit(" 1mb ")).toBe("1mb");
    });

    test("rejects an invalid limit instead of silently disabling the guard", () => {
      expect(() => resolveBodyLimit("banana")).toThrow(/body limit/i);
      expect(() => resolveBodyLimit("-5kb")).toThrow(/body limit/i);
    });
  });

  describe("resolveSecurityHeadersEnabled", () => {
    test("is enabled unless explicitly disabled", () => {
      expect(resolveSecurityHeadersEnabled(undefined)).toBe(true);
      expect(resolveSecurityHeadersEnabled("true")).toBe(true);
      expect(resolveSecurityHeadersEnabled("1")).toBe(true);
    });

    test("only the documented falsy spellings disable it", () => {
      expect(resolveSecurityHeadersEnabled("false")).toBe(false);
      expect(resolveSecurityHeadersEnabled("0")).toBe(false);
      expect(resolveSecurityHeadersEnabled("off")).toBe(false);
      expect(resolveSecurityHeadersEnabled("FALSE")).toBe(false);
    });
  });

  describe("resolveMetricsConfig", () => {
    test("is enabled by default with no token", () => {
      expect(resolveMetricsConfig({})).toEqual({
        enabled: true,
        token: null,
      });
    });

    test("honours METRICS_ENABLED and METRICS_TOKEN", () => {
      expect(
        resolveMetricsConfig({
          METRICS_ENABLED: "false",
          METRICS_TOKEN: " secret ",
        }),
      ).toEqual({
        enabled: false,
        token: "secret",
      });
    });
  });
});
