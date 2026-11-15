const request = require("supertest");

const app = require("../../src/app");
const prisma = require("../../src/config/database");

afterAll(async () => {
  await prisma.$disconnect();
});

describe("security headers", () => {
  test("hardened headers are present on a normal API response", async () => {
    const response = await request(app).get("/api/v1/health");

    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["referrer-policy"]).toBe("no-referrer");
    expect(response.headers["x-frame-options"]).toBe("SAMEORIGIN");
    expect(response.headers["strict-transport-security"]).toContain(
      "max-age=",
    );
    expect(response.headers["content-security-policy"]).toContain(
      "frame-ancestors 'none'",
    );
  });

  test("express is not advertised", async () => {
    const response = await request(app).get("/api/v1/health");

    expect(response.headers["x-powered-by"]).toBeUndefined();
  });

  test("headers are applied to error responses too", async () => {
    const response = await request(app).get("/api/v1/definitely-not-a-route");

    expect(response.status).toBe(404);
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["x-frame-options"]).toBe("SAMEORIGIN");
  });

  test("CORS preflight still succeeds with the frontend origin", async () => {
    const response = await request(app)
      .options("/api/v1/auth/login")
      .set("Origin", "http://localhost:3000")
      .set("Access-Control-Request-Method", "POST");

    expect(response.status).toBe(204);
    expect(response.headers["access-control-allow-origin"]).toBe(
      "http://localhost:3000",
    );
    expect(response.headers["access-control-allow-credentials"]).toBe("true");
  });

  test("cross-origin resource policy allows the separate frontend origin", async () => {
    const response = await request(app).get("/api/v1/health");

    expect(response.headers["cross-origin-resource-policy"]).toBe(
      "cross-origin",
    );
  });
});
