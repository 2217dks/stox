const {
  createMetricsHandler,
} = require("../../../src/observability/metricsEndpoint");
const { createMetricsRegistry } = require("../../../src/observability/metrics");

function makeRes() {
  return {
    statusCode: null,
    headers: {},
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    setHeader(name, value) {
      this.headers[String(name).toLowerCase()] = value;
      return this;
    },
    send(body) {
      this.body = body;
      return this;
    },
  };
}

function makeReq(authorization) {
  return { headers: authorization ? { authorization } : {} };
}

describe("metrics endpoint handler", () => {
  let registry;

  beforeEach(() => {
    registry = createMetricsRegistry();
    registry.increment("http_requests_total", { status: "200" });
  });

  test("renders the registry as Prometheus text", () => {
    const res = makeRes();
    const next = jest.fn();

    createMetricsHandler({ registry })(makeReq(), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe(
      "text/plain; version=0.0.4; charset=utf-8",
    );
    expect(res.body).toContain("# TYPE http_requests_total counter");
    expect(res.body).toContain("http_requests_total");
  });

  test("is public when no token is configured", () => {
    const res = makeRes();

    createMetricsHandler({ registry })(makeReq(), res, jest.fn());

    expect(res.statusCode).toBe(200);
  });

  test("requires a bearer token when one is configured", () => {
    const res = makeRes();
    const next = jest.fn();

    createMetricsHandler({ registry, token: "s3cret" })(makeReq(), res, next);

    expect(res.statusCode).toBeNull();
    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0].statusCode).toBe(401);
    expect(next.mock.calls[0][0].code).toBe("UNAUTHORIZED");
  });

  test("rejects a wrong token", () => {
    const res = makeRes();
    const next = jest.fn();

    createMetricsHandler({ registry, token: "s3cret" })(
      makeReq("Bearer wrong"),
      res,
      next,
    );

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0].statusCode).toBe(401);
  });

  test("accepts the correct bearer token", () => {
    const res = makeRes();
    const next = jest.fn();

    createMetricsHandler({ registry, token: "s3cret" })(
      makeReq("Bearer s3cret"),
      res,
      next,
    );

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
  });

  test("accepts the token scheme case-insensitively", () => {
    const res = makeRes();

    createMetricsHandler({ registry, token: "s3cret" })(
      makeReq("bearer s3cret"),
      res,
      jest.fn(),
    );

    expect(res.statusCode).toBe(200);
  });

  test("can be disabled so the route is never exposed", () => {
    const res = makeRes();
    const next = jest.fn();

    createMetricsHandler({ registry, enabled: false })(makeReq(), res, next);

    expect(res.statusCode).toBeNull();
    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0].statusCode).toBe(404);
  });
});
