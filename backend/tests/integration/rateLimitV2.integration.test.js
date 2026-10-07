/**
 * BLACK-BOX rate limiter audit — rateLimitV2.
 *
 * Unlike rateLimit.integration.test.js (in-process supertest), this suite
 * treats the rate limiter as an opaque box: it boots the REAL server as a
 * child process per phase and hits it with raw HTTP, then MEASURES the
 * limits empirically instead of asserting presets.
 *
 * Verified contract (docs/SECURITY.md "Rate Limiting"):
 * - three tiers: global 100/15min per-IP, auth 10/15min per-IP on
 *   login/register/refresh, orders 30/1min per-USER
 * - every 429 uses the standard envelope with code RATE_LIMITED
 * - every 429 exposes draft-8 RateLimit-* headers
 * - window reset, spoof-resistant keying, and the env kill switch
 *
 * Each phase runs its own server process, so limiter stores are always
 * fresh and tier configs never bleed into each other. Requires no test
 * fixtures: DB rows created here are cleaned up in afterAll.
 */
const { spawn } = require("child_process");
const net = require("net");
const path = require("path");

const BACKEND = path.join(__dirname, "../..");
const PW = "TestPassword123!";
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const uniqueEmail = (label) =>
  `blackbox-${label}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}@stox.local`;

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}

// Boots a real server child process and polls a path OUTSIDE /api for
// readiness, so the probe never consumes rate-limit budget under audit.
async function startServer(env = {}) {
  const port = await getFreePort();
  const child = spawn("node", [path.join(BACKEND, "src/server.js")], {
    cwd: BACKEND,
    // setupEnv.js sets RATE_LIMIT_ENABLED=false in the Jest process; children
    // must default the kill switch back ON unless a phase overrides it
    env: { ...process.env, RATE_LIMIT_ENABLED: "true", PORT: String(port), ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (out += d));
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 60; i += 1) {
    try {
      await fetch(`${base}/`);
      return { child, base, out: () => out };
    } catch {
      await wait(200);
    }
  }
  child.kill("SIGKILL");
  throw new Error(`server never became ready\n${out.slice(-2000)}`);
}

async function stopServer(server) {
  server.child.kill("SIGKILL");
  await wait(200);
}

async function request(base, method, path, { token, body, headers } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    // non-JSON response body is fine for our purposes
  }
  return { status: res.status, json, h: res.headers };
}

const is429Envelope = (r) =>
  r.status === 429 &&
  r.json?.success === false &&
  r.json?.error?.code === "RATE_LIMITED" &&
  typeof r.json?.error?.message === "string";

const hasDraft8Headers = (r, expectedLimit) =>
  r.h.get("ratelimit-limit") === String(expectedLimit) &&
  r.h.get("ratelimit-remaining") === "0" &&
  r.h.get("ratelimit-reset") !== null &&
  !Number.isNaN(Number(r.h.get("ratelimit-reset")));

async function registerUser(base, label) {
  const r = await request(base, "POST", "/api/v1/auth/register", {
    body: { name: "Blackbox", email: uniqueEmail(label), password: PW },
  });
  if (r.status !== 201) {
    throw new Error(`register failed: ${r.status} ${JSON.stringify(r.json)}`);
  }
  return r.json.data;
}

async function createPortfolio(base, token) {
  const r = await request(base, "POST", "/api/v1/portfolios", {
    token,
    body: { name: `bb-${Math.random().toString(36).slice(2, 8)}` },
  });
  if (r.status !== 201) {
    throw new Error(`portfolio failed: ${r.status} ${JSON.stringify(r.json)}`);
  }
  return r.json.data.portfolio.id;
}

const badLogin = (base, headers) =>
  request(base, "POST", "/api/v1/auth/login", {
    body: { email: "ghost@stox.local", password: "WrongPass123!" },
    headers,
  });

const placeOrder = (base, token, portfolioId) =>
  request(base, "POST", "/api/v1/orders", {
    token,
    body: {
      portfolioId,
      symbol: "AAPL",
      assetType: "STOCK",
      side: "BUY",
      quantity: 1,
    },
  });

// Counts requests until the first 429 (empirical measurement) and returns
// { fired } — the 1-based index at which the 429 appeared.
async function measureUntil429(makeRequest, maxAttempts) {
  for (let i = 1; i <= maxAttempts; i += 1) {
    const r = await makeRequest(i);
    if (r.status === 429) return { fired: i, last: r };
  }
  return { fired: -1, last: null };
}

// ---------------------------------------------------------------------------
// PHASE 1: auth tier at production defaults
// ---------------------------------------------------------------------------

