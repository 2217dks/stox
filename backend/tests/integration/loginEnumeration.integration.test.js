const request = require("supertest");

const app = require("../../src/app");
const prisma = require("../../src/config/database");

const timestamp = Date.now();
const password = "TestPassword123!";

let suspendedUserId;

beforeAll(() => {
  jest.setTimeout(30000);
});

afterAll(async () => {
  if (suspendedUserId) {
    await prisma.user.delete({ where: { id: suspendedUserId } });
  }

  await prisma.$disconnect();
});

describe("login does not reveal account state", () => {
  test("a suspended account with a wrong password looks like invalid credentials", async () => {
    const email = `suspended-${timestamp}@stox.local`;

    const registration = await request(app)
      .post("/api/v1/auth/register")
      .send({ name: "Suspended User", email, password });

    expect(registration.status).toBe(201);
    suspendedUserId = registration.body.data.user.id;

    await prisma.user.update({
      where: { id: suspendedUserId },
      data: { isSuspended: true },
    });

    const wrongPassword = await request(app)
      .post("/api/v1/auth/login")
      .send({ email, password: "WrongPassword123!" });

    expect(wrongPassword.status).toBe(401);
    expect(wrongPassword.body.error.code).toBe("INVALID_CREDENTIALS");

    const unknownEmail = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: `nobody-${timestamp}@stox.local`, password });

    expect(unknownEmail.status).toBe(401);
    expect(unknownEmail.body.error.code).toBe("INVALID_CREDENTIALS");
  });

  test("a suspended account with the correct password is told it is suspended", async () => {
    const email = `suspended-ok-${timestamp}@stox.local`;

    const registration = await request(app)
      .post("/api/v1/auth/register")
      .send({ name: "Suspended User Two", email, password });

    expect(registration.status).toBe(201);

    const userId = registration.body.data.user.id;

    try {
      await prisma.user.update({
        where: { id: userId },
        data: { isSuspended: true },
      });

      const response = await request(app)
        .post("/api/v1/auth/login")
        .send({ email, password });

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe("ACCOUNT_SUSPENDED");
    } finally {
      await prisma.user.delete({ where: { id: userId } });
    }
  });
});
