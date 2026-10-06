const logger = require("../utils/logger");

function requestLogger(req, res, next) {
  const startedAt = Date.now();

  res.on("finish", () => {
    const durationMs = Date.now() - startedAt;
    const { method, originalUrl } = req;
    const { statusCode } = res;

    if (statusCode >= 500) {
      logger.error("request completed", {
        method,
        url: originalUrl,
        statusCode,
        durationMs,
      });
    } else if (statusCode >= 400) {
      logger.warn("request completed", {
        method,
        url: originalUrl,
        statusCode,
        durationMs,
      });
    } else {
      logger.info("request completed", {
        method,
        url: originalUrl,
        statusCode,
        durationMs,
      });
    }
  });

  next();
}

module.exports = requestLogger;
