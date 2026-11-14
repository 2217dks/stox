/**
 * HTTP-layer configuration resolved from the environment.
 *
 * Keeping these in one module means `app.js` stays declarative and every
 * value has a documented default plus a unit test for its parsing rules.
 */

const DEFAULT_BODY_LIMIT = "100kb";

// Express/`bytes` accepts values like "100kb", "1mb", "512b". Anything else is
// a configuration bug: silently falling back would either remove the guard or
// make the API reject legitimate payloads, so fail fast at startup.
const BODY_LIMIT_PATTERN = /^\d+(?:\.\d+)?\s?(?:b|kb|mb|gb)$/i;

const DISABLED_VALUES = new Set(["false", "0", "off", "no"]);

function resolveBodyLimit(value) {
  const trimmed = typeof value === "string" ? value.trim() : "";

  if (trimmed === "") {
    return DEFAULT_BODY_LIMIT;
  }

  if (!BODY_LIMIT_PATTERN.test(trimmed)) {
    throw new Error(
      `Invalid body limit "${trimmed}" in REQUEST_BODY_LIMIT. Use a size such as 100kb or 1mb.`,
    );
  }

  return trimmed;
}

function resolveBoolean(value, fallback) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return fallback;
  }

  return !DISABLED_VALUES.has(String(value).trim().toLowerCase());
}

function resolveSecurityHeadersEnabled(value) {
  return resolveBoolean(value, true);
}

function resolveMetricsConfig(env = process.env) {
  const token =
    typeof env.METRICS_TOKEN === "string" && env.METRICS_TOKEN.trim() !== ""
      ? env.METRICS_TOKEN.trim()
      : null;

  return {
    enabled: resolveBoolean(env.METRICS_ENABLED, true),
    token,
  };
}

module.exports = {
  DEFAULT_BODY_LIMIT,
  resolveBodyLimit,
  resolveSecurityHeadersEnabled,
  resolveMetricsConfig,
};