describe("rateLimitV2: auth tier (production defaults, black-box)", () => {
  let server;

  beforeAll(async () => {
    server = await startServer();
  }, 30000);

  afterAll(async () => {
    await stopServer(server);
  });

  test(
    "measured limit: 10 failed logins pass, the 11th is rejected",
    async () => {
      const { fired, last } = await measureUntil429(
        () => badLogin(server.base),
        30,
      );
      expect(fired).toBe(11);
      expect(last.status).toBe(429);
      expect(last.json.success).toBe(false);
    },
    30000,
  );

  test("429 uses the standard envelope with code RATE_LIMITED", async () => {
    const r = await badLogin(server.base);
    expect(r.json.success).toBe(false);
    expect(r.json.error.code).toBe("RATE_LIMITED");
    expect(typeof r.json.error.message).toBe("string");
  });

  test("429 exposes draft-8 RateLimit-* headers", async () => {
    const r = await badLogin(server.base);
    expect(hasDraft8Headers(r, 10)).toBe(true);
  });

  test("budget is shared across login and register", async () => {
    const r = await request(server.base, "POST", "/api/v1/auth/register", {
      body: { name: "B", email: uniqueEmail("shared"), password: PW },
    });
    expect(r.status).toBe(429);
    expect(r.json.error.code).toBe("RATE_LIMITED");
  });

  test("tier isolation: /auth/me is NOT blocked by auth-tier exhaustion", async () => {
    const r = await request(server.base, "GET", "/api/v1/auth/me");
    expect(r.status).toBe(401);
    expect(r.json.error.code).toBe("UNAUTHORIZED");
  });
});

// ---------------------------------------------------------------------------
// PHASE 2: order tier + per-user keying at production defaults
// ---------------------------------------------------------------------------

describe("rateLimitV2: order tier + per-user keying (production defaults)", () => {
  let server;
  let userA;
  let portfolioA;
  let userB;
  let portfolioB;

  beforeAll(async () => {
    server = await startServer();
    userA = await registerUser(server.base, "order-a");
    portfolioA = await createPortfolio(server.base, userA.accessToken);
    userB = await registerUser(server.base, "order-b");
    portfolioB = await createPortfolio(server.base, userB.accessToken);
  }, 30000);

  afterAll(async () => {
    await stopServer(server);
  });

  test(
    "measured per-user limit: 30 orders pass, the 31st is rejected",
    async () => {
      // user A has a fresh 30-order budget here; this test is the phase's
      // first order traffic, so the count starts from zero
      const first = await placeOrder(server.base, userA.accessToken, portfolioA);
      expect(first.status).toBe(201);
      expect(first.h.get("ratelimit-remaining")).toBe("29");

      let attempts = 1;
      let last = first;
      while (attempts < 40 && last.status !== 429) {
        attempts += 1;
        last = await placeOrder(server.base, userA.accessToken, portfolioA);
      }
      expect(attempts).toBe(31); // 30 passed, the 31st rejected
      expect(last.status).toBe(429);
      expect(last.json.error.code).toBe("RATE_LIMITED");
      expect(hasDraft8Headers(last, 30)).toBe(true);
    },
    30000,
  );

  test("user B is unaffected while user A is blocked (per-USER keying)", async () => {
    const r = await placeOrder(server.base, userB.accessToken, portfolioB);
    expect(r.status).toBe(201);
  });

  test("unauthenticated orders are rejected by auth before the limiter", async () => {
    const r = await request(server.base, "POST", "/api/v1/orders", {
      body: {
        portfolioId: portfolioA,
        symbol: "AAPL",
        assetType: "STOCK",
        side: "BUY",
        quantity: 1,
      },
    });
    expect(r.status).toBe(401);
    expect(r.json.error.code).toBe("UNAUTHORIZED");
  });
});

// ---------------------------------------------------------------------------
// PHASE 3: global tier at production defaults
// ---------------------------------------------------------------------------

