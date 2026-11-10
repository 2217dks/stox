const jwt = require("jsonwebtoken");

const UNAUTHORIZED = "UNAUTHORIZED";
const INVALID_AUTH_HEADER = "INVALID_AUTH_HEADER";
const INVALID_ACCESS_TOKEN = "INVALID_ACCESS_TOKEN";

/**
 * Build the error Socket.IO forwards to the client as `connect_error`.
 *
 * `error.data` is the documented way to attach a machine-readable code; the
 * client sees it as `err.data.code`, mirroring the HTTP error envelope.
 */
function socketAuthError(message, code) {
  const error = new Error(message);
  error.data = { code };
  return error;
}

/**
 * Resolve the access token from either transport:
 *
 * 1. `socket.handshake.auth.token` — the Socket.IO-idiomatic form, and the
 *    only one a browser can send.
 * 2. `Authorization: Bearer <token>` — parity with the HTTP middleware for
 *    non-browser clients and tests.
 *
 * Returns `{ token }` on success or `{ error }` when the credentials are
 * missing or the header is malformed.
 */
function extractToken(socket) {
  const authToken = socket.handshake?.auth?.token;

  if (typeof authToken === "string" && authToken.trim() !== "") {
    return { token: authToken.trim() };
  }

  const authorization = socket.handshake?.headers?.authorization;

  if (typeof authorization === "string" && authorization.trim() !== "") {
    const [scheme, token] = authorization.split(" ");

    // RFC 7235 §2.1: the auth-scheme token is case-insensitive.
    if (!scheme || scheme.toLowerCase() !== "bearer" || !token) {
      return {
        error: socketAuthError(
          "Invalid authorization header.",
          INVALID_AUTH_HEADER,
        ),
      };
    }

    return { token };
  }

  return {
    error: socketAuthError("Authentication required.", UNAUTHORIZED),
  };
}

/**
 * Socket.IO middleware that authenticates a namespace handshake.
 *
 * Verification is identical to `src/middleware/auth.js`: same secret, same
 * issuer, same claim shape. The resolved identity lives on `socket.data.user`,
 * never on the client payload, so handlers can trust it.
 */
function authenticateSocket(socket, next) {
  const extracted = extractToken(socket);

  if (extracted.error) {
    return next(extracted.error);
  }

  try {
    const decoded = jwt.verify(extracted.token, process.env.JWT_ACCESS_SECRET, {
      issuer: "stox",
    });

    if (!decoded.userId) {
      return next(
        socketAuthError("Invalid access token.", INVALID_ACCESS_TOKEN),
      );
    }

    socket.data.user = {
      userId: decoded.userId,
      role: decoded.role,
      email: decoded.email,
    };

    return next();
  } catch (error) {
    return next(
      socketAuthError(
        "Invalid or expired access token.",
        INVALID_ACCESS_TOKEN,
      ),
    );
  }
}

module.exports = {
  authenticateSocket,
  extractToken,
};
