const crypto = require("crypto");

const { AppError } = require("../utils/errors");
const { registry: defaultRegistry } = require("./metrics");

const CONTENT_TYPE = "text/plain; version=0.0.4; charset=utf-8";

function extractBearerToken(req) {
  const header = req.headers?.authorization;

  if (typeof header !== "string") {
    return null;
  }

  const [scheme, token] = header.split(" ");

  if (!scheme || scheme.toLowerCase() !== "bearer" || !token) {
    return null;
  }

  return token;
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));

  if (a.length !== b.length) {
    return false;
  }

  return crypto.timingSafeEqual(a, b);
}

/**
 * Prometheus scrape handler.
 *
 * Disabled means "route not found" rather than "forbidden": an operator who
 * turns metrics off should not advertise that the endpoint exists.
 */
function createMetricsHandler({
  registry = defaultRegistry,
  enabled = true,
  token = null,
} = {}) {
  return function metricsHandler(req, res, next) {
    if (!enabled) {
      return next(
        AppError.notFound("Route GET /metrics not found.", "ROUTE_NOT_FOUND"),
      );
    }

    if (token) {
      const presented = extractBearerToken(req);

      if (!presented || !safeEqual(presented, token)) {
        return next(
          AppError.unauthorized(
            "Metrics access requires a bearer token.",
            "UNAUTHORIZED",
          ),
        );
      }
    }

    res.status(200);
    res.setHeader("Content-Type", CONTENT_TYPE);
    res.setHeader("Cache-Control", "no-store");

    return res.send(registry.render());
  };
}

module.exports = {
  CONTENT_TYPE,
  createMetricsHandler,
  extractBearerToken,
};
