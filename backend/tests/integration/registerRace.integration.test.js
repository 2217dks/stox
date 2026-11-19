const request = require("supertest");

const app = require("../../src/app");
const prisma = require("../../src/config/database");

const timestamp = Date.now();
const email = `register-race-${timestamp}@stox.local`;

let createdUserId;

beforeAll(() => {
  jest.setTimeout(30000);
});

afterAll(async () => {
  jest.restoreAllMocks();

  if (createdUserId) {
    await prisma.user.delete({ where: { id: createdUserId } });
  }

  await prisma.$disconnect();
});

describe("concurrent registration", () => {
  test("two registrations for the same email return 201 and 409, never 500", async () => {
    // Hold the first duplicate check until the second one has also run, so both
    // requests reach the insert and the unique index decides the winner.
    const originalFindUnique = prisma.user.findUnique.bind(prisma.user);
    let releaseFirstRead;
    const firstReadGate = new Promise((resolve) => {
      releaseFirstRead = resolve;
    });
    let reads = 0;

    jest.spyOn(prisma.user, "findUnique").mockImplementation(async (args) => {
      const result = await originalFindUnique(args);
      reads += 1;

      if (reads === 1) {
        await firstReadGate;
      } else if (reads === 2) {
        releaseFirstRead();
      }

      return result;
    });

    const payload = {
      name: "Register Race User",
      email,
      password: "TestPassword123!",
    };

    const [first, second] = await Promise.all([
      request(app).post("/api/v1/auth/register").send(payload),
      request(app).post("/api/v1/auth/register").send(payload),
    ]);

    const statuses = [first.status, second.status].sort();

    expect(statuses).toEqual([201, 409]);

    const conflict = [first, second].find((response) => response.status === 409);

    expect(conflict.body.error.code).toBe("EMAIL_ALREADY_EXISTS");

    const winner = [first, second].find((response) => response.status === 201);
    createdUserId = winner.body.data.user.id;
  });
});
