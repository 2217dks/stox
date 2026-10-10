const request = require("supertest");

const app = require("../../src/app");
const prisma = require("../../src/config/database");

const timestamp = Date.now();

const user1 = {
  name: "Notification Integration User 1",
  email: `notification-integration-1-${timestamp}@example.com`,
  password: "IntegrationTest#2026",
};

const user2 = {
  name: "Notification Integration User 2",
  email: `notification-integration-2-${timestamp}@example.com`,
  password: "IntegrationTest#2026",
};

let user1Id;
let user2Id;

let user1AccessToken;
let user2AccessToken;

let unreadNotificationId;
let readNotificationId;

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

  const unread = await prisma.notification.create({
    data: {
      userId: user1Id,
      type: "ORDER_EXECUTED",
      title: "Order executed",
      message: "Your AAPL order executed.",
      data: { symbol: "AAPL" },
    },
  });

  const read = await prisma.notification.create({
    data: {
      userId: user1Id,
      type: "SYSTEM",
      title: "Welcome",
      message: "Welcome to Stox.",
      isRead: true,
      readAt: new Date(),
    },
  });

  unreadNotificationId = unread.id;
  readNotificationId = read.id;
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

describe("Notification integration API", () => {
  test("rejects unauthenticated notification requests", async () => {
    const response = await request(app).get("/api/v1/notifications");

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("UNAUTHORIZED");
  });

  test("lists only the caller's notifications with pagination", async () => {
    const response = await request(app)
      .get("/api/v1/notifications")
      .set("Authorization", `Bearer ${user1AccessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);

    const { notifications, pagination } = response.body.data;

    expect(notifications).toHaveLength(2);
    expect(pagination.total).toBe(2);

    for (const notification of notifications) {
      expect(notification.userId).toBe(user1Id);
    }

    const otherUser = await request(app)
      .get("/api/v1/notifications")
      .set("Authorization", `Bearer ${user2AccessToken}`);

    expect(otherUser.body.data.notifications).toHaveLength(0);
  });

  test("filters notifications by read state", async () => {
    const response = await request(app)
      .get("/api/v1/notifications?isRead=false")
      .set("Authorization", `Bearer ${user1AccessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.data.notifications).toHaveLength(1);
    expect(response.body.data.notifications[0].id).toBe(unreadNotificationId);
  });

  test("marks a notification as read and populates readAt", async () => {
    const response = await request(app)
      .patch(`/api/v1/notifications/${unreadNotificationId}/read`)
      .set("Authorization", `Bearer ${user1AccessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);

    const notification = response.body.data.notification;

    expect(notification.isRead).toBe(true);
    expect(notification.readAt).not.toBeNull();
  });

  test("prevents a user from reading another user's notification", async () => {
    const response = await request(app)
      .patch(`/api/v1/notifications/${readNotificationId}/read`)
      .set("Authorization", `Bearer ${user2AccessToken}`);

    expect(response.status).toBe(404);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("NOTIFICATION_NOT_FOUND");
  });

  test("rejects an invalid notification id", async () => {
    const response = await request(app)
      .patch("/api/v1/notifications/not-a-uuid/read")
      .set("Authorization", `Bearer ${user1AccessToken}`);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  test("marks all notifications as read", async () => {
    const response = await request(app)
      .patch("/api/v1/notifications/read-all")
      .set("Authorization", `Bearer ${user1AccessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.updated).toBeGreaterThanOrEqual(0);

    const unread = await prisma.notification.count({
      where: {
        userId: user1Id,
        isRead: false,
      },
    });

    expect(unread).toBe(0);
  });
});
