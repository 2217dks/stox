const {
  createSecurityHeaders,
} = require("../../../src/middleware/securityHeaders");

function makeRes() {
  const headers = new Map();

  return {
    headers,
    setHeader(name, value) {
      headers.set(String(name).toLowerCase(), value);
    },
    getHeader(name) {
      return headers.get(String(name).toLowerCase());
    },
    removeHeader(name) {
      headers.delete(String(name).toLowerCase());
    },
  };
}

describe("security headers middleware", () => {
  test("applies the hardened header set and calls next", () => {
    const res = makeRes();
    const next = jest.fn();

    createSecurityHeaders()({}, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.getHeader("x-content-type-options")).toBe("nosniff");
    expect(res.getHeader("referrer-policy")).toBe("no-referrer");
    expect(res.getHeader("x-frame-options")).toBe("SAMEORIGIN");
    expect(res.getHeader("strict-transport-security")).toContain("max-age=");
    expect(res.getHeader("x-powered-by")).toBeUndefined();
  });

  test("uses an API-appropriate CSP that forbids framing", () => {
    const res = makeRes();

    createSecurityHeaders()({}, res, jest.fn());

    const csp = res.getHeader("content-security-policy");

    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    // Document-oriented Helmet defaults must not leak into an API policy.
    expect(csp).not.toContain("script-src");
    expect(csp).not.toContain("style-src");
    expect(csp).not.toContain("upgrade-insecure-requests");
  });

  test("allows cross-origin resource reads for the separate frontend origin", () => {
    const res = makeRes();

    createSecurityHeaders()({}, res, jest.fn());

    expect(res.getHeader("cross-origin-resource-policy")).toBe("cross-origin");
  });

  test("is a no-op when disabled", () => {
    const res = makeRes();
    const next = jest.fn();

    createSecurityHeaders({ enabled: false })({}, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.headers.size).toBe(0);
  });

  test("does not remove an existing x-powered-by when disabled", () => {
    const res = makeRes();
    res.setHeader("x-powered-by", "Express");

    createSecurityHeaders({ enabled: false })({}, res, jest.fn());

    expect(res.getHeader("x-powered-by")).toBe("Express");
  });
});
