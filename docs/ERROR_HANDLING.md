# ⚠️ Error Handling

> **How errors work in the stox backend — read this before writing any controller, service, or middleware code.**

---

## 📌 Table of Contents

- [The One Rule](#-the-one-rule)
- [Architecture](#-architecture)
- [AppError Reference](#-apperror-reference)
- [Rules Per Layer](#-rules-per-layer)
- [Error Code Conventions](#-error-code-conventions)
- [HTTP Status Cheatsheet](#-http-status-cheatsheet)
- [Common Mistakes](#-common-mistakes)
- [Testing Error Paths](#-testing-error-paths)

---

## 🚫 The One Rule

**Never send an error response outside `middleware/errorHandler.js`.**

Controllers, services, and middleware **throw** errors — they never format them.
Exactly one file in the codebase (`src/middleware/errorHandler.js`) decides the HTTP
status and JSON body of a failure. This guarantees every client receives the same
error envelope:

```json
{
  "success": false,
  "error": {
    "code": "INVALID_CREDENTIALS",
    "message": "Invalid email or password.",
    "details": [] // optional, only when present
  }
}
```

If you find yourself writing `res.status(400).json({ success: false, ... })` inside
a controller or service — stop. That is a bug waiting to make error responses
inconsistent. **Throw instead.**

---

## 🏗️ Architecture

```
Controller / Middleware / Service
        │
        │  throw AppError / next(err)      ← you write this
        ▼
Express router (catches throws, forwards as next(err))
        │
        ▼
src/middleware/errorHandler.js         ← the ONLY place that renders errors
        │
        ├── err instanceof AppError     → use its statusCode / code / details
        ├── err instanceof ZodError     → 400 VALIDATION_ERROR + field details
        ├── err has numeric statusCode  → honored (legacy / third-party errors)
        └── anything else               → 500 INTERNAL_SERVER_ERROR (generic,
                                           message hidden, stack logged server-side)
```

Key properties:

- **Operational vs programmer errors.** `AppError` marks expected failures
  (bad input, missing record, conflicts). Unknown errors are presumed to be bugs —
  the client gets a safe generic message; the full stack goes to server logs only.
- **Log split.** Status ≥ 500 → `console.error` with stack. Status < 500 →
  one-line `console.warn` (a 401 is traffic, not an incident).
- **`notFound` middleware** (`src/middleware/notFound.js`) manufactures a 404
  `AppError` for unmatched routes and delegates to the handler — mounted after all
  routes, before the error handler, in `src/app.js`.

Mount order in `src/app.js` is load-bearing — never reorder:

```js
app.use("/api/v1", routes);
app.use(notFoundHandler);
app.use(errorHandler);
```

> ⚠️ **Any code that assembles an Express app — including test harnesses — must mount
> the centralized errorHandler the same way.** Test scripts that build mini-apps
> without it will produce responses that diverge from the API contract. Prefer
> importing `src/app.js` directly in tests.

---

## 🧰 AppError Reference

Location: `src/utils/errors.js`

```js
const { AppError } = require("../utils/errors");

// Constructor — full control
throw new AppError("Custom message", {
  statusCode: 422,
  code: "CUSTOM_CODE",
  details: { some: "payload" },
});

// Factories — preferred; statusCode + code get sensible defaults
throw AppError.badRequest("Portfolio name is required.", "PORTFOLIO_NAME_REQUIRED");
```

| Factory | Status | Default code | Typical use |
|---|---|---|---|
| `AppError.badRequest(msg, code?, details?)` | 400 | `BAD_REQUEST` | Malformed input, weak password |
| `AppError.unauthorized(msg, code?)` | 401 | `UNAUTHORIZED` | Missing/expired token, bad credentials |
| `AppError.forbidden(msg, code?)` | 403 | `FORBIDDEN` | Suspended account, insufficient role |
| `AppError.notFound(msg, code?)` | 404 | `NOT_FOUND` | Missing user, portfolio, order |
| `AppError.conflict(msg, code?)` | 409 | `CONFLICT` | Duplicate email, duplicate portfolio name |
| `AppError.unprocessableEntity(msg, code?)` | 422 | `UNPROCESSABLE_ENTITY` | Semantically invalid (e.g., trade logic) |
| `AppError.tooManyRequests(msg, code?)` | 429 | `RATE_LIMITED` | Rate limiting (Task: rate limiter) |
| `AppError.internal(msg, code?)` | 500 | `INTERNAL_SERVER_ERROR` | Rarely thrown directly; unknown errors land here anyway |

All factory args are optional with defaults. Always override `code` with a
domain-specific string — the default codes are fallbacks, not names to ship.

---

## 📏 Rules Per Layer

### Controllers (`src/controllers/*`)

- Do **not** parse/validate the body — a `validate(schema)` middleware on the route
  already did (`src/middleware/validation.js`). The controller receives clean,
  transformed data in `req.body`.
- Extract from `req.body` / `req.user` / `req.params`, call the service, return the
  success envelope.
- The catch block is always exactly:

```js
async function handler(req, res, next) {
  try {
    // ... service call
    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    return next(error);
  }
}
```

- Success responses may be sent by the controller. Error responses may not.

### Services (`src/services/*`)

- Business rules live here. On violation, **throw**:

```js
if (!user) {
  throw AppError.unauthorized("Invalid email or password.", "INVALID_CREDENTIALS");
}
```

- **Translate infrastructure errors into domain errors** before they escape:

```js
try {
  await prisma.portfolio.create({ data });
} catch (error) {
  if (error?.code === "P2002") {
    throw AppError.conflict(
      "A portfolio with this name already exists.",
      "PORTFOLIO_NAME_EXISTS",
    );
  }
  throw error; // unknown → handler's 500 rung
}
```

- Services never import `express`, never touch `req`/`res`.

### Middleware (`src/middleware/*`)

- Same contract: `return next(AppError.forbidden(...))` on failure.
- **The `return` before `next` is mandatory** — without it, execution continues
  after forwarding and can throw a second error on top of the first.

### Input validation (`src/validators/*` + `src/middleware/validation.js`)

- Define a Zod schema per endpoint in `src/validators/`, export it.
- Attach on the route — validation runs **before** the controller:

```js
router.post("/register", validate(registerSchema), register);
// protected routes: auth FIRST, then validation
router.patch("/profile", authMiddleware, validate(updateProfileSchema), updateCurrentUser);
```

- Chain order = the order problems get rejected: identity → permission → input
  validity → business logic.
- `validate(schema)` mutates `req.body` to the parsed (trimmed/typed/defaulted)
  result — downstream code consumes the validated version.

---

## 🏷️ Error Code Conventions

- Format: `SCREAMING_SNAKE_CASE`.
- Namespace by feature to avoid collisions: `PORTFOLIO_NOT_FOUND`,
  `ORDER_NOT_FOUND`, `USER_NOT_FOUND`, `INVALID_CREDENTIALS`.
- `details` (optional) carries structured context the frontend can render —
  e.g., Zod issues: `[{ path: "email", message: "Please provide a valid email address." }]`.
- Codes are API contract. Once a frontend consumes a code, it is frozen —
  renaming one is a breaking change.

---

## 📊 HTTP Status Cheatsheet

| Status | When |
|---|---|
| 400 | Body/query fails schema validation, malformed input |
| 401 | Not authenticated (missing/invalid/expired token) |
| 403 | Authenticated but not allowed (suspended, wrong role, not owner) |
| 404 | Resource doesn't exist (also: unknown route → `ROUTE_NOT_FOUND`) |
| 409 | State conflict (duplicate email/name, linking an already-linked account) |
| 422 | Well-formed but semantically invalid for business logic |
| 429 | Rate limited |
| 500 | Bug or infrastructure failure — message is always generic to the client |
| 503 | Health check reports degraded dependencies (only `healthController` may self-report) |

---

## 🚷 Common Mistakes

1. **`res.status(...).json({...})` in a controller/service** — defeats the central
   handler. Throw / `next()` instead.
2. **`next(err)` without `return`** in a middleware — execution continues afterward.
3. **Sending sensitive internals to clients** — raw `err.message` from unknown
   errors can leak DB URLs or stack info. Only `AppError`/ZodError messages are
   exposed verbatim.
4. **`console.error` per-controller** — the handler already logs; duplicates pollute
   logs. Remove them.
5. **Catching a ZodError to format it yourself** — the handler's `ZodError` rung
   already does this. Let it propagate.
6. **Throwing a raw `new Error("User-facing message")`** — becomes a 500 with a
   generic message. If the client should see it, it must be an `AppError`.
7. **Raw `Error` for startup/config failures is OK** — programmer errors *should*
   become generic 500s (see `authService.js` env checks). Don't wrap those.
8. **Reordering `app.js` middleware** — `notFoundHandler` must be after routes,
   `errorHandler` last, or 404s/errors escape to Express defaults (HTML responses).

---

## 🧪 Testing Error Paths

- **Test scripts must use `src/app.js`** (or mount `errorHandler`) — see warning above.
- Assert on both status AND `body.error.code`:

```js
const res = await request(app).post("/api/v1/auth/login").send({
  email, password: "WrongPassword123!",
});
// status 401
assert(res.body.error?.code === "INVALID_CREDENTIALS");
```

- Manual smoke checks: unknown route → `ROUTE_NOT_FOUND`; garbage body →
  `VALIDATION_ERROR` with `details`; duplicate email → `EMAIL_ALREADY_EXISTS`.
- Log check: 4xx → `console.warn` line; 5xx → `console.error` + stack.

---

*Maintained by the backend team. When adding a new status/code convention, update
this file in the same PR.*
