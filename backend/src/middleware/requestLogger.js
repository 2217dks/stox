const logger = require("../utils/logger");

/**
 * One structured line per request.
 *
 * Contract (docs/OBSERVABILITY.md):
 *   { method, url, statusCode, durationMs, requestId, userId }
 *
 * - The query string is stripped: it can carry tokens or search terms and is
 *   never needed for latency/status analysis.
 * - Headers and bodies are never logged.
 * - `userId` is `null` for anonymous requests so log consumers see a stable
 *   shape instead of a missing field.
 */
function requestLogger(req, res, next) {
  const startedAt = Date.now();

  res.on("finish", () => {
    const durationMs = Date.now() - startedAt;
    const { method, originalUrl } = req;
    const { statusCode } = res;

    const entry = {
      method,
      url: String(originalUrl || "").split("?")[0],
      statusCode,
      durationMs,
      requestId: req.id ?? null,
      userId: req.user?.userId ?? null,
    };

    if (statusCode >= 500) {
      logger.error("request completed", entry);
    } else if (statusCode >= 400) {
      logger.warn("request completed", entry);
    } else {
      logger.info("request completed", entry);
    }
  });

  next();
}

module.exports = requestLogger;
