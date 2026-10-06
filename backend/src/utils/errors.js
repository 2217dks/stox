class AppError extends Error {
  constructor(message, options = {}) {
    super(message);

    const {
      statusCode = 500,
      code = "INTERNAL_SERVER_ERROR",
      details = null,
    } = options;

    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.isOperational = true;

    Error.captureStackTrace(this, this.constructor);
  }

  static badRequest(message = "Invalid request.", code = "BAD_REQUEST", details = null) {
    return new AppError(message, { statusCode: 400, code, details });
  }

  static unauthorized(message = "Authentication required.", code = "UNAUTHORIZED", details = null) {
    return new AppError(message, { statusCode: 401, code, details });
  }

  static forbidden(message = "You do not have permission to perform this action.", code = "FORBIDDEN", details = null) {
    return new AppError(message, { statusCode: 403, code, details });
  }

  static notFound(message = "Resource not found.", code = "NOT_FOUND", details = null) {
    return new AppError(message, { statusCode: 404, code, details });
  }

  static conflict(message = "Resource conflict.", code = "CONFLICT", details = null) {
    return new AppError(message, { statusCode: 409, code, details });
  }

  static unprocessableEntity(message = "Request could not be processed.", code = "UNPROCESSABLE_ENTITY", details = null) {
    return new AppError(message, { statusCode: 422, code, details });
  }

  static tooManyRequests(message = "Too many requests. Please try again later.", code = "RATE_LIMITED", details = null) {
    return new AppError(message, { statusCode: 429, code, details });
  }

  static internal(message = "An unexpected error occurred.", code = "INTERNAL_SERVER_ERROR", details = null) {
    return new AppError(message, { statusCode: 500, code, details });
  }
}

module.exports = { AppError };
