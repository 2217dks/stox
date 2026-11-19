// Integration suites make many repeated requests to the same endpoints and
// would trip the rate limiters (which share one in-memory store per test
// file). Disable limiting for every suite; the dedicated rate-limit suite
// re-enables it per describe block via buildApp().
process.env.RATE_LIMIT_ENABLED = "false";

// Queue enqueueing is best-effort, but tests should not open Redis connections
// for every order they create. Queue-specific suites set QUEUES_ENABLED=true
// explicitly and use a unique QUEUE_PREFIX.
process.env.QUEUES_ENABLED = "false";

// authService refuses to start without this. Google ID tokens are only audience
// checked when a client id is configured, so a missing value is a fail-open bug.
// Test-only value; never a real credential.
process.env.GOOGLE_CLIENT_ID =
  process.env.GOOGLE_CLIENT_ID || "test-client-id.apps.googleusercontent.com";
