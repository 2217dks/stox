const { AppError } = require("../utils/errors");

function notFoundHandler(req, res, next) {
  next(
    AppError.notFound(
      `Route ${req.method} ${req.originalUrl} not found.`,
      "ROUTE_NOT_FOUND",
    ),
  );
}

module.exports = notFoundHandler;
