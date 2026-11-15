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

    let finalized = false;

    const finalize = () => {
      if (finalized) {
        return;
      }

      finalized = true;
      metrics.decrementGauge("http_requests_in_flight");

      // A client that disconnects mid-response emits `close` without `finish`.
      // The gauge must still be released, but the request was not completed,
      // so it must not be counted as a successful/failed response.
      if (!res.writableFinished) {
        return;
      }

      const durationSeconds =
        Number(process.hrtime.bigint() - startedAt) / 1_000_000_000;

      const labels = {
        method: req.method,
        route: resolveRouteLabel(req),
        status: String(res.statusCode),
      };

      metrics.increment("http_requests_total", labels);
      metrics.observe("http_request_duration_seconds", durationSeconds, labels);
    };

    res.on("finish", finalize);
    // `close` fires after `finish` too; `finalized` keeps the accounting
    // exactly once per request.
    res.on("close", finalize);

    return next();
  };
}

module.exports = {
  createHttpMetrics,
  resolveRouteLabel,
};
