// Integration suites make many repeated requests to the same endpoints and
// would trip the rate limiters (which share one in-memory store per test
// file). Disable limiting for every suite; the dedicated rate-limit suite
// re-enables it per describe block via buildApp().
process.env.RATE_LIMIT_ENABLED = "false";
