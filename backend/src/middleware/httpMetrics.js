const { registry: defaultRegistry } = require("../observability/metrics");

/**
 * Express uses the matched route pattern (`/api/v1/orders/:id`) rather than the
 * raw URL, so a thousand distinct order ids still produce one time series.
 * Unmatched requests collapse into a single `unmatched` series for the same
 * reason: unknown URLs are attacker-controlled and must never become labels.
 */
function resolveRouteLabel(req) {
  if (!req.route) {
    return "unmatched";
  }

  const path = `${req.baseUrl || ""}${req.route.path || ""}`;

  return path || "unmatched";
}

function createHttpMetrics({ metrics = defaultRegistry } = {}) {
  return function httpMetrics(req, res, next) {
    const startedAt = process.hrtime.bigint();

    metrics.incrementGauge("http_requests_in_flight");

    res.on("finish", () => {
      metrics.decrementGauge("http_requests_in_flight");

      const durationSeconds =
        Number(process.hrtime.bigint() - startedAt) / 1_000_000_000;

      const labels = {
        method: req.method,
        route: resolveRouteLabel(req),
        status: String(res.statusCode),
      };

      metrics.increment("http_requests_total", labels);
      metrics.observe("http_request_duration_seconds", durationSeconds, labels);
    });

    return next();
  };
}

module.exports = {
  createHttpMetrics,
  resolveRouteLabel,
};
