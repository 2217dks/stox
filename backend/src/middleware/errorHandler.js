const { ZodError } = require("zod");
const { AppError } = require("../utils/errors");

function errorHandler(err, req, res, next) {
  let statusCode = 500;
  let code = "INTERNAL_SERVER_ERROR";
  let message = "An unexpected error occurred.";
  let details = null;
  let stack = err.stack;

  if (err instanceof AppError) {
    statusCode = err.statusCode;
    code = err.code;
    message = err.message;
    details = err.details;
    stack = err.stack;
  } else if (err instanceof ZodError) {
    statusCode = 400;
    code = "VALIDATION_ERROR";
    message = "Request validation failed.";
    details = err.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    }));
  } else if (
    typeof err.statusCode === "number" &&
    err.statusCode >= 400 &&
    err.statusCode < 600
  ) {
    statusCode = err.statusCode;
    code = typeof err.code === "string" ? err.code : "REQUEST_ERROR";
    message = err.message;
  }

  const logEntry = {
    method: req.method,
    url: req.originalUrl,
    statusCode,
    code,
    message,
  };

  if (statusCode >= 500) {
    console.error(
      `[errorHandler] ${JSON.stringify(logEntry)}`,
      stack ? `\n${stack}` : "",
    );
  } else {
    console.warn(`[errorHandler] ${JSON.stringify(logEntry)}`);
  }

  const body = {
    success: false,
    error: {
      code,
      message,
    },
  };

  if (details) {
    body.error.details = details;
  }

  return res.status(statusCode).json(body);
}

module.exports = errorHandler;
