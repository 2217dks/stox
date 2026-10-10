const request = require("supertest");

const app = require("../../src/app");
const prisma = require("../../src/config/database");

const timestamp = Date.now();

const user1 = {
  name: "Alert Integration User 1",
  email: `alert-integration-1-${timestamp}@example.com`,
  password: "IntegrationTest#2026",
};

const user2 = {
  name: "Alert Integration User 2",
  email: `alert-integration-2-${timestamp}@example.com`,
  password: "IntegrationTest#2026",
};

let user1Id;
let user2Id;

let user1AccessToken;
let user2AccessToken;

beforeAll(async () => {
  jest.setTimeout(15000);

  const registration1 = await request(app)
    .post("/api/v1/auth/register")
    .send(user1);

  expect([200, 201]).toContain(registration1.status);
  user1Id = registration1.body.data.user.id;
  user1AccessToken = registration1.body.data.accessToken;

  const registration2 = await request(app)
    .post("/api/v1/auth/register")
    .send(user2);

  expect([200, 201]).toContain(registration2.status);
  user2Id = registration2.body.data.user.id;
  user2AccessToken = registration2.body.data.accessToken;
});

afterAll(async () => {
  await prisma.user.deleteMany({
    where: {
      id: {
        in: [user1Id, user2Id].filter(Boolean),
      },
    },
  });

  await prisma.$disconnect();
});

describe("Alert integration API", () => {
  let alertId;

  test("rejects unauthenticated alert requests", async () => {
    const response = await request(app).get("/api/v1/alerts");

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("UNAUTHORIZED");
  });

  test("creates an alert through the API", async () => {
    const response = await request(app)
      .post("/api/v1/alerts")
      .set("Authorization", `Bearer ${user1AccessToken}`)
      .send({
        symbol: "aapl",
        assetType: "STOCK",
        condition: "PRICE_ABOVE",
        targetPrice: "250.5",
      });

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);

    const alert = response.body.data.alert;

    expect(alert).toBeDefined();
    expect(alert.userId).toBe(user1Id);
    expect(alert.symbol).toBe("AAPL");
    expect(alert.assetType).toBe("STOCK");
    expect(alert.condition).toBe("PRICE_ABOVE");
    expect(alert.targetPrice).toBe("250.5");
    expect(alert.status).toBe("ACTIVE");
    expect(alert.sendEmail).toBe(true);
    expect(alert.sendPush).toBe(false);

    alertId = alert.id;

    const saved = await prisma.alert.findUnique({ where: { id: alertId } });

    expect(saved).not.toBeNull();
    expect(saved.userId).toBe(user1Id);
  });

  test("rejects invalid alert payloads", async () => {
    const response = await request(app)
      .post("/api/v1/alerts")
      .set("Authorization", `Bearer ${user1AccessToken}`)
      .send({
        symbol: "",
        condition: "NOT_A_CONDITION",
        targetPrice: "0",
      });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  test("lists only the caller's alerts", async () => {
    const response = await request(app)
      .get("/api/v1/alerts")
      .set("Authorization", `Bearer ${user1AccessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);

    const { alerts, pagination } = response.body.data;

    expect(Array.isArray(alerts)).toBe(true);
    expect(pagination.page).toBe(1);
    expect(pagination.limit).toBe(20);
    expect(alerts.some((alert) => alert.id === alertId)).toBe(true);

    for (const alert of alerts) {
      expect(alert.userId).toBe(user1Id);
    }

    const otherUser = await request(app)
      .get("/api/v1/alerts")
      .set("Authorization", `Bearer ${user2AccessToken}`);

    expect(otherUser.body.data.alerts).toHaveLength(0);
  });

  test("filters alerts by status", async () => {
    const response = await request(app)
      .get("/api/v1/alerts?status=ACTIVE")
      .set("Authorization", `Bearer ${user1AccessToken}`);

    expect(response.status).toBe(200);

    for (const alert of response.body.data.alerts) {
      expect(alert.status).toBe("ACTIVE");
    }
  });

  test("updates an alert and triggers it", async () => {
    const response = await request(app)
      .patch(`/api/v1/alerts/${alertId}`)
      .set("Authorization", `Bearer ${user1AccessToken}`)
      .send({
        status: "TRIGGERED",
        targetPrice: "300",
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);

    const alert = response.body.data.alert;

    expect(alert.status).toBe("TRIGGERED");
    expect(alert.targetPrice).toBe("300");
    expect(alert.triggeredAt).not.toBeNull();
  });

  test("rejects an empty alert update", async () => {
    const response = await request(app)
      .patch(`/api/v1/alerts/${alertId}`)
      .set("Authorization", `Bearer ${user1AccessToken}`)
      .send({});

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  test("prevents a user from updating another user's alert", async () => {
    const response = await request(app)
      .patch(`/api/v1/alerts/${alertId}`)
      .set("Authorization", `Bearer ${user2AccessToken}`)
      .send({ status: "CANCELLED" });

    expect(response.status).toBe(404);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("ALERT_NOT_FOUND");
  });

  test("rejects an invalid alert id", async () => {
    const response = await request(app)
      .delete("/api/v1/alerts/not-a-uuid")
      .set("Authorization", `Bearer ${user1AccessToken}`);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  test("deletes an alert", async () => {
    const response = await request(app)
      .delete(`/api/v1/alerts/${alertId}`)
      .set("Authorization", `Bearer ${user1AccessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.id).toBe(alertId);

    const saved = await prisma.alert.findUnique({ where: { id: alertId } });

    expect(saved).toBeNull();
  });
});
