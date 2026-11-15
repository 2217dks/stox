const request = require("supertest");

const app = require("../../src/app");
const prisma = require("../../src/config/database");

afterAll(async () => {
  await prisma.$disconnect();
});

describe("GET /metrics", () => {
  beforeAll(async () => {
    // Generate at least one known series before scraping.
    await request(app).get("/api/v1/health");
    await request(app).get("/api/v1/definitely-not-a-route");
  });

  test("is publicly scrapeable by default", async () => {
    const response = await request(app).get("/metrics");

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("text/plain");
    expect(response.headers["content-type"]).toContain("version=0.0.4");
  });

  test("exposes the documented HTTP request metrics", async () => {
    const response = await request(app).get("/metrics");
    const body = response.text;

    expect(body).toContain("# TYPE http_requests_total counter");
    expect(body).toContain("# TYPE http_request_duration_seconds histogram");
    expect(body).toContain("# TYPE http_requests_in_flight gauge");
  });

  test("uses low-cardinality route labels instead of raw URLs", async () => {
    const response = await request(app).get("/metrics");
    const body = response.text;

    expect(body).toContain('route="/api/v1/health"');
    expect(body).toContain('route="unmatched"');
    // The raw unmatched URL must never become a label value.
    expect(body).not.toContain("/api/v1/definitely-not-a-route");
  });

  test("exposes process-level runtime gauges", async () => {
    const response = await request(app).get("/metrics");

    expect(response.text).toContain("process_uptime_seconds");
    expect(response.text).toContain("nodejs_heap_used_bytes");
  });

  test("does not expose credentials or user data", async () => {
    const response = await request(app).get("/metrics");

    expect(response.text).not.toMatch(/password/i);
    expect(response.text).not.toMatch(/authorization/i);
    expect(response.text).not.toMatch(/@stox\.local/);
  });
});
