const winston = require("winston");

const REDACTED = "[REDACTED]";
const TRUNCATED = "[TRUNCATED]";
const DEFAULT_REDACT_DEPTH = 6;

// Key-name based redaction is deliberately broad: it is better to mask a
// harmless field than to leak a credential through an ad-hoc log call.
const SENSITIVE_KEY_PATTERN =
  /(password|passwd|secret|token|authorization|cookie|api[-_]?key|credential|session)/i;

/**
 * Return a deep copy of `value` with credential-bearing fields masked.
 *
 * Logs are the easiest place to leak a password or bearer token, and call
 * sites are easy to get wrong. Redacting centrally means a service can log a
 * whole request object without auditing every field.
 */
function redactSensitive(value, depth = DEFAULT_REDACT_DEPTH) {
  if (value === null || typeof value !== "object") {
    return value;
  }

  if (depth <= 0) {
    return TRUNCATED;
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactSensitive(item, depth - 1));
  }

  if (value instanceof Date) {
    return value;
  }

  if (value instanceof Error) {
    return { name: value.name, message: value.message };
  }

  const result = {};

  for (const [key, item] of Object.entries(value)) {
    result[key] = SENSITIVE_KEY_PATTERN.test(key)
      ? REDACTED
      : redactSensitive(item, depth - 1);
  }

  return result;
}

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message, ...meta }) => {
      // Redact here as well as in `childLogger`: any call site that passes
      // structured metadata gets the same guarantee.
      const safeMeta = redactSensitive(meta);
      const metaString = Object.keys(safeMeta).length
        ? ` ${JSON.stringify(safeMeta)}`
        : "";
      return `[${timestamp}] ${level.toUpperCase()} ${message}${metaString}`;
    }),
  ),
  transports: [new winston.transports.Console()],
});

/**
 * Create a logger that stamps every line with fixed context.
 *
 * Background jobs use this so a log line can be tied back to one queue job
 * without repeating `queue`/`jobId` at each call site. Call-site metadata wins
 * over the defaults, which lets a handler add per-attempt detail.
 */
function childLogger(context = {}) {
  const defaults =
    context !== null && typeof context === "object"
      ? redactSensitive(context)
      : {};
  const child = {};

  for (const method of ["debug", "info", "warn", "error"]) {
    child[method] = (message, meta = {}) => {
      // Spreading a string/array into an object literal would produce numeric
      // keys, so only object metadata is merged.
      const extra =
        meta !== null && typeof meta === "object" ? redactSensitive(meta) : {};

      logger[method](message, {
        ...defaults,
        ...extra,
      });
    };
  }

  return child;
}

module.exports = logger;
module.exports.REDACTED = REDACTED;
module.exports.TRUNCATED = TRUNCATED;
module.exports.redactSensitive = redactSensitive;
module.exports.childLogger = childLogger;
