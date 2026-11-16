const {
  isPermanentAuthError,
  isPushConfigured,
  resolvePushConfig,
  sendPush,
} = require("../../../src/services/pushService");

const CONFIG = {
  projectId: "stox-test",
  clientEmail: "firebase@stox-test.iam.gserviceaccount.com",
  privateKey: "-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----",
  url: null,
  timeoutMs: 5000,
};

function makeHttpClient(response = { data: { name: "projects/stox-test/messages/1" } }) {
  return { post: jest.fn(async () => response) };
}

function makeAuthClient(accessToken = "access-token") {
  return { authorize: jest.fn(async () => ({ access_token: accessToken })) };
}

describe("push service", () => {
  test("is an explicit no-op without FCM credentials", async () => {
    expect(isPushConfigured({})).toBe(false);

    const httpClient = makeHttpClient();
    const result = await sendPush(
      { token: "device-token", title: "Hi", body: "Body" },
      { config: resolvePushConfig({}), httpClient },
    );

    expect(result).toEqual({
      delivered: false,
      skipped: true,
      reason: "NOT_CONFIGURED",
    });
    expect(httpClient.post).not.toHaveBeenCalled();
  });

  test("skips a configured user without a push token", async () => {
    const httpClient = makeHttpClient();
    const result = await sendPush(
      { token: null, title: "Hi", body: "Body" },
      { config: CONFIG, httpClient, authClient: makeAuthClient() },
    );

    expect(result).toEqual({
      delivered: false,
      skipped: true,
      reason: "NO_PUSH_TOKEN",
    });
    expect(httpClient.post).not.toHaveBeenCalled();
  });

  test("posts an FCM HTTP v1 message with a bearer token", async () => {
    const httpClient = makeHttpClient();
    const authClient = makeAuthClient("token-123");

    const result = await sendPush(
      {
        token: "device-token",
        title: "Price alert",
        body: "AAPL crossed 200",
        data: { notificationId: "n1", type: "PRICE_ALERT" },
      },
      { config: CONFIG, httpClient, authClient },
    );

    expect(result).toEqual({
      delivered: true,
      name: "projects/stox-test/messages/1",
    });
    expect(httpClient.post).toHaveBeenCalledWith(
      "https://fcm.googleapis.com/v1/projects/stox-test/messages:send",
      {
        message: {
          token: "device-token",
          notification: {
            title: "Price alert",
            body: "AAPL crossed 200",
          },
          data: { notificationId: "n1", type: "PRICE_ALERT" },
        },
      },
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer token-123",
        }),
      }),
    );
  });

  test("marks an invalid token rejection as permanent", async () => {
    const httpClient = makeHttpClient();
    httpClient.post.mockRejectedValue({
      message: "invalid",
      response: { status: 404 },
    });

    await expect(
      sendPush(
        { token: "bad", title: "Hi", body: "Body" },
        { config: CONFIG, httpClient, authClient: makeAuthClient() },
      ),
    ).rejects.toMatchObject({ permanent: true, statusCode: 404 });
  });

  test("classifies auth failures as permanent and network failures as transient", async () => {
    expect(isPermanentAuthError({ response: { status: 401 } })).toBe(true);
    expect(isPermanentAuthError({ message: "invalid_grant" })).toBe(true);
    expect(
      isPermanentAuthError({
        message: "error:1E08010C:DECODER routines::unsupported",
      }),
    ).toBe(true);
    expect(isPermanentAuthError({ code: "ENOTFOUND" })).toBe(false);
    expect(isPermanentAuthError({ response: { status: 503 } })).toBe(false);
  });

  test("does not retry a bad service-account key", async () => {
    const httpClient = makeHttpClient();
    const authClient = {
      authorize: jest.fn(async () => {
        throw Object.assign(new Error("invalid_grant"), {
          response: { status: 401 },
        });
      }),
    };

    await expect(
      sendPush(
        { token: "device-token", title: "Hi", body: "Body" },
        { config: CONFIG, httpClient, authClient },
      ),
    ).rejects.toMatchObject({
      permanent: true,
      message: expect.stringContaining("Push authorization failed"),
    });
    expect(httpClient.post).not.toHaveBeenCalled();
  });

  test("treats a missing access token as a permanent configuration error", async () => {
    const httpClient = makeHttpClient();
    const authClient = { authorize: jest.fn(async () => ({})) };

    await expect(
      sendPush(
        { token: "device-token", title: "Hi", body: "Body" },
        { config: CONFIG, httpClient, authClient },
      ),
    ).rejects.toMatchObject({
      permanent: true,
      message: expect.stringContaining("no access token"),
    });
  });
});
