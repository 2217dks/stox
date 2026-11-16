const {
  isEmailConfigured,
  resolveEmailConfig,
  sendEmail,
} = require("../../../src/services/emailService");

function makeHttpClient(response = { data: { id: "email-1" } }) {
  return { post: jest.fn(async () => response) };
}

describe("email service", () => {
  test("is an explicit no-op without an API key and sender", async () => {
    expect(isEmailConfigured({})).toBe(false);

    const httpClient = makeHttpClient();
    const result = await sendEmail(
      { to: "user@example.com", subject: "Hi", html: "<p>Hi</p>" },
      { config: resolveEmailConfig({}), httpClient },
    );

    expect(result).toEqual({
      delivered: false,
      skipped: true,
      reason: "NOT_CONFIGURED",
    });
    expect(httpClient.post).not.toHaveBeenCalled();
  });

  test("posts to Resend with an idempotency key", async () => {
    const config = resolveEmailConfig({
      RESEND_API_KEY: "re_test",
      EMAIL_FROM: "stox <alerts@stox.local>",
    });
    const httpClient = makeHttpClient();

    const result = await sendEmail(
      {
        to: "user@example.com",
        subject: "Order executed",
        html: "<p>Done</p>",
        text: "Done",
        idempotencyKey: "notification-1:email",
      },
      { config, httpClient },
    );

    expect(result).toEqual({ delivered: true, id: "email-1" });
    expect(httpClient.post).toHaveBeenCalledWith(
      "https://api.resend.com/emails",
      {
        from: "stox <alerts@stox.local>",
        to: "user@example.com",
        subject: "Order executed",
        html: "<p>Done</p>",
        text: "Done",
      },
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer re_test",
          "Idempotency-Key": "notification-1:email",
        }),
      }),
    );
  });

  test("marks a 4xx rejection as permanent and a 5xx as retryable", async () => {
    const config = resolveEmailConfig({
      RESEND_API_KEY: "re_test",
      EMAIL_FROM: "stox <alerts@stox.local>",
    });

    const badRequest = makeHttpClient();
    badRequest.post.mockRejectedValue({ message: "bad", response: { status: 422 } });

    await expect(
      sendEmail(
        { to: "user@example.com", subject: "Hi", html: "<p>Hi</p>" },
        { config, httpClient: badRequest },
      ),
    ).rejects.toMatchObject({ permanent: true, statusCode: 422 });

    const serverError = makeHttpClient();
    serverError.post.mockRejectedValue({ message: "down", response: { status: 503 } });

    await expect(
      sendEmail(
        { to: "user@example.com", subject: "Hi", html: "<p>Hi</p>" },
        { config, httpClient: serverError },
      ),
    ).rejects.toMatchObject({ permanent: false, statusCode: 503 });
  });
});
