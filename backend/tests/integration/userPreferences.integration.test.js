const request = require("supertest");

const app = require("../../src/app");
const prisma = require("../../src/config/database");

// Black-box tests for the user preferences API (GET/PATCH /api/v1/preferences),
// exercised through the HTTP layer only.
// Contract invariants (docs/API.md + repo-wide conventions):
// - failures: { success: false, error: { code, message, details? } }
// - validation failures: 400 VALIDATION_ERROR, details = [{ path, message }]
// - identity before validity: missing auth is 401 even with a bad body
// - preferences are self-scoped and created lazily on first read
//
// Preferences are created lazily, so the "defaults" case must observe an
// account that has never read them. Cleanup relies on the user cascade
// (User -> UserPreference).
const timestamp = Date.now();

const validUser = {
  name: "Preference Test User",
  email: `preferences-${timestamp}@stox.local`,
  password: "TestPassword123!",
};

let userId;
let accessToken;

beforeAll(async () => {
  jest.setTimeout(30000);

  const registration = await request(app)
    .post("/api/v1/auth/register")
    .send(validUser);

  expect([200, 201]).toContain(registration.status);
  userId = registration.body.data.user.id;
  accessToken = registration.body.data.accessToken;
});

afterAll(async () => {
  if (userId) {
    await prisma.user.delete({ where: { id: userId } }).catch(() => {});
  }

  await prisma.$disconnect();
});

function expectErrorEnvelope(body) {
  expect(body).toHaveProperty("success", false);
  expect(typeof body.error?.code).toBe("string");
  expect(body.error.code.length).toBeGreaterThan(0);
}

function expectValidationDetails(body) {
  expect(body.error.code).toBe("VALIDATION_ERROR");
  expect(Array.isArray(body.error.details)).toBe(true);
  expect(body.error.details.length).toBeGreaterThan(0);
}

function pathsOf(body) {
  return body.error.details.map((issue) => issue.path);
}

function getPreferences(token = accessToken) {
  const request_ = request(app).get("/api/v1/preferences");

  if (token) {
    request_.set("Authorization", `Bearer ${token}`);
  }

  return request_;
}

function patchPreferences(body, token = accessToken) {
  const request_ = request(app).patch("/api/v1/preferences").send(body);

  if (token) {
    request_.set("Authorization", `Bearer ${token}`);
  }

  return request_;
}

describe("user preferences (black-box via /preferences)", () => {
  describe("authentication", () => {
    test("missing token is 401 even with a valid body", async () => {
      const response = await patchPreferences(
        { emailNotifications: false },
        null,
      );

      expect(response.status).toBe(401);
      expectErrorEnvelope(response.body);
    });

    test("GET without a token is 401", async () => {
      const response = await getPreferences(null);

      expect(response.status).toBe(401);
      expectErrorEnvelope(response.body);
    });
  });

  describe("GET /api/v1/preferences", () => {
    test("auto-creates default preferences on first read", async () => {
      const existing = await prisma.userPreference.findUnique({
        where: { userId },
      });

      expect(existing).toBeNull();

      const response = await getPreferences();

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);

      const preferences = response.body.data.preferences;

      expect(preferences.userId).toBe(userId);
      expect(preferences.emailNotifications).toBe(true);
      expect(preferences.pushNotifications).toBe(true);

      const saved = await prisma.userPreference.findUnique({
        where: { userId },
      });

      expect(saved).not.toBeNull();
      expect(saved.emailNotifications).toBe(true);
      expect(saved.pushNotifications).toBe(true);
    });

    test("returns existing preferences", async () => {
      await prisma.userPreference.update({
        where: { userId },
        data: { emailNotifications: false, pushNotifications: false },
      });

      const response = await getPreferences();

      expect(response.status).toBe(200);
      expect(response.body.data.preferences.emailNotifications).toBe(false);
      expect(response.body.data.preferences.pushNotifications).toBe(false);
    });

    test("never creates a second row for the same user", async () => {
      await getPreferences();
      await getPreferences();

      const count = await prisma.userPreference.count({ where: { userId } });

      expect(count).toBe(1);
    });
  });

  describe("PATCH /api/v1/preferences", () => {
    test("updates emailNotifications only", async () => {
      const response = await patchPreferences({ emailNotifications: true });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);

      const preferences = response.body.data.preferences;

      expect(preferences.emailNotifications).toBe(true);
      // The field that was not sent keeps its previous value.
      expect(preferences.pushNotifications).toBe(false);
    });

    test("updates pushNotifications only", async () => {
      const response = await patchPreferences({ pushNotifications: true });

      expect(response.status).toBe(200);
      expect(response.body.data.preferences.pushNotifications).toBe(true);
      expect(response.body.data.preferences.emailNotifications).toBe(true);
    });

    test("updates both fields", async () => {
      const response = await patchPreferences({
        emailNotifications: false,
        pushNotifications: false,
      });

      expect(response.status).toBe(200);
      expect(response.body.data.preferences.emailNotifications).toBe(false);
      expect(response.body.data.preferences.pushNotifications).toBe(false);

      const saved = await prisma.userPreference.findUnique({
        where: { userId },
      });

      expect(saved.emailNotifications).toBe(false);
      expect(saved.pushNotifications).toBe(false);
    });

    test("creates preferences on PATCH when none exist yet", async () => {
      // Start from a clean slate for this account.
      await prisma.userPreference.deleteMany({ where: { userId } });

      const response = await patchPreferences({ pushNotifications: false });

      expect(response.status).toBe(200);
      expect(response.body.data.preferences.pushNotifications).toBe(false);
      // Defaults still apply to the field that was not sent.
      expect(response.body.data.preferences.emailNotifications).toBe(true);
    });
  });

  describe("validation", () => {
    test("rejects an invalid emailNotifications type", async () => {
      const response = await patchPreferences({ emailNotifications: "yes" });

      expect(response.status).toBe(400);
      expectValidationDetails(response.body);
      expect(pathsOf(response.body)).toContain("emailNotifications");
    });

    test("rejects an invalid pushNotifications type", async () => {
      const response = await patchPreferences({ pushNotifications: 1 });

      expect(response.status).toBe(400);
      expectValidationDetails(response.body);
      expect(pathsOf(response.body)).toContain("pushNotifications");
    });

    test("rejects unknown fields", async () => {
      const response = await patchPreferences({ theme: "dark" });

      expect(response.status).toBe(400);
      expectValidationDetails(response.body);
    });

    test("rejects a mix of known and unknown fields", async () => {
      const response = await patchPreferences({
        emailNotifications: false,
        role: "ADMIN",
      });

      expect(response.status).toBe(400);
      expectValidationDetails(response.body);

      // The rejected request must not have changed anything.
      const saved = await prisma.userPreference.findUnique({
        where: { userId },
      });

      expect(saved.emailNotifications).toBe(true);
      expect(saved.role).toBeUndefined();
    });
  });
});
