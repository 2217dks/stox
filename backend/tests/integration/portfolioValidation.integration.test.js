const request = require("supertest");

const app = require("../../src/app");
const prisma = require("../../src/config/database");

const timestamp = Date.now();
const email = `portfolio-validation-${timestamp}@stox.local`;

let userId;
let accessToken;

beforeAll(async () => {
  jest.setTimeout(30000);

  const registration = await request(app)
    .post("/api/v1/auth/register")
    .send({ name: "Portfolio Validation User", email, password: "TestPassword123!" });

  expect(registration.status).toBe(201);

  userId = registration.body.data.user.id;
  accessToken = registration.body.data.accessToken;
});

afterAll(async () => {
  if (userId) {
    await prisma.user.delete({ where: { id: userId } });
  }

  await prisma.$disconnect();
});

describe("POST /portfolios input validation", () => {
  test("rejects a non-string name with 400 instead of 500", async () => {
    const response = await request(app)
      .post("/api/v1/portfolios")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ name: 123 });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  test("rejects a non-string description with 400 instead of 500", async () => {
    const response = await request(app)
      .post("/api/v1/portfolios")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ name: "Long-term", description: {} });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  test("still creates a portfolio with a valid body", async () => {
    const response = await request(app)
      .post("/api/v1/portfolios")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ name: `Valid ${timestamp}`, description: "Swing trades" });

    expect(response.status).toBe(201);
    expect(response.body.data.portfolio.name).toBe(`Valid ${timestamp}`);
  });
});
