const ACCESS_TOKEN_KEY = "stox_access_token";
const REFRESH_TOKEN_KEY = "stox_refresh_token";
const USER_KEY = "stox_user";

export function saveAuthSession(result) {
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
}

export function getAccessToken() {
    if (typeof window === "undefined") {
        return null;
    }

    return localStorage.getItem(ACCESS_TOKEN_KEY);
}

export function getRefreshToken() {
    if (typeof window === "undefined") {
        return null;
    }

    return localStorage.getItem(REFRESH_TOKEN_KEY);
}

export function getStoredUser() {
    if (typeof window === "undefined") {
        return null;
    }

    const rawUser = localStorage.getItem(USER_KEY);

    if (!rawUser) {
        return null;
    }

    try {
        return JSON.parse(rawUser);
    } catch {
        localStorage.removeItem(USER_KEY);
        return null;
    }
}

export function clearAuthSession() {
    if (typeof window === "undefined") {
        return;
    }

    localStorage.removeItem(ACCESS_TOKEN_KEY);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
}

export async function refreshSession() {
    const refreshToken = getRefreshToken();

    if (!refreshToken) {
        return false;
    }

    try {
        const response = await fetch(
            `${process.env.NEXT_PUBLIC_API_URL}/auth/refresh`,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    refreshToken,
                }),
            },
        );

        const data = await response.json();

        if (!response.ok) {
            clearAuthSession();
            return false;
        }

        saveAuthSession(data.data);

        return true;
    } catch (error) {
        console.error("Session refresh failed:", error);
        clearAuthSession();
        return false;
    }
}

export async function logoutSession() {
    const refreshToken = getRefreshToken();

    try {
        if (refreshToken) {
            await fetch(`${process.env.NEXT_PUBLIC_API_URL}/auth/logout`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    refreshToken,
                }),
            });
        }
    } catch (error) {
        console.error("Backend logout failed:", error);
    } finally {
        clearAuthSession();
    }
}
