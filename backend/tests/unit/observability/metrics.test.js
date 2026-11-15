const {
  createMetricsRegistry,
  DEFAULT_BUCKETS,
} = require("../../../src/observability/metrics");

describe("metrics registry", () => {
  let registry;

  beforeEach(() => {
    registry = createMetricsRegistry();
  });

  describe("counters", () => {
    test("increments a labelled counter and renders one series", () => {
      registry.increment("http_requests_total", {
        method: "GET",
        route: "/api/v1/health",
        status: "200",
      });

      const text = registry.render({ includeProcess: false });

      expect(text).toContain("# TYPE http_requests_total counter");
      expect(text).toContain(
        'http_requests_total{method="GET",route="/api/v1/health",status="200"} 1',
      );
    });

    test("accumulates repeated increments on the same series", () => {
      const labels = { method: "GET", route: "/x", status: "200" };

      registry.increment("http_requests_total", labels);
      registry.increment("http_requests_total", labels);
      registry.increment("http_requests_total", labels, 3);

      expect(registry.render({ includeProcess: false })).toContain(
        'http_requests_total{method="GET",route="/x",status="200"} 5',
      );
    });

    test("label order does not create duplicate series", () => {
      registry.increment("http_requests_total", { a: "1", b: "2" });
      registry.increment("http_requests_total", { b: "2", a: "1" });

      const lines = registry
        .render({ includeProcess: false })
        .split("\n")
        .filter((line) => line.startsWith("http_requests_total{"));

      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain('a="1",b="2"');
      expect(lines[0].endsWith(" 2")).toBe(true);
    });

    test("supports an unlabelled counter", () => {
      registry.increment("worker_runs_total");

      expect(registry.render({ includeProcess: false })).toContain(
        "worker_runs_total 1",
      );
    });

    test("unlabelled metrics with different names do not collide", () => {
      registry.increment("worker_runs_total");
      registry.set("db_up", 1);
      registry.incrementGauge("http_requests_in_flight");

      const text = registry.render({ includeProcess: false });

      expect(text).toContain("worker_runs_total 1");
      expect(text).toContain("db_up 1");
      expect(text).toContain("http_requests_in_flight 1");
      expect(text).toContain("# TYPE db_up gauge");
      expect(text).toContain("# TYPE http_requests_in_flight gauge");
    });
  });

  describe("gauges", () => {
    test("set replaces the current value", () => {
      registry.set("db_up", 1);
      registry.set("db_up", 0);

      const text = registry.render({ includeProcess: false });

      expect(text).toContain("# TYPE db_up gauge");
      expect(text).toContain("db_up 0");
      expect(text).not.toContain("db_up 1");
    });

    test("set accepts a value shorthand as well as explicit labels", () => {
      registry.set("queue_depth", 3);
      registry.set("worker_state", { worker: "orders" }, 1);

      const text = registry.render({ includeProcess: false });

      expect(text).toContain("queue_depth 3");
      expect(text).toContain('worker_state{worker="orders"} 1');
    });

    test("increment accepts a value shorthand", () => {
      registry.increment("processed_total", 4);
      registry.increment("processed_total", 2);

      expect(registry.render({ includeProcess: false })).toContain(
        "processed_total 6",
      );
    });

    test("increment and decrement adjust a gauge without changing its type", () => {
      registry.set("http_requests_in_flight", 0);
      registry.incrementGauge("http_requests_in_flight");
      registry.incrementGauge("http_requests_in_flight");
      registry.decrementGauge("http_requests_in_flight");

      const text = registry.render({ includeProcess: false });

      expect(text).toContain("# TYPE http_requests_in_flight gauge");
      expect(text).toContain("http_requests_in_flight 1");
    });
  });

  describe("histograms", () => {
    test("records cumulative buckets, sum and count", () => {
      registry.observe("http_request_duration_seconds", 0.12, {
        route: "/api/v1/health",
      });

      const text = registry.render({ includeProcess: false });

      expect(text).toContain("# TYPE http_request_duration_seconds histogram");
      // 0.12 falls above every bucket up to 0.1 and inside 0.25 and beyond.
      expect(text).toContain(
        'http_request_duration_seconds_bucket{route="/api/v1/health",le="0.1"} 0',
      );
      expect(text).toContain(
        'http_request_duration_seconds_bucket{route="/api/v1/health",le="0.25"} 1',
      );
      expect(text).toContain(
        'http_request_duration_seconds_bucket{route="/api/v1/health",le="+Inf"} 1',
      );
      expect(text).toContain(
        'http_request_duration_seconds_sum{route="/api/v1/health"} 0.12',
      );
      expect(text).toContain(
        'http_request_duration_seconds_count{route="/api/v1/health"} 1',
      );
    });

    test("accumulates multiple observations", () => {
      registry.observe("op_duration_seconds", 0.01);
      registry.observe("op_duration_seconds", 0.2);

      const text = registry.render({ includeProcess: false });

      expect(text).toContain("op_duration_seconds_count 2");
      expect(text).toContain("op_duration_seconds_sum 0.21");
      expect(text).toContain('op_duration_seconds_bucket{le="+Inf"} 2');
    });

    test("uses the documented default buckets", () => {
      expect(DEFAULT_BUCKETS).toEqual([
        0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10,
      ]);
    });

    test("accepts custom buckets", () => {
      const custom = createMetricsRegistry({ buckets: [1, 5] });

      custom.observe("custom_seconds", 3);

      const text = custom.render({ includeProcess: false });

      expect(text).toContain('custom_seconds_bucket{le="1"} 0');
      expect(text).toContain('custom_seconds_bucket{le="5"} 1');
    });
  });

  describe("rendering", () => {
    test("escapes quotes, backslashes and newlines in label values", () => {
      registry.increment("escaped_total", {
        value: 'a"b\\c\nd',
      });

      const text = registry.render({ includeProcess: false });

      expect(text).toContain('value="a\\"b\\\\c\\nd"');
    });

    test("emits HELP only when help text is registered", () => {
      registry.describe("described_total", "Total things processed.");
      registry.increment("described_total");

      const text = registry.render({ includeProcess: false });

      expect(text).toContain("# HELP described_total Total things processed.");
      expect(text).toContain("# TYPE described_total counter");
    });

    test("process metrics are included by default", () => {
      const text = registry.render();

      expect(text).toContain("process_uptime_seconds");
      expect(text).toContain("nodejs_heap_used_bytes");
    });

    test("process metrics can be excluded", () => {
      expect(registry.render({ includeProcess: false })).toBe("");
    });

    test("renders an empty body before any metric is recorded", () => {
      expect(registry.render({ includeProcess: false })).toBe("");
    });

    test("reset clears all recorded series", () => {
      registry.increment("http_requests_total", { status: "200" });
      registry.observe("http_request_duration_seconds", 0.1);

      registry.reset();

      expect(registry.render({ includeProcess: false })).toBe("");
    });
  });
});
