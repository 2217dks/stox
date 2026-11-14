const request = require("supertest");

const app = require("../../src/app");
const prisma = require("../../src/config/database");

afterAll(async () => {
  await prisma.$disconnect();
});

function expectErrorEnvelope(body) {
  expect(body).toHaveProperty("success", false);
  expect(typeof body.error?.code).toBe("string");
  expect(typeof body.error?.message).toBe("string");
}

describe("request payload size limits", () => {
  test("a body above the limit is rejected with a 413 envelope", async () => {
    const response = await request(app)
      .post("/api/v1/auth/register")
      .send({
        name: "a".repeat(120 * 1024),
        email: "payload-limit@stox.local",
        password: "ValidPassword123!",
      });

    expect(response.status).toBe(413);
    expectErrorEnvelope(response.body);
    expect(response.body.error.code).toBe("PAYLOAD_TOO_LARGE");
  });

  test("the 413 message does not leak parser internals", async () => {
    const response = await request(app)
      .post("/api/v1/auth/register")
      .send({
        name: "a".repeat(120 * 1024),
        email: "payload-limit@stox.local",
        password: "ValidPassword123!",
      });

    expect(response.body.error.message).not.toMatch(/limit.*bytes/i);
    expect(response.body.error.message).not.toContain("node_modules");
  });

  test("a body under the limit still reaches validation normally", async () => {
    const response = await request(app)
      .post("/api/v1/auth/register")
      .send({
        name: "a".repeat(500),
        email: "not-an-email",
        password: "x",
      });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  test("malformed JSON is a 400 INVALID_JSON, not a 500", async () => {
    const response = await request(app)
      .post("/api/v1/auth/register")
      .set("Content-Type", "application/json")
      .send('{"name": "unterminated"');

    expect(response.status).toBe(400);
    expectErrorEnvelope(response.body);
    expect(response.body.error.code).toBe("INVALID_JSON");
  });

  test("an empty JSON body is still a validation failure, not a parse failure", async () => {
    const response = await request(app)
      .post("/api/v1/auth/register")
      .set("Content-Type", "application/json")
      .send("");

    expect(response.status).toBe(400);
    expectErrorEnvelope(response.body);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  test("the limit applies before authentication so oversized bodies cost nothing", async () => {
    const response = await request(app)
      .post("/api/v1/orders")
      .set("Authorization", "Bearer not-a-real-token")
      .send({ quantity: "1".repeat(120 * 1024) });

    expect(response.status).toBe(413);
    expect(response.body.error.code).toBe("PAYLOAD_TOO_LARGE");
  });
});
