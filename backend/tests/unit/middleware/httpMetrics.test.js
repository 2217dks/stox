const { EventEmitter } = require("events");

const {
  createMetricsRegistry,
} = require("../../../src/observability/metrics");
const {
  createHttpMetrics,
  resolveRouteLabel,
} = require("../../../src/middleware/httpMetrics");

function makeRes(statusCode, writableFinished) {
  const res = new EventEmitter();
  res.statusCode = statusCode;
  res.writableFinished = writableFinished;
  return res;
}

describe("http metrics middleware", () => {
  test("records a completed request exactly once even if finish and close both fire", () => {
    const registry = createMetricsRegistry();
    const middleware = createHttpMetrics({ metrics: registry });
    const req = {
      method: "GET",
      baseUrl: "/api/v1",
      route: { path: "/orders/:id" },
    };
    const res = makeRes(200, true);

    middleware(req, res, () => {});
    res.emit("finish");
    res.emit("close");

    const text = registry.render({ includeProcess: false });

    expect(text).toContain(
      'http_requests_total{method="GET",route="/api/v1/orders/:id",status="200"} 1',
    );
    expect(text.match(/http_requests_total\{/g)).toHaveLength(1);
    expect(text).toContain("http_requests_in_flight 0");
  });

  test("releases the in-flight gauge for an aborted request without counting it", () => {
    const registry = createMetricsRegistry();
    const middleware = createHttpMetrics({ metrics: registry });
    const req = { method: "GET" };
    const res = makeRes(200, false);

    middleware(req, res, () => {});
    res.emit("close");

    const text = registry.render({ includeProcess: false });

    expect(text).toContain("http_requests_in_flight 0");
    expect(text).not.toContain("http_requests_total");
  });

  test("labels unmatched routes as unmatched", () => {
    expect(resolveRouteLabel({ method: "GET" })).toBe("unmatched");
  });

  test("uses the matched route pattern rather than the raw URL", () => {
    expect(
      resolveRouteLabel({ baseUrl: "/api/v1", route: { path: "/:id" } }),
    ).toBe("/api/v1/:id");
  });

  test("records the status code of a failed request", () => {
    const registry = createMetricsRegistry();
    const middleware = createHttpMetrics({ metrics: registry });
    const res = makeRes(404, true);

    middleware({ method: "POST" }, res, () => {});
    res.emit("finish");

    expect(registry.render({ includeProcess: false })).toContain(
      'http_requests_total{method="POST",route="unmatched",status="404"} 1',
    );
  });
});
