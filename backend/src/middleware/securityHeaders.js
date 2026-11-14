const helmet = require("helmet");

const {
  resolveSecurityHeadersEnabled,
} = require("../config/httpConfig");

/**
 * Security headers for a JSON API.
 *
 * Helmet's defaults are browser-document oriented. Two deliberate changes:
 *
 * - CSP is locked down to `default-src 'none'` / `frame-ancestors 'none'`.
 *   The backend serves no HTML, so the permissive script/style sources in the
 *   default policy only widen the attack surface.
 * - `Cross-Origin-Resource-Policy` is `cross-origin` because the Next.js
 *   frontend is served from a different origin (localhost:3000 by default).
 *   `same-origin` would make browsers block cross-origin reads of API
 *   responses in some embedding contexts.
 */
function createSecurityHeaders({
  enabled = resolveSecurityHeadersEnabled(process.env.SECURITY_HEADERS_ENABLED),
} = {}) {
  if (!enabled) {
    return function securityHeadersDisabled(req, res, next) {
      return next();
    };
  }

  return helmet({
    contentSecurityPolicy: {
      // Do not inherit Helmet's document-oriented defaults (`script-src`,
      // `style-src`, `upgrade-insecure-requests`, …). This API serves no HTML,
      // so the policy is exactly these two directives.
      useDefaults: false,
      directives: {
        "default-src": ["'none'"],
        "frame-ancestors": ["'none'"],
      },
    },
    crossOriginResourcePolicy: { policy: "cross-origin" },
  });
}

module.exports = {
  createSecurityHeaders,
};
