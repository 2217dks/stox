const { ZodError } = require("zod");
const { AppError } = require("../utils/errors");
const logger = require("../utils/logger");

/**
 * The ONLY place an error response is rendered.
 *
 * Rungs:
 *   AppError   -> its statusCode / code / details (operational, expected)
 *   ZodError   -> 400 VALIDATION_ERROR + field details
 *   err.statusCode in 4xx/5xx -> honored (third-party middleware)
 *   anything else -> generic 500, message hidden, stack logged
 *
 * Infrastructure errors (for example body-parser failures) must be translated
 * into `AppError` at their boundary — see `middleware/bodyParser.js` — so this
 * handler never needs parser-specific branches.
 */
function errorHandler(err, req, res, next) {
  // Express normally passes an Error, but a thrown string/undefined must still
  // produce the standard envelope instead of crashing the handler itself.
  if (!err || typeof err !== "object") {
    err = new Error("Non-Error value thrown.");
  }

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
    // Strip the query string: it can carry tokens or search terms and is never
    // needed to diagnose a failure. The request logger applies the same rule.
    url: String(req.originalUrl || "").split("?")[0],
    statusCode,
    code,
    message,
    requestId: req.id ?? null,
  };

  if (statusCode >= 500) {
    logger.error("error handler response", {
      ...logEntry,
      stack: stack || undefined,
    });
  } else {
    logger.warn("error handler response", logEntry);
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