describe("rateLimitV2: global tier (production defaults, black-box)", () => {
  let server;

  beforeAll(async () => {
    server = await startServer();
  }, 30000);

  afterAll(async () => {
    await stopServer(server);
  });

  test(
    "measured limit: 100 requests pass, the 101st is rejected",
    async () => {
      const { fired } = await measureUntil429(
        () => request(server.base, "GET", "/api/v1/health"),
        150,
      );
      expect(fired).toBe(101);
    },
    30000,
  );

  test("429 envelope + draft-8 headers on the global tier", async () => {
    const r = await request(server.base, "GET", "/api/v1/health");
    expect(is429Envelope(r)).toBe(true);
    expect(hasDraft8Headers(r, 100)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// PHASE 4: window reset, spoofing, fixed-window rollover (1000ms windows)
// ---------------------------------------------------------------------------

describe("rateLimitV2: global window reset (1000ms)", () => {
  let server;

  beforeAll(async () => {
    server = await startServer({
      RATE_LIMIT_WINDOW_MS: "1000",
      RATE_LIMIT_GLOBAL_MAX: "5",
      RATE_LIMIT_AUTH_MAX: "1000",
      RATE_LIMIT_ORDER_MAX: "1000",
    });
  }, 30000);

  afterAll(async () => {
    await stopServer(server);
  });

  test("limiter blocks at the limit, then resets once the window elapses", async () => {
    for (let i = 0; i < 5; i += 1) {
      const r = await request(server.base, "GET", "/api/v1/health");
      expect(r.status).toBe(200);
    }
    const blocked = await request(server.base, "GET", "/api/v1/health");
    expect(blocked.status).toBe(429);

    await wait(1400);
    const after = await request(server.base, "GET", "/api/v1/health");
    expect(after.status).toBe(200);
  }, 30000);
});

describe("rateLimitV2: spoof resistance + auth window reset (1000ms)", () => {
  let server;

  beforeAll(async () => {
    server = await startServer({
      RATE_LIMIT_WINDOW_MS: "1000",
      RATE_LIMIT_AUTH_MAX: "3",
      RATE_LIMIT_GLOBAL_MAX: "1000",
      RATE_LIMIT_ORDER_MAX: "1000",
    });
  }, 30000);

  afterAll(async () => {
    await stopServer(server);
  });

  test("X-Forwarded-For spoofing does NOT evade the per-IP budget", async () => {
    await badLogin(server.base, { "x-forwarded-for": "1.1.1.1" });
    await badLogin(server.base, { "x-forwarded-for": "2.2.2.2" });
    const third = await badLogin(server.base, { "x-forwarded-for": "3.3.3.3" });
    const fourth = await badLogin(server.base, {
      "x-forwarded-for": "4.4.4.4",
    });
    // trust proxy is off: every spoofed header shares ONE per-IP budget
    expect(third.status).toBe(401);
    expect(fourth.status).toBe(429);
  });

  test("auth budget resets once the window elapses", async () => {
    await wait(1400);
    const r = await badLogin(server.base);
    expect(r.status).toBe(401);
  }, 30000);
});

describe("rateLimitV2: fixed-window rollover semantics (1000ms)", () => {
  let server;
  let userA;
  let portfolioA;
  let userB;
  let portfolioB;

  beforeAll(async () => {
    server = await startServer({
      RATE_LIMIT_WINDOW_MS: "1000",
      RATE_LIMIT_ORDER_WINDOW_MS: "1000",
      RATE_LIMIT_ORDER_MAX: "2",
      RATE_LIMIT_AUTH_MAX: "1000",
      RATE_LIMIT_GLOBAL_MAX: "1000",
    });
    userA = await registerUser(server.base, "roll-a");
    portfolioA = await createPortfolio(server.base, userA.accessToken);
    userB = await registerUser(server.base, "roll-b");
    portfolioB = await createPortfolio(server.base, userB.accessToken);
  }, 30000);

  afterAll(async () => {
    await stopServer(server);
  });

  test("a burst over the limit is rejected", async () => {
    expect(
      (await placeOrder(server.base, userA.accessToken, portfolioA)).status,
    ).toBe(201);
    expect(
      (await placeOrder(server.base, userA.accessToken, portfolioA)).status,
    ).toBe(201);
    expect(
      (await placeOrder(server.base, userA.accessToken, portfolioA)).status,
    ).toBe(429);
  });

  test(
    "requests SPANNING the window do not trip the limiter (rollover)",
    async () => {
      // Fixed-window contract: each window counts independently. Requests
      // spread across a window boundary belong to different windows, so a
      // slow burst can legitimately pass. This documents the mechanism that
      // makes timing-sensitive assertions on small windows flaky.
      const t1 = await placeOrder(server.base, userB.accessToken, portfolioB);
      await wait(600);
      const t2 = await placeOrder(server.base, userB.accessToken, portfolioB);
      await wait(700);
      const t3 = await placeOrder(server.base, userB.accessToken, portfolioB);
      expect(t1.status).toBe(201);
      expect(t2.status).toBe(201);
      expect(t3.status).toBe(201);
    },
    30000,
  );
});

// ---------------------------------------------------------------------------
// PHASE 5: kill switch
// ---------------------------------------------------------------------------

describe("rateLimitV2: RATE_LIMIT_ENABLED=false kill switch", () => {
  let server;

  beforeAll(async () => {
    server = await startServer({
      RATE_LIMIT_ENABLED: "false",
      RATE_LIMIT_WINDOW_MS: "1000",
      RATE_LIMIT_GLOBAL_MAX: "3",
      RATE_LIMIT_AUTH_MAX: "2",
      RATE_LIMIT_ORDER_MAX: "1",
    });
  }, 30000);

  afterAll(async () => {
    await stopServer(server);
  });

  test("no 429 anywhere while limiting is disabled", async () => {
    for (let i = 0; i < 10; i += 1) {
      const r = await request(server.base, "GET", "/api/v1/health");
      expect(r.status).toBe(200);
    }
    const login = await badLogin(server.base);
    expect(login.status).toBe(401);
  }, 30000);
});

// ---------------------------------------------------------------------------
// cleanup: remove every DB row this suite created
// ---------------------------------------------------------------------------

afterAll(async () => {
  const prisma = require("../../src/config/database");
  await prisma.user.deleteMany({
    where: { email: { startsWith: "blackbox-" } },
  });
  await prisma.$disconnect();
}, 30000);
