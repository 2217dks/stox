import {
  getAccessToken,
  getRefreshToken,
  refreshSession,
} from "./auth";
import { toQueryString } from "./utils";

const DEFAULT_API_URL = "http://localhost:8000/api/v1";

export class ApiError extends Error {
  constructor(message, { status = 0, code = "UNKNOWN_ERROR", details, requestId } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
    this.requestId = requestId;
  }

  get isNetworkError() {
    return this.status === 0;
  }

  get isRateLimited() {
    return this.status === 429;
  }
}

export function apiUrl(path = "") {
  const base = process.env.NEXT_PUBLIC_API_URL || DEFAULT_API_URL;
  return `${base.replace(/\/$/, "")}${path}`;
}

const AUTH_PATHS_WITHOUT_REFRESH = [
  "/auth/login",
  "/auth/register",
  "/auth/google",
  "/auth/refresh",
];

function isAuthPath(path) {
  return AUTH_PATHS_WITHOUT_REFRESH.some((entry) => path.startsWith(entry));
}

/**
 * Low-level JSON request. Returns the `data` field of the standard envelope,
 * throws ApiError for every non-2xx response, and transparently refreshes an
 * expired access token once.
 */
export async function apiFetch(
  path,
  {
    method = "GET",
    body,
    query,
    headers: extraHeaders,
    signal,
    skipAuthRefresh = false,
    timeout = 20000,
  } = {},
) {
  const url = `${apiUrl(path)}${toQueryString(query)}`;

  const run = async () => {
    const headers = new Headers(extraHeaders || {});
    headers.set("Accept", "application/json");

    const isFormData =
      typeof FormData !== "undefined" && body instanceof FormData;

    if (body !== undefined && !isFormData) {
      headers.set("Content-Type", "application/json");
    }

    const token = getAccessToken();
    if (token) headers.set("Authorization", `Bearer ${token}`);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    const abortFromCaller = () => controller.abort();

    if (signal) {
      if (signal.aborted) controller.abort();
      else signal.addEventListener("abort", abortFromCaller, { once: true });
    }

    try {
      const response = await fetch(url, {
        method,
        headers,
        body:
          body === undefined
            ? undefined
            : isFormData
              ? body
              : JSON.stringify(body),
        signal: controller.signal,
        cache: "no-store",
      });

      return response;
    } finally {
      clearTimeout(timeoutId);
      if (signal) signal.removeEventListener("abort", abortFromCaller);
    }
  };

  let response;

  try {
    response = await run();
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new ApiError("The request took too long. Try again.", {
        code: "REQUEST_TIMEOUT",
      });
    }
    throw new ApiError(
      "Cannot reach the Stox API. Check that the backend is running.",
      { code: "NETWORK_ERROR" },
    );
  }

  if (
    response.status === 401 &&
    !skipAuthRefresh &&
    !isAuthPath(path) &&
    getRefreshToken()
  ) {
    const refreshed = await refreshSession();

    if (refreshed) {
      response = await run().catch((error) => {
        if (error?.name === "AbortError") {
          throw new ApiError("The request took too long. Try again.", {
            code: "REQUEST_TIMEOUT",
          });
        }
        throw new ApiError("Cannot reach the Stox API.", {
          code: "NETWORK_ERROR",
        });
      });
    }
  }

  if (response.status === 204) return null;

  const text = await response.text();
  let payload = null;

  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const error = payload?.error;
    throw new ApiError(
      error?.message ||
        (response.status === 429
          ? "Too many requests. Wait a moment and try again."
          : `Request failed with status ${response.status}.`),
      {
        status: response.status,
        code: error?.code || `HTTP_${response.status}`,
        details: error?.details,
        requestId: response.headers.get("X-Request-Id") || undefined,
      },
    );
  }

  return payload?.data ?? payload;
}

export const get = (path, options = {}) => apiFetch(path, options);
export const post = (path, body, options = {}) =>
  apiFetch(path, { ...options, method: "POST", body });
export const patch = (path, body, options = {}) =>
  apiFetch(path, { ...options, method: "PATCH", body });
export const del = (path, options = {}) =>
  apiFetch(path, { ...options, method: "DELETE" });

/** Human-friendly message for a caught error. */
export function errorMessage(error, fallback = "Something went wrong.") {
  if (error instanceof ApiError) return error.message;
  if (error?.message) return error.message;
  return fallback;
}
