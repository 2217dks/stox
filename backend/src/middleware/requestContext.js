const crypto = require("crypto");

// Conservative charset/length so a hostile header cannot be reflected back or
// pollute log aggregation. UUIDs and common trace ids both fit.
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;

function resolveRequestId(value) {
  if (typeof value === "string") {
    const candidate = value.trim();

    if (REQUEST_ID_PATTERN.test(candidate)) {
      return candidate;
    }
  }

  return crypto.randomUUID();
}

/**
 * Attach a correlation id to every request.
 *
 * An upstream gateway or browser may send `X-Request-Id`; it is reused only
 * when it passes validation, so traces connect across services without letting
 * arbitrary client input reach logs. The resolved id is echoed on the response
 * and exposed through CORS so browser clients can report it in bug reports.
 */
function requestContext(req, res, next) {
  const requestId = resolveRequestId(req.headers?.["x-request-id"]);

  req.id = requestId;
  res.setHeader("X-Request-Id", requestId);

  return next();
}

module.exports = {
  REQUEST_ID_PATTERN,
  requestContext,
  resolveRequestId,
};
