const http = require("http");
const request = require("supertest");

const app = require("../../src/app");
const prisma = require("../../src/config/database");
const { createInMemoryEventBus } = require("../../src/realtime/eventBus");
const {
  startRealtimeBridge,
  validateMessage,
} = require("../../src/realtime/realtimeBridge");
const { createSocketServer } = require("../../src/sockets");
const {
  collectEvents,
  connectSocket,
  listen,
  waitForEvent,
} = require("../helpers/realtime");

const timestamp = Date.now();

function notificationPayload(notificationId, userId) {
  return {
    notificationId,
    userId,
    type: "ORDER_EXECUTED",
    title: "Order executed",
    message: "BUY 1 AAPL executed at 200.",
    data: { symbol: "AAPL" },
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

async function registerUser(label) {
  const response = await request(app)
    .post("/api/v1/auth/register")
    .send({
      name: `Notifications Namespace ${label}`,
      email: `notifications-namespace-${label}-${timestamp}@stox.local`,
      password: "TestPassword123!",
    });

  return {
    userId: response.body.data.user.id,
    accessToken: response.body.data.accessToken,
  };
}

describe("/notifications namespace", () => {
  let server;
  let io;
  let marketRooms;
  let baseUrl;
  let bus;
  let bridge;
  let userA;
  let userB;

  const priceStream = {
    subscribe: jest.fn(),
    unsubscribe: jest.fn(),
    stop: jest.fn(),
  };

  beforeAll(async () => {
    jest.setTimeout(30000);

    server = http.createServer(app);
    ({ io, marketRooms } = createSocketServer(server, {
      marketPriceStream: priceStream,
    }));

    baseUrl = `http://127.0.0.1:${await listen(server)}`;

    bus = createInMemoryEventBus();
    bridge = startRealtimeBridge({ io, bus });
    await bridge.ready;

    userA = await registerUser("a");
    userB = await registerUser("b");
  });

  afterAll(async () => {
    bridge.stop();
    marketRooms.stop();

    await prisma.user.deleteMany({
      where: { id: { in: [userA?.userId, userB?.userId].filter(Boolean) } },
    });

    await new Promise((resolve) => io.close(resolve));
    await prisma.$disconnect();
  });

  test("requires a valid access token", async () => {
    await expect(connectSocket(baseUrl, "/notifications")).rejects.toMatchObject(
      {
        data: { code: "UNAUTHORIZED" },
      },
    );

    await expect(
      connectSocket(baseUrl, "/notifications", {
        auth: { token: "not-a-jwt" },
      }),
    ).rejects.toMatchObject({
      data: { code: "INVALID_ACCESS_TOKEN" },
    });
  });

  test("delivers a notification only to the target user's room", async () => {
    const clientA = await connectSocket(baseUrl, "/notifications", {
      auth: { token: userA.accessToken },
    });
    const clientB = await connectSocket(baseUrl, "/notifications", {
      auth: { token: userB.accessToken },
    });

    const payload = notificationPayload("notification-a", userA.userId);
    const received = waitForEvent(clientA, "notification");
    const notReceived = collectEvents(clientB, "notification", 250);

    await bus.publish({
      namespace: "/notifications",
      room: `user:${userA.userId}`,
      event: "notification",
      payload,
    });

    await expect(received).resolves.toEqual(payload);
    expect(await notReceived).toEqual([]);

    clientA.close();
    clientB.close();
  });

  test("rejects a room that does not match the payload user", async () => {
    const clientA = await connectSocket(baseUrl, "/notifications", {
      auth: { token: userA.accessToken },
    });

    const ignored = collectEvents(clientA, "notification", 250);

    await bus.publish({
      namespace: "/notifications",
      room: `user:${userB.userId}`,
      event: "notification",
      payload: notificationPayload("notification-mismatch", userA.userId),
    });

    expect(await ignored).toEqual([]);

    clientA.close();
  });

  test("validates the notification contract", () => {
    const valid = validateMessage({
      namespace: "/notifications",
      room: `user:${userA.userId}`,
      event: "notification",
      payload: notificationPayload("notification-1", userA.userId),
    });

    expect(valid).toMatchObject({ ok: true });

    const cases = [
      {
        room: `user:${userA.userId}`,
        payload: { ...notificationPayload("n", userA.userId), notificationId: "" },
        reason: "notification requires a notificationId.",
      },
      {
        room: `user:${userA.userId}`,
        payload: { ...notificationPayload("n", userA.userId), userId: "" },
        reason: "notification requires a userId.",
      },
      {
        room: `user:${userA.userId}`,
        payload: { ...notificationPayload("n", userA.userId), type: "" },
        reason: "notification requires a type.",
      },
      {
        room: `user:${userA.userId}`,
        payload: { ...notificationPayload("n", userA.userId), title: "" },
        reason: "notification requires a title.",
      },
      {
        room: `user:${userA.userId}`,
        payload: { ...notificationPayload("n", userA.userId), message: null },
        reason: "notification requires a message.",
      },
      {
        room: `user:${userB.userId}`,
        payload: notificationPayload("n", userA.userId),
        reason: "notification room user ID must match payload.userId.",
      },
      {
        room: "portfolio:not-a-user-room",
        payload: notificationPayload("n", userA.userId),
        reason: 'room must start with "user:".',
      },
    ];

    for (const { room, payload, reason } of cases) {
      expect(
        validateMessage({
          namespace: "/notifications",
          room,
          event: "notification",
          payload,
        }),
      ).toEqual({ ok: false, reason });
    }
  });
});
