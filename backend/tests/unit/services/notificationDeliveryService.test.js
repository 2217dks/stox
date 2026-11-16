jest.mock("../../../src/realtime/eventBus", () => ({
  emitRealtimeEvent: jest.fn(async () => true),
}));

const {
  deliverNotification,
  resolveChannels,
  serializeNotificationEvent,
} = require("../../../src/services/notificationDeliveryService");

const NOTIFICATION_ID = "6f1f7c2e-0d7f-4c2a-9b8f-2f9a1d0c3b4e";
const USER_ID = "3f1b2c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";

function makeNotification(overrides = {}) {
  return {
    id: NOTIFICATION_ID,
    userId: USER_ID,
    type: "ORDER_EXECUTED",
    title: "Order executed",
    message: "BUY 1 AAPL executed at 200.",
    data: { symbol: "AAPL" },
    deliveryChannels: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

function makeUser(overrides = {}) {
  return {
    id: USER_ID,
    email: "user@example.com",
    emailAlerts: true,
    pushEnabled: true,
    pushToken: "device-token",
    ...overrides,
  };
}

function makeEmail(result = { delivered: true }) {
  return { sendEmail: jest.fn(async () => result) };
}

function makePush(result = { delivered: true }) {
  return { sendPush: jest.fn(async () => result) };
}

describe("notification delivery service", () => {
  test("delivers in-app, email, and push when every switch is on", async () => {
    const email = makeEmail();
    const push = makePush();
    const emit = jest.fn(async () => true);

    const result = await deliverNotification(makeNotification(), {
      user: makeUser(),
      preference: { emailNotifications: true, pushNotifications: true },
      email,
      push,
      emit,
    });

    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        namespace: "/notifications",
        room: `user:${USER_ID}`,
        event: "notification",
      }),
    );
    expect(email.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "user@example.com",
        idempotencyKey: `${NOTIFICATION_ID}:email`,
      }),
    );
    expect(push.sendPush).toHaveBeenCalledWith(
      expect.objectContaining({ token: "device-token" }),
    );
    expect(result).toEqual({
      outcome: "delivered",
      reason: undefined,
      channels: {
        inApp: "delivered",
        email: "delivered",
        push: "delivered",
      },
    });
  });

  test("narrows delivery using the alert-level send flags", async () => {
    const email = makeEmail();
    const push = makePush();

    const result = await deliverNotification(
      makeNotification({
        type: "PRICE_ALERT",
        data: { channels: { email: false, push: true } },
      }),
      {
        user: makeUser(),
        preference: { emailNotifications: true, pushNotifications: true },
        email,
        push,
        emit: jest.fn(async () => true),
      },
    );

    expect(email.sendEmail).not.toHaveBeenCalled();
    expect(push.sendPush).toHaveBeenCalledTimes(1);
    expect(result.channels).toEqual({
      inApp: "delivered",
      push: "delivered",
    });
  });

  test("skips email and push when both user preferences are off", async () => {
    const email = makeEmail();
    const push = makePush();

    const result = await deliverNotification(makeNotification(), {
      user: makeUser(),
      preference: { emailNotifications: false, pushNotifications: false },
      email,
      push,
      emit: jest.fn(async () => true),
    });

    expect(email.sendEmail).not.toHaveBeenCalled();
    expect(push.sendPush).not.toHaveBeenCalled();
    // The in-app row already exists and the live hint was emitted.
    expect(result).toEqual({
      outcome: "delivered",
      reason: undefined,
      channels: { inApp: "delivered" },
    });
  });

  test("reports PREFERENCES_OFF when no channel can deliver", async () => {
    const result = await deliverNotification(makeNotification(), {
      user: makeUser(),
      preference: { emailNotifications: false, pushNotifications: false },
      email: makeEmail(),
      push: makePush(),
      emit: jest.fn(async () => {
        throw new Error("namespace unavailable");
      }),
    });

    expect(result).toEqual({
      outcome: "skipped",
      reason: "PREFERENCES_OFF",
      channels: { inApp: "failed" },
    });
  });

  test("throws with partial channel results when one provider fails", async () => {
    const email = makeEmail();
    email.sendEmail.mockRejectedValue(
      Object.assign(new Error("email down"), { permanent: false }),
    );
    const push = makePush();

    await expect(
      deliverNotification(makeNotification(), {
        user: makeUser(),
        preference: { emailNotifications: true, pushNotifications: true },
        email,
        push,
        emit: jest.fn(async () => true),
      }),
    ).rejects.toMatchObject({
      permanent: false,
      channels: {
        inApp: "delivered",
        email: "failed",
        push: "delivered",
      },
    });
  });

  test("completes when one channel permanently fails but another delivers", async () => {
    const email = makeEmail();
    email.sendEmail.mockRejectedValue(
      Object.assign(new Error("bad recipient"), { permanent: true }),
    );
    const push = makePush();

    const result = await deliverNotification(makeNotification(), {
      user: makeUser(),
      preference: { emailNotifications: true, pushNotifications: true },
      email,
      push,
      emit: jest.fn(async () => true),
    });

    expect(result).toMatchObject({
      outcome: "delivered",
      channels: {
        inApp: "delivered",
        email: "failed",
        push: "delivered",
      },
      failedChannels: ["email"],
    });
  });

  test("throws a permanent failure when no channel delivered", async () => {
    const email = makeEmail();
    email.sendEmail.mockRejectedValue(
      Object.assign(new Error("bad recipient"), { permanent: true }),
    );

    await expect(
      deliverNotification(makeNotification(), {
        user: makeUser(),
        preference: { emailNotifications: true, pushNotifications: false },
        email,
        push: makePush(),
        emit: jest.fn(async () => false),
      }),
    ).rejects.toMatchObject({
      permanent: true,
      channels: {
        inApp: "unavailable",
        email: "failed",
      },
    });
  });

  test("does not repeat a channel already delivered on a retry", async () => {
    const email = makeEmail();
    const push = makePush();

    await deliverNotification(
      makeNotification({
        deliveryChannels: { inApp: "delivered", email: "delivered" },
      }),
      {
        user: makeUser(),
        preference: { emailNotifications: true, pushNotifications: true },
        email,
        push,
        emit: jest.fn(async () => true),
      },
    );

    expect(email.sendEmail).not.toHaveBeenCalled();
    expect(push.sendPush).toHaveBeenCalledTimes(1);
  });

  test("retries a channel that failed on a previous attempt", async () => {
    const email = makeEmail();
    const push = makePush();

    const result = await deliverNotification(
      makeNotification({
        deliveryChannels: { inApp: "delivered", email: "failed" },
      }),
      {
        user: makeUser(),
        preference: { emailNotifications: true, pushNotifications: true },
        email,
        push,
        emit: jest.fn(async () => true),
      },
    );

    expect(email.sendEmail).toHaveBeenCalledTimes(1);
    expect(push.sendPush).toHaveBeenCalledTimes(1);
    expect(result.channels).toEqual({
      inApp: "delivered",
      email: "delivered",
      push: "delivered",
    });
  });

  test("resolveChannels respects legacy user flags and destinations", () => {
    expect(
      resolveChannels(makeNotification(), makeUser({ emailAlerts: false }), {
        emailNotifications: true,
        pushNotifications: true,
      }),
    ).toEqual({ email: false, push: true });

    expect(
      resolveChannels(makeNotification(), makeUser({ pushEnabled: false }), {
        emailNotifications: true,
        pushNotifications: true,
      }),
    ).toEqual({ email: true, push: false });

    expect(
      resolveChannels(makeNotification(), makeUser({ pushToken: null }), {
        emailNotifications: true,
        pushNotifications: true,
      }),
    ).toEqual({ email: true, push: false });
  });

  test("serializes a stable socket payload", () => {
    expect(serializeNotificationEvent(makeNotification())).toEqual({
      notificationId: NOTIFICATION_ID,
      userId: USER_ID,
      type: "ORDER_EXECUTED",
      title: "Order executed",
      message: "BUY 1 AAPL executed at 200.",
      data: { symbol: "AAPL" },
      createdAt: "2026-01-01T00:00:00.000Z",
    });
  });
});
