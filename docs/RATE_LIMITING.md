# 🚦 Rate Limiting

> **How rate limiting works in the stox backend — read this before adding a route or touching middleware order.**

---

## 📌 Table of Contents

- [The One Rule](#-the-one-rule)
- [The Three Tiers](#-the-three-tiers)
- [How It Works](#-how-it-works)
- [Configuration](#-configuration)
- [Mounting Rules](#-mounting-rules)
- [Response Contract](#-response-contract)
- [Adding a New Limiter](#-adding-a-new-limiter)
- [Production Notes](#-production-notes)
- [Common Mistakes](#-common-mistakes)
- [Testing](#-testing)

---

## 🚫 The One Rule

**All limiter definitions live in `src/middleware/rateLimiter.js`. Routes never call `rateLimit()` directly.**

Exactly one file owns the limiter configuration — tiers, windows, keying, and
the 429 response shape. A route file only imports a limiter and mounts it. This
keeps every knob in one place and makes the Redis upgrade a one-file change.

---

## 🪜 The Three Tiers

| Tier | Keyed by | Scope | Default | Window | Protects against |
| --- | --- | --- | --- | --- | --- |
| `globalLimiter` | IP | every `/api` request | 100 req | 15 min | generic floods |
| `authLimiter` | IP | login, register, refresh | 10 req | 15 min | credential brute force, bulk signup |
| `orderLimiter` | **user ID** (IP fallback) | order creation | 30 req | 1 min | order spam, runaway clients |

Tiers are **nested**: a login request consumes the auth budget *and* the global
budget. The three auth paths (`login`, `register`, `refresh`) **share one
budget** because they use the same limiter instance — an attacker rotating
between paths gains nothing.

The order limiter is keyed per user (`req.user.userId`), so one trader's
traffic never depletes another trader's budget, and a large `quantity` is never
rate limited (bulk *size* is a validation concern, bulk *frequency* is a
rate-limiting concern).

---

## ⚙️ How It Works

- **Fixed window counters.** Each limiter keeps `key → { count, windowStart }`.
  A request inside the window increments the count; a request after the window
  resets it. Fixed windows allow a ~2× burst across a window boundary —
  acceptable here, revisit with a sliding-window store if it ever matters.
- **In-memory store** (`MemoryStore`): per-process, resets on restart, not
  shared across instances. Correct for dev and single-instance deploys.
- **Draft-8 headers.** Every response (not just 429s) carries
  `RateLimit-Policy`, `RateLimit-Limit`, `RateLimit-Remaining`,
  `RateLimit-Reset` so clients can back off *before* being throttled.
- **Construction-time validation.** `express-rate-limit` v8 validates options
  when a limiter is constructed — a wrong option or an IPv6-unsafe custom key
  crashes at startup, not at request time. Treat a startup crash as the
  library enforcing its API contract.

---

## 🔧 Configuration

Everything is environment-driven with documented defaults (see
`.env.example`):

| Variable | Default | Controls |
| --- | --- | --- |
| `RATE_LIMIT_ENABLED` | `true` | `false` = pass-through mode (no counting, no headers, no 429s) |
| `RATE_LIMIT_WINDOW_MS` | `900000` | window for global + auth tiers |
| `RATE_LIMIT_GLOBAL_MAX` | `100` | global tier limit |
| `RATE_LIMIT_AUTH_MAX` | `10` | auth tier limit |
| `RATE_LIMIT_ORDER_WINDOW_MS` | `60000` | window for the order tier |
| `RATE_LIMIT_ORDER_MAX` | `30` | order tier limit |

Environment recipes:

```bash
# Production — leave everything at defaults (documented limits active)
# (no changes needed)

# Development — raise limits so manual testing never surprises you
RATE_LIMIT_GLOBAL_MAX=1000
RATE_LIMIT_AUTH_MAX=100

# Local load testing — disable entirely
RATE_LIMIT_ENABLED=false
```

Values are read **once at startup** (when `rateLimiter.js` is first required).
Changing `.env` requires a server restart.

---

## 📏 Mounting Rules

Current mounts:

```javascript
// app.js — global tier, after the body parser, before routes
app.use(express.json());
app.use("/api", globalLimiter);
app.use("/api/v1", routes);

// authRoutes.js — per-path, only on brute-force targets
router.post("/register", authLimiter, validate(registerSchema), register);
router.post("/login", authLimiter, validate(loginSchema), login);
router.post("/refresh", authLimiter, validate(refreshTokenSchema), refresh);

// orderRoutes.js — AFTER authMiddleware (see below)
router.post(
  "/",
  authMiddleware,
  orderLimiter,
  validate(createMarketOrderSchema),
  orderController.createMarketOrder,
);
```

Rules:

1. **`authMiddleware` must come before any limiter that reads `req.user`.**
   The order limiter keys on `req.user.userId`; mounted before auth, every
   request silently falls back to IP keying and the per-user design never
   engages. The chain-order test in `rateLimit.integration.test.js` guards
   this.
2. **Per-path, not `router.use`, for tight budgets.** `authLimiter` is mounted
   on three paths individually — `router.use(authLimiter)` would splatter the
   10-request budget onto `/me` and `/logout` too. Never rate limit logout or
   `/me` (every page load calls it).
3. **Global tier stays mounted before routes** so rate-limited requests are
   still logged by the request logger (mount it before the logger and you go
   blind during an attack — exactly when logs matter most).
4. **`/health` stays under the global tier.** If orchestrator probes ever get
   aggressive, add `skip: (req) => req.path === "/health"` to the global
   limiter — do not exempt it preemptively.

---

## 📨 Response Contract

A throttled request never reaches route code. The limiter itself renders:

```json
{
  "success": false,
  "error": {
    "code": "RATE_LIMITED",
    "message": "Too many requests. Please try again later."
  }
}
```

- Status `429`, same envelope as every other error, produced by
  `rateLimitedResponse` inside `rateLimiter.js`.
- The 429 deliberately does **not** go through the error handler: a throttled
  request is a traffic event, not a server fault, and routing it through
  `errorHandler` would log every hit as ERROR with a stack trace.
- Message text matches `AppError.tooManyRequests()`'s default, so clients see
  one consistent string regardless of which component rejected them.

---

## ➕ Adding a New Limiter

1. Define it in `src/middleware/rateLimiter.js` using `commonOptions`:

```javascript
const exportLimiter = rateLimit({
  ...commonOptions,
  windowMs: envInt("RATE_LIMIT_EXPORT_WINDOW_MS", 60 * 1000),
  limit: envInt("RATE_LIMIT_EXPORT_MAX", 5),
});
```

2. Add its env vars to `.env.example` with defaults.
3. Mount it in the route file — after `authMiddleware` if the limiter keys on
   the user, and before `validate(...)`.
4. Add tests to `tests/integration/rateLimit.integration.test.js`: one suite
   per tier, always covering under-limit, 429 envelope + headers, and
   **window reset**.
5. If the limiter keys on the user, document the key in the tier table above.

---

## 🏭 Production Notes

- **Horizontal scaling:** with more than one backend instance, in-memory
  counters diverge (each instance has its own budget). Swap in a Redis store
  in `rateLimiter.js` — it is the only file that changes:

  ```javascript
  const redisStore = new RedisStore({
    sendCommand: (...args) => redisClient.call(...args),
  });

  const globalLimiter = rateLimit({ ...commonOptions, store: redisStore });
  ```

- **Reverse proxy:** behind nginx/Render, set `app.set("trust proxy", 1)` in
  `app.js` or every client shares the proxy IP and the global limiter becomes
  a global kill switch. Never enable `trust proxy` on a directly exposed
  server (clients would spoof `X-Forwarded-For` and forge per-IP budgets).
- **Key generator and IPv6:** any custom `keyGenerator` that falls back to
  `req.ip` must wrap the IP with the library's `ipKeyGenerator()` helper (see
  `orderLimiter`) — otherwise IPv6 clients can rotate addresses to bypass
  limits, and the library will refuse to start once it detects the pattern.

---

## ⚠️ Common Mistakes

| Mistake | Why it breaks |
| --- | --- |
| Calling `rateLimit()` inside a route file | Two sources of truth; the Redis upgrade now touches N files |
| Mounting `orderLimiter` before `authMiddleware` | Per-user keying silently degrades to per-IP |
| Using `router.use(authLimiter)` on all of `/auth` | Burns the tight budget on `/me` and `/logout` |
| Sending 429 through the error handler | Every throttle logs as ERROR with a stack — noise during real attacks |
| Hard-coding limits "temporarily" | The env knobs exist so ops can tune without a deploy |
| Expecting limits to apply immediately after `.env` edit | Values are read once at startup; restart required |
| Trusting `req.ip` without configuring `trust proxy` behind a proxy | All clients share one budget |

---

## 🧪 Testing

`tests/integration/rateLimit.integration.test.js` covers all three tiers with
real HTTP through `src/app.js` — under-limit behavior, the 429 envelope and
headers, per-user keying, chain order (401 before 429), and **window reset**
for every tier.

Structure worth knowing before extending it:

- Each tier gets its own `describe` that builds a **fresh `src/app.js`** via
  `jest.isolateModules` with env-driven limits (`RATE_LIMIT_*` set before the
  require, short 1s windows, small limits). Fresh graphs mean fresh limiter
  stores — tiers never pollute each other's counters.
- `src/config/database` is mocked to a single shared Prisma client (created
  once at file top). Re-running `config/database.js` per graph spawns multiple
  Prisma engines in one process, which crashes with
  `The encoded data was not valid for encoding utf-8`.
- All other test suites run with `RATE_LIMIT_ENABLED=false` (set in
  `tests/setupEnv.js`, registered as a jest `setupFiles` entry in
  `package.json`) — otherwise the suites' repeated requests would self-429.
  New suites need no limiter awareness.
- Reset tests use real waits (`windowMs: 1000`, wait 1.4s), not fake timers —
  the in-memory store uses wall-clock timestamps and internal timers.

---

*Related: `docs/ERROR_HANDLING.md` (error envelope), `docs/SECURITY.md`
(security checklist and role model), `src/middleware/rateLimiter.js`
(single source of limiter configuration).*
