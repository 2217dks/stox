const { AppError } = require("../utils/errors");

function notFoundHandler(req, res, next) {
  // Do not reflect the query string: it can carry tokens or arbitrary input and
  // is never useful for identifying the missing route. This mirrors the
  // request/error logging rule.
  const path = String(req.originalUrl || "").split("?")[0];

  next(
    AppError.notFound(`Route ${req.method} ${path} not found.`, "ROUTE_NOT_FOUND"),
  );
}

module.exports = notFoundHandler;
