const axios = require("axios");
const { JWT } = require("google-auth-library");

const DEFAULT_FCM_BASE_URL = "https://fcm.googleapis.com/v1/projects";
const DEFAULT_TIMEOUT_MS = 5000;
const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";

/**
 * Resolve the FCM HTTP v1 configuration from the environment.
 *
 * A project id plus a service-account client email and private key are
 * required. Missing configuration makes the adapter an explicit no-op rather
 * than a startup failure, so email/in-app delivery keeps working in local
 * development and CI.
 */
function resolvePushConfig(env = process.env) {
  const timeoutMs = Number(env.FCM_REQUEST_TIMEOUT_MS);

  return {
    projectId: env.FCM_PROJECT_ID || null,
    clientEmail: env.FCM_CLIENT_EMAIL || null,
    // Environment files usually store newlines as the literal `\n`.
    privateKey: env.FCM_PRIVATE_KEY
      ? String(env.FCM_PRIVATE_KEY).replace(/\\n/g, "\n")
      : null,
    url: env.FCM_API_URL || null,
    timeoutMs:
      Number.isInteger(timeoutMs) && timeoutMs > 0
        ? timeoutMs
        : DEFAULT_TIMEOUT_MS,
  };
}

function isPushConfigured(env = process.env) {
  const config = resolvePushConfig(env);

  return Boolean(config.projectId && config.clientEmail && config.privateKey);
}

function isPermanentPushError(status) {
  return (
    typeof status === "number" &&
    status >= 400 &&
    status < 500 &&
    status !== 408 &&
    status !== 429
  );
}

/**
 * A bad service-account key or an unauthorized project will not recover on a
 * retry. Treat those as permanent so the notification budget is not spent on a
 * configuration error; network and 5xx failures stay retryable.
 */
function isPermanentAuthError(error) {
  const status = error?.response?.status;

  if (
    typeof status === "number" &&
    status >= 400 &&
    status < 500 &&
    status !== 408 &&
    status !== 429
  ) {
    return true;
  }

  return /invalid_grant|invalid_client|unauthorized|forbidden|permission|invalid key|decoder routines|pem|service account/i.test(
    String(error?.message || ""),
  );
}

async function getAccessToken(config, options = {}) {
  if (options.accessToken) {
    return options.accessToken;
  }

  const authClient =
    options.authClient ||
    new JWT({
      email: config.clientEmail,
      key: config.privateKey,
      scopes: [FCM_SCOPE],
    });

  let credentials;

  try {
    credentials = await authClient.authorize();
  } catch (error) {
    const wrapped = new Error(
      `Push authorization failed: ${error.message}`,
    );
    wrapped.permanent = isPermanentAuthError(error);
    wrapped.cause = error;

    throw wrapped;
  }

  if (!credentials?.access_token) {
    const error = new Error(
      "Push authorization failed: no access token returned.",
    );
    error.permanent = true;

    throw error;
  }

  return credentials.access_token;
}

function resolveSendUrl(config) {
  if (config.url) {
    return config.url;
  }

  return `${DEFAULT_FCM_BASE_URL}/${config.projectId}/messages:send`;
}

/**
 * Send one push message through FCM HTTP v1.
 *
 * FCM has no idempotency key, so duplicate suppression is the notification
 * worker's database claim. A transient failure is thrown so BullMQ retries;
 * a 4xx (other than 408/429) is marked permanent.
 */
async function sendPush(
  { token, title, body, data },
  options = {},
) {
  const config = options.config || resolvePushConfig();

  if (!config.projectId || !config.clientEmail || !config.privateKey) {
    return { delivered: false, skipped: true, reason: "NOT_CONFIGURED" };
  }

  if (!token) {
    return { delivered: false, skipped: true, reason: "NO_PUSH_TOKEN" };
  }

  const accessToken = await getAccessToken(config, options);
  const httpClient = options.httpClient || axios;

  try {
    const response = await httpClient.post(
      resolveSendUrl(config),
      {
        message: {
          token,
          notification: {
            title,
            body,
          },
          data: Object.fromEntries(
            Object.entries(data || {}).map(([key, value]) => [
              key,
              String(value),
            ]),
          ),
        },
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        timeout: config.timeoutMs,
      },
    );

    return {
      delivered: true,
      name: response?.data?.name ?? null,
    };
  } catch (error) {
    const status = error?.response?.status;
    const wrapped = new Error(`Push delivery failed: ${error.message}`);
    wrapped.permanent = isPermanentPushError(status);
    wrapped.statusCode = status ?? null;
    wrapped.cause = error;

    throw wrapped;
  }
}

module.exports = {
  DEFAULT_FCM_BASE_URL,
  DEFAULT_TIMEOUT_MS,
  isPermanentAuthError,
  isPushConfigured,
  resolvePushConfig,
  sendPush,
};
