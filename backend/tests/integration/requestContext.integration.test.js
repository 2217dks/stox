const request = require("supertest");

const app = require("../../src/app");
const prisma = require("../../src/config/database");

afterAll(async () => {
  await prisma.$disconnect();
});

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe("request correlation id", () => {
  test("every response carries an X-Request-Id header", async () => {
    const response = await request(app).get("/api/v1/definitely-not-a-route");

    expect(response.status).toBe(404);
    expect(response.headers["x-request-id"]).toMatch(UUID_V4);
  });

  test("an inbound X-Request-Id is echoed so upstream traces stay connected", async () => {
    const inbound = "req-12345678-abcd";

    const response = await request(app)
      .get("/api/v1/definitely-not-a-route")
      .set("X-Request-Id", inbound);

    expect(response.headers["x-request-id"]).toBe(inbound);
  });

  test("a malformed inbound X-Request-Id is replaced, never reflected verbatim", async () => {
    const response = await request(app)
      .get("/api/v1/definitely-not-a-route")
      .set("X-Request-Id", "bad id with spaces <script>");

    expect(response.headers["x-request-id"]).toMatch(UUID_V4);
  });

  test("an over-long inbound X-Request-Id is replaced", async () => {
    const response = await request(app)
      .get("/api/v1/definitely-not-a-route")
      .set("X-Request-Id", "a".repeat(500));

    expect(response.headers["x-request-id"]).toMatch(UUID_V4);
  });

  test("the id is exposed to browser clients through CORS", async () => {
    const response = await request(app)
      .get("/api/v1/definitely-not-a-route")
      .set("Origin", "http://localhost:3000");

    const exposed = String(
      response.headers["access-control-expose-headers"] || "",
    ).toLowerCase();

    expect(exposed).toContain("x-request-id");
  });

  test("a different id is generated per request", async () => {
    const first = await request(app).get("/api/v1/definitely-not-a-route");
    const second = await request(app).get("/api/v1/definitely-not-a-route");

    expect(first.headers["x-request-id"]).not.toBe(
      second.headers["x-request-id"],
    );
  });
});
