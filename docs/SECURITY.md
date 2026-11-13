# 🔐 Security & Authentication

> **Documentation of the security controls currently implemented in the
> Stox backend. Planned or unverified controls are explicitly identified
> rather than described as shipped functionality.**

---

## 📌 Table of Contents

- [Authentication](#-authentication)
- [Access Tokens](#-access-tokens)
- [Refresh Tokens](#-refresh-tokens)
- [Google Authentication](#-google-authentication)
- [Authorization](#-authorization)
- [Input Validation](#-input-validation)
- [Rate Limiting](#-rate-limiting)
- [HTTP Middleware](#-http-middleware)
- [Error Handling and Logging](#-error-handling-and-logging)
- [Implemented Controls and Known Gaps](#-implemented-controls-and-known-gaps)

---

## 🔑 Authentication

Authentication is implemented in:

- `backend/src/services/authService.js`
- `backend/src/controllers/authController.js`
- `backend/src/middleware/auth.js`
- `backend/src/routes/authRoutes.js`

Supported authentication methods:

- Email and password registration.
- Email and password login.
- Google ID-token authentication.
- Access-token authentication for protected HTTP routes.
- Refresh-token rotation.
- Refresh-token revocation during logout.

### Password handling

Local account passwords are hashed using `bcryptjs`.

The salt-round count is configurable through:

```env
BCRYPT_SALT_ROUNDS=10
```

The default is 10 rounds.

The service also checks password strength before registration. The current
policy requires:

- At least 6 characters.
- At least one lowercase letter.
- At least one uppercase letter.
- At least one number.
- At least one symbol.

Email addresses are trimmed and converted to lowercase before storage
and lookup.

---

## 🎟️ Access Tokens

Access tokens are JSON Web Tokens signed using:

```env
JWT_ACCESS_SECRET=
```

The token contains:

- `userId`
- `role`
- `email`

The JWT is issued with:

- Issuer: `stox`
- Subject: the user's ID
- Expiration: configurable through `JWT_ACCESS_EXPIRY`
- Default expiration: `15m`

Protected HTTP routes use:

`backend/src/middleware/auth.js`

The middleware:

1. Reads the `Authorization` header.
2. Requires a Bearer token.
3. Verifies the JWT signature and expiration.
4. Verifies the issuer is `stox`.
5. Requires a `userId` claim.
6. Attaches the verified identity to `req.user`.

The application does not trust a user ID supplied in the request body
as a substitute for the verified token identity.

---

## 🔄 Refresh Tokens

Refresh tokens are opaque cryptographically random values.

Implementation details:

- Generated using Node.js `crypto.randomBytes(48)`.
- Encoded using Base64 URL-safe encoding.
- Hashed with SHA-256 before being stored.
- Only the hash is stored in the `RefreshToken` database table.
- The raw token is returned to the client.

The refresh-token lifetime is configurable through:

```env
JWT_REFRESH_EXPIRY=7d
```

The default lifetime is 7 days.

### Rotation

When a refresh token is exchanged:

1. The supplied token is hashed.
2. The hash is looked up in PostgreSQL.
3. The token must exist, must not be revoked, and must not be expired.
4. The associated account must not be suspended.
5. The old token is revoked.
6. A new access-token and refresh-token pair is issued.
7. The new refresh-token hash is stored.

The old token is not intended to remain usable after successful rotation.

### Logout

The logout endpoint revokes the supplied refresh token.

Revocation is performed against the stored token hash.

Access tokens are not stored as server-side sessions. Revoking a refresh
token does not, by itself, invalidate an already-issued access token
before its expiration.

---

## 🌐 Google Authentication

Google authentication is implemented using `google-auth-library`.

The backend verifies the supplied Google ID token against the configured
Google client ID:

```env
GOOGLE_CLIENT_ID=
```

The backend uses the verified Google account claims to identify or create
the application user.

An existing password account is not automatically linked to a Google
account with the same email. The service returns
`GOOGLE_ACCOUNT_LINK_REQUIRED` instead.

Suspended accounts are rejected.

---

## 👥 Authorization

### Authentication middleware

Protected HTTP routes use:

`backend/src/middleware/auth.js`

Authentication establishes the identity attached to `req.user`.

### Role-based access control

The role-checking helper is implemented in:

`backend/src/middleware/rbac.js`

Usage:

```javascript
const { requireRole } = require("../middleware/rbac");

router.get(
    "/admin/example",
    authMiddleware,
    requireRole("ADMIN"),
    controller.example,
);
```

`requireRole()` rejects requests without an authenticated user and
rejects users whose role is not included in the allowed roles.

### Resource ownership

Resource access must also be scoped to the authenticated user.

For example, portfolio access uses owner-scoped service lookups.
The Socket.IO `/trading` namespace also verifies portfolio ownership
before allowing a client to join a `portfolio:{portfolioId}` room.

A predictable portfolio room name is not treated as authorization.

The backend does not implement a separate generic ABAC middleware
matching the illustrative implementation in older versions of this
document. Resource ownership is enforced in the relevant route,
controller, and service flows.

---

## 🧾 Input Validation

Request validation uses Zod schemas.

Implementation:

- `backend/src/middleware/validation.js`
- `backend/src/validators/`
- Domain-specific route files under `backend/src/routes/`

The validation middleware parses the configured request source and
stores the parsed result in the configured request property.

For example, order routes validate:

- Request bodies for order creation.
- Route parameters for order IDs.
- Query parameters for order listing.

The order validators enforce constraints such as:

- Valid UUIDs for portfolio and order IDs.
- Supported order sides and types.
- Positive decimal values.
- Decimal precision compatible with the database.
- Type-specific limit and stop-price requirements.
- Valid order-status filters.
- Valid date-range boundaries.

Validation failures are handled by the centralized error handler,
which converts Zod errors into a `VALIDATION_ERROR` response.

---

## 🚦 Rate Limiting

Rate limiting is implemented with `express-rate-limit` in:

`backend/src/middleware/rateLimiter.js`

Three limiters are configured:

| Limiter                | Default window | Default limit |
| ---------------------- | -------------- | ------------- |
| Global API limiter     | 15 minutes     | 100 requests  |
| Authentication limiter | 15 minutes     | 10 requests   |
| Order limiter          | 1 minute       | 30 requests   |

The global limiter is mounted on `/api`.

The authentication limiter is applied to registration, login, and
refresh routes.

The order limiter is applied to order creation and cancellation.

The order limiter uses the authenticated user's ID when available
and falls back to the request IP address.

Configuration:

```env
RATE_LIMIT_ENABLED=true
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_GLOBAL_MAX=100
RATE_LIMIT_AUTH_MAX=10
RATE_LIMIT_ORDER_WINDOW_MS=60000
RATE_LIMIT_ORDER_MAX=30
```

Setting `RATE_LIMIT_ENABLED=false` disables the configured limiters.

---

## 🔗 HTTP Middleware

The actual application middleware setup is in:

`backend/src/app.js`

The current order is:

```text
Request
   |
   v
1. Request logger
   |
   v
2. CORS
   |
   v
3. express.json()
   |
   v
4. Global /api rate limiter
   |
   v
5. /api/v1 routes
   |
   v
6. Not-found handler
   |
   v
7. Centralized error handler
```

### CORS

CORS is configured using the `cors` package.

The allowed origin is configured through:

```env
CORS_ORIGIN=http://localhost:3000
```

If the variable is not set, the application uses
`http://localhost:3000`.

Credentials are enabled.

### JSON body parsing

The application uses:

```javascript
app.use(express.json());
```

No custom JSON body-size limit is configured in `app.js`.

The application does not currently install an URL-encoded body parser
in this middleware chain.

### Security headers

Helmet is not installed in the current `app.js` middleware chain.
Do not assume Helmet-provided headers or Content Security Policy
are active.

---

## 🧯 Error Handling and Logging

The centralized error handler is:

`backend/src/middleware/errorHandler.js`

It handles:

- Application errors (`AppError`).
- Zod validation errors.
- Other errors with a valid HTTP status code.
- Unexpected internal errors.

Responses use a consistent error structure:

```json
{
    "success": false,
    "error": {
        "code": "ERROR_CODE",
        "message": "Description of the error"
    }
}
```

Additional error details are included when available.

The request logger records:

- HTTP method.
- Request URL.
- Response status code.
- Request duration.

The error handler logs warning-level responses for client errors and
error-level responses for server errors. Server-error logs include
the error stack when available.

This request/error logging is not a complete security audit trail of
all sensitive user actions.

---

## ✅ Implemented Controls and Known Gaps

| Control                               | Current status                                                                     |
| ------------------------------------- | ---------------------------------------------------------------------------------- |
| bcrypt password hashing               | Implemented                                                                        |
| Configurable bcrypt salt rounds       | Implemented                                                                        |
| JWT access-token verification         | Implemented                                                                        |
| JWT issuer verification               | Implemented                                                                        |
| Opaque refresh tokens                 | Implemented                                                                        |
| SHA-256 refresh-token storage         | Implemented                                                                        |
| Refresh-token rotation                | Implemented                                                                        |
| Refresh-token revocation              | Implemented                                                                        |
| Google ID-token verification          | Implemented                                                                        |
| Zod request validation                | Implemented                                                                        |
| Global API rate limiting              | Implemented                                                                        |
| Authentication rate limiting          | Implemented                                                                        |
| Order rate limiting                   | Implemented                                                                        |
| CORS origin configuration             | Implemented                                                                        |
| Prisma query parameterization         | Used through Prisma Client                                                         |
| Resource ownership checks             | Implemented in relevant domain flows                                               |
| Helmet security headers               | Not installed in current app middleware                                            |
| Explicit Content Security Policy      | Not configured in current app middleware                                           |
| CSRF token protection                 | Not implemented in current app middleware                                          |
| Dedicated XSS sanitization middleware | Not installed in current app middleware                                            |
| Custom JSON body-size limit           | Not configured in `app.js`                                                         |
| URL-encoded body parser               | Not installed in current app middleware                                            |
| Complete security audit trail         | Not implemented                                                                    |
| HTTPS enforcement in Express          | Not implemented in `app.js`; deployment infrastructure must be assessed separately |

---

## 📚 Related Documents

- `docs/REALTIME.md` — Socket.IO authentication and room authorization.
- `docs/API.md` — HTTP API contracts.
- `docs/ERROR_HANDLING.md` — Application errors and response format.
- `docs/DATABASE.md` — Database models, including refresh tokens.
