const axios = require("axios");

const DEFAULT_RESEND_URL = "https://api.resend.com/emails";
const DEFAULT_TIMEOUT_MS = 5000;

/**
 * Resolve the Resend configuration from the environment.
 *
 * Both an API key and a verified sender are required before email delivery is
 * attempted. With either missing the adapter is an explicit no-op, which keeps
 * local development and CI free of invented credentials.
 */
function resolveEmailConfig(env = process.env) {
  const timeoutMs = Number(env.EMAIL_REQUEST_TIMEOUT_MS);

  return {
    apiKey: env.RESEND_API_KEY || null,
    from: env.EMAIL_FROM || null,
    url: env.RESEND_API_URL || DEFAULT_RESEND_URL,
    timeoutMs:
      Number.isInteger(timeoutMs) && timeoutMs > 0
        ? timeoutMs
        : DEFAULT_TIMEOUT_MS,
  };
}

function isEmailConfigured(env = process.env) {
  const config = resolveEmailConfig(env);

  return Boolean(config.apiKey && config.from);
}

function isPermanentEmailError(status) {
  return (
    typeof status === "number" &&
    status >= 400 &&
    status < 500 &&
    status !== 408 &&
    status !== 429
  );
}

/**
 * Send one email through Resend.
 *
 * `idempotencyKey` is forwarded so a retried BullMQ job cannot send the same
 * message twice while Resend still remembers the key. The caller (the
 * notification worker) also guards delivery in the database.
 */
async function sendEmail(
  { to, subject, html, text, idempotencyKey },
  options = {},
) {
  const config = options.config || resolveEmailConfig();

  if (!config.apiKey || !config.from) {
    return { delivered: false, skipped: true, reason: "NOT_CONFIGURED" };
  }

  if (!to) {
    return { delivered: false, skipped: true, reason: "NO_RECIPIENT" };
  }

  const httpClient = options.httpClient || axios;
  const headers = {
    Authorization: `Bearer ${config.apiKey}`,
    "Content-Type": "application/json",
  };

  if (idempotencyKey) {
    headers["Idempotency-Key"] = idempotencyKey;
  }

  try {
    const response = await httpClient.post(
      config.url,
      {
        from: config.from,
        to,
        subject,
        html,
        ...(text ? { text } : {}),
      },
      {
        headers,
        timeout: config.timeoutMs,
      },
    );

    return {
      delivered: true,
      id: response?.data?.id ?? null,
    };
  } catch (error) {
    const status = error?.response?.status;
    const wrapped = new Error(`Email delivery failed: ${error.message}`);
    wrapped.permanent = isPermanentEmailError(status);
    wrapped.statusCode = status ?? null;
    wrapped.cause = error;

    throw wrapped;
  }
}

module.exports = {
  DEFAULT_RESEND_URL,
  DEFAULT_TIMEOUT_MS,
  isEmailConfigured,
  resolveEmailConfig,
  sendEmail,
};
