const request = require("supertest");

const app = require("../../src/app");
const prisma = require("../../src/config/database");

const timestamp = Date.now();
const email = `refresh-race-${timestamp}@stox.local`;

let userId;

beforeAll(() => {
  jest.setTimeout(30000);
});

afterAll(async () => {
  jest.restoreAllMocks();

  if (userId) {
    await prisma.user.delete({ where: { id: userId } });
  }

  await prisma.$disconnect();
});

describe("refresh token rotation under concurrency", () => {
  test("exactly one of two parallel refreshes succeeds", async () => {
    const registration = await request(app)
      .post("/api/v1/auth/register")
      .send({
        name: "Refresh Race User",
        email,
        password: "TestPassword123!",
      });

    expect(registration.status).toBe(201);
    userId = registration.body.data.user.id;

    const refreshToken = registration.body.data.refreshToken;

    // Hold the first token read until the second one has also read the row, so
    // both requests pass the revokedAt check before either transaction commits.
    // Without this barrier the requests usually serialize and the race hides.
    const originalFindUnique = prisma.refreshToken.findUnique.bind(
      prisma.refreshToken,
    );
    let releaseFirstRead;
    const firstReadGate = new Promise((resolve) => {
      releaseFirstRead = resolve;
    });
    let reads = 0;

    jest
      .spyOn(prisma.refreshToken, "findUnique")
      .mockImplementation(async (args) => {
        const result = await originalFindUnique(args);
        reads += 1;

        if (reads === 1) {
          await firstReadGate;
        } else {
          releaseFirstRead();
        }

        return result;
      });

    const [first, second] = await Promise.all([
      request(app).post("/api/v1/auth/refresh").send({ refreshToken }),
      request(app).post("/api/v1/auth/refresh").send({ refreshToken }),
    ]);

    const statuses = [first.status, second.status].sort();

    expect(statuses).toEqual([200, 401]);
  });
});
