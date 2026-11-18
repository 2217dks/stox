const axios = require("axios");

const { mapProviderError } = require("./marketDataErrors");
const logger = require("../utils/logger");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfter(headers) {
  if (!headers || typeof headers !== "object") return null;

  const raw = headers["retry-after"] ?? headers["Retry-After"];
  if (raw === undefined || raw === null || raw === "") return null;

  const numericSeconds = Number(raw);
  if (Number.isFinite(numericSeconds) && numericSeconds >= 0) {
    return Math.round(numericSeconds * 1000);
  }

  const parsedDate = new Date(raw);
  const diffMs = parsedDate.getTime() - Date.now();
  if (Number.isFinite(diffMs) && diffMs > 0) {
    return Math.round(diffMs);
  }

  return null;
}

function isTransientError(error) {
  if (!error) return false;

  const status = error.response?.status;
  const providerCode = error.response?.data?.code;
  const providerMessage =
    error.response?.data?.error || error.response?.data?.msg || error.message;

  // Never retry permanent client/symbol errors
  if (
    status === 400 ||
    status === 404 ||
    status === 422 ||
    String(providerCode) === "-1121" ||
    /no data|not found|invalid (?:trading )?symbol|unknown symbol|unsupported symbol/i.test(
      String(providerMessage || ""),
    )
  ) {
    return false;
  }

  // Never retry permanent credential errors
  if (
    (status === 401 || status === 403) &&
    !/rate.?limit|too many requests|banned/i.test(String(providerMessage || ""))
  ) {
    return false;
  }

  // Transient rate limit / throttling
  if (
    status === 429 ||
    status === 418 ||
    (status === 403 &&
      /rate.?limit|too many requests|banned/i.test(String(providerMessage || "")))
  ) {
    return true;
  }

  // Transient timeout
  if (
    status === 408 ||
    status === 504 ||
    error.code === "ECONNABORTED" ||
    error.code === "ETIMEDOUT" ||
    error.code === "ESOCKETTIMEDOUT" ||
    error.code === "ERR_SOCKET_TIMEOUT" ||
    error.name === "TimeoutError" ||
    /timeout|timed out/i.test(String(providerMessage || ""))
  ) {
    return true;
  }

  // Transient server errors
  if (status >= 500 && status <= 599) {
    return true;
  }

  // Transient network disruptions
  if (
    error.code === "ECONNRESET" ||
    error.code === "ECONNREFUSED" ||
    error.code === "EPIPE" ||
    error.code === "EAI_AGAIN" ||
    error.code === "ENOTFOUND"
  ) {
    return true;
  }

  return false;
}

function calculateBackoffDelay(
  attempt,
  {
    baseDelayMs = 200,
    maxDelayMs = 2000,
    jitter = true,
    retryAfterMs = null,
  } = {},
) {
  if (typeof retryAfterMs === "number" && retryAfterMs > 0) {
    return Math.min(maxDelayMs, retryAfterMs);
  }

  const exponential = baseDelayMs * Math.pow(2, attempt);
  const capped = Math.min(maxDelayMs, exponential);

  if (!jitter) {
    return capped;
  }

  // Full jitter: random duration between 0 and capped backoff delay
  return Math.floor(Math.random() * capped);
}

function createHttpClient({ baseURL, timeoutMs, headers = {} }) {
  return axios.create({
    baseURL,
    timeout: timeoutMs,
    headers,
  });
}

async function getData(client, path, params, options = {}) {
  const isTest = process.env.NODE_ENV === "test";
  const maxRetries = options.retries !== undefined ? options.retries : 2;
  const baseDelayMs =
    options.baseDelayMs ?? (isTest ? 10 : 200);
  const maxDelayMs =
    options.maxDelayMs ?? (isTest ? 50 : 2000);
  const jitter = options.jitter ?? (isTest ? false : true);
  const sleepFn = options.sleep ?? sleep;

  let attempt = 0;
  while (true) {
    try {
      const response = await client.get(path, { params });
      return response?.data;
    } catch (error) {
      const canRetry = attempt < maxRetries && isTransientError(error);

      if (!canRetry) {
        throw mapProviderError(error);
      }

      const retryAfterMs = parseRetryAfter(error.response?.headers);
      const delayMs = calculateBackoffDelay(attempt, {
        baseDelayMs,
        maxDelayMs,
        jitter,
        retryAfterMs,
      });

      if (logger && typeof logger.warn === "function") {
        logger.warn(
          `Market data transient failure on ${path}; retrying attempt ${attempt + 1}/${maxRetries} after ${delayMs}ms.`,
          {
            path,
            attempt: attempt + 1,
            maxRetries,
            delayMs,
            status: error.response?.status,
            errorCode: error.code,
          },
        );
      }

      attempt += 1;
      await sleepFn(delayMs);
    }
  }
}

function isFiniteDecimal(value) {
  if (typeof value !== "number" && typeof value !== "string") return false;
  if (typeof value === "string" && value.trim() === "") return false;
  return Number.isFinite(Number(value));
}

function decimalString(value, { nullable = false } = {}) {
  if (nullable && (value === null || value === undefined)) return null;
  if (!isFiniteDecimal(value)) return undefined;
  return String(value);
}

function isoTimestamp(value, { unit = "milliseconds" } = {}) {
  if (value === undefined || value === null || value === "") return null;
  const numeric = Number(value);
  const date = new Date(unit === "seconds" ? numeric * 1000 : numeric);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function invalidProviderResponse() {
  const { createMarketDataError } = require("./marketDataErrors");
  return createMarketDataError(
    "Market data provider returned an invalid response.",
    502,
    "MARKET_DATA_INVALID_RESPONSE",
  );
}

function assertObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw invalidProviderResponse();
  }
  return value;
}

module.exports = {
  createHttpClient,
  getData,
  decimalString,
  isoTimestamp,
  invalidProviderResponse,
  assertObject,
  isTransientError,
  parseRetryAfter,
  calculateBackoffDelay,
  sleep,
};
