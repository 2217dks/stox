const express = require("express");
const cors = require("cors");

const routes = require("./routes");
const { createSecurityHeaders } = require("./middleware/securityHeaders");
const { requestContext } = require("./middleware/requestContext");
const requestLogger = require("./middleware/requestLogger");
const { createHttpMetrics } = require("./middleware/httpMetrics");
const { createJsonBodyParser } = require("./middleware/bodyParser");
const notFoundHandler = require("./middleware/notFound");
const errorHandler = require("./middleware/errorHandler");
const { globalLimiter } = require("./middleware/rateLimiter");
const { registry } = require("./observability/metrics");
const { createMetricsHandler } = require("./observability/metricsEndpoint");
const { resolveBodyLimit, resolveMetricsConfig } = require("./config/httpConfig");

const app = express();

const metricsConfig = resolveMetricsConfig(process.env);

// Helmet removes this too, but disabling it here keeps the intent explicit and
// survives a future `SECURITY_HEADERS_ENABLED=false` diagnostic run.
app.disable("x-powered-by");

// Order matters. Headers first so even early failures are hardened; the
// correlation id must exist before the request logger reads it; metrics wrap
// the whole request so `finish` fires for every response.
app.use(createSecurityHeaders());
app.use(requestContext);
app.use(requestLogger);
app.use(createHttpMetrics({ metrics: registry }));

app.use(
  cors({
    origin: process.env.CORS_ORIGIN || "http://localhost:3000",
    credentials: true,
    // Browser clients read this to attach the correlation id to bug reports.
    exposedHeaders: ["X-Request-Id"],
  }),
);

// Rate limit before parsing the body: a client already over quota should not
// make the server buffer and parse up to REQUEST_BODY_LIMIT of JSON first.
app.use("/api", globalLimiter);

// An explicit limit turns an accidental multi-megabyte body into a fast 413
// instead of buffering it. The wrapper converts parser failures into AppErrors
// so the centralized error handler renders them like every other failure.
app.use(
  createJsonBodyParser({ limit: resolveBodyLimit(process.env.REQUEST_BODY_LIMIT) }),
);

// Prometheus scrapes `/metrics`; it is intentionally outside `/api` so it is
// not subject to the client-facing rate limiter.
app.get(
  "/metrics",
  createMetricsHandler({
    registry,
    enabled: metricsConfig.enabled,
    token: metricsConfig.token,
  }),
);

app.use("/api/v1", routes);
app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
