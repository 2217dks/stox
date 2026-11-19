const ACCESS_TOKEN_KEY = "stox_access_token";
const REFRESH_TOKEN_KEY = "stox_refresh_token";
const USER_KEY = "stox_user";

const AUTH_EVENT = "stox:auth";

let refreshPromise = null;

function emitAuthChange(type, user = null) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(AUTH_EVENT, { detail: { type, user } }),
  );
}

export function onAuthChange(handler) {
  if (typeof window === "undefined") return () => {};
  const listener = (event) => handler(event.detail);
  window.addEventListener(AUTH_EVENT, listener);
  return () => window.removeEventListener(AUTH_EVENT, listener);
}

export function saveAuthSession(result) {
  if (typeof window === "undefined") return null;

  if (!result?.user) {
    throw new Error("Authentication response did not include a user.");
  }

  const accessToken = result.accessToken ?? result.tokens?.accessToken;
  const refreshToken = result.refreshToken ?? result.tokens?.refreshToken;

  if (!accessToken || !refreshToken) {
    throw new Error("Authentication response did not include tokens.");
  }

  localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
  localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
  localStorage.setItem(USER_KEY, JSON.stringify(result.user));

  emitAuthChange("login", result.user);

  return result.user;
}

export function updateStoredUser(user) {
  if (typeof window === "undefined" || !user) return;
  localStorage.setItem(USER_KEY, JSON.stringify(user));
  emitAuthChange("user", user);
}

export function getAccessToken() {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(ACCESS_TOKEN_KEY);
}

export function getRefreshToken() {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(REFRESH_TOKEN_KEY);
}

export function getStoredUser() {
  if (typeof window === "undefined") return null;

  const rawUser = localStorage.getItem(USER_KEY);
  if (!rawUser) return null;

  try {
    return JSON.parse(rawUser);
  } catch {
    localStorage.removeItem(USER_KEY);
    return null;
  }
}

export function hasStoredSession() {
  return Boolean(getAccessToken());
}

export function clearAuthSession() {
  if (typeof window === "undefined") return;

  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
  localStorage.removeItem(USER_KEY);

  emitAuthChange("logout");
}

/**
 * Refresh the access token. Concurrent callers share one in-flight request so
 * a dashboard with six parallel queries issues a single refresh.
 */
export async function refreshSession() {
  if (typeof window === "undefined") return false;

  if (refreshPromise) return refreshPromise;

  const refreshToken = getRefreshToken();
  if (!refreshToken) return false;

  refreshPromise = (async () => {
    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/auth/refresh`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refreshToken }),
        },
      );

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          // Another tab may have rotated the refresh token while this request
          // was in flight. Clearing here would delete that tab's fresh pair
          // and log both tabs out, so only clear when the stored token is
          // still the one this request sent.
          const currentRefreshToken = getRefreshToken();

          if (currentRefreshToken && currentRefreshToken !== refreshToken) {
            return true;
          }

          if (currentRefreshToken === refreshToken) {
            clearAuthSession();
          }
        }
        return false;
      }

      const payload = data?.data;
      if (!payload) return false;

      // Refresh may omit the user object; keep the cached profile.
      saveAuthSession({
        ...payload,
        user: payload.user ?? getStoredUser(),
        refreshToken: payload.refreshToken ?? refreshToken,
      });

      return true;
    } catch {
      return false;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

export async function logoutSession() {
  const refreshToken = getRefreshToken();

  try {
    if (refreshToken) {
      await fetch(`${process.env.NEXT_PUBLIC_API_URL}/auth/logout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken }),
      });
    }
  } catch {
    // Local session is cleared regardless of network state.
  } finally {
    clearAuthSession();
  }
}

export async function fetchCurrentUser() {
  const { apiFetch } = await import("./api");
  const data = await apiFetch("/auth/me");
  return data?.user ?? null;
}
