import { getAccessToken, refreshSession } from "./auth";

export async function apiFetch(path, options = {}) {
    const headers = new Headers(options.headers || {});

    headers.set("Content-Type", "application/json");

    const accessToken = getAccessToken();

    if (accessToken) {
        headers.set("Authorization", `Bearer ${accessToken}`);
    }

    let response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}${path}`, {
        ...options,
        headers,
    });

    // Access token expired
    if (response.status === 401) {
        const refreshed = await refreshSession();

        if (!refreshed) {
            return response;
        }

        const newAccessToken = getAccessToken();

        const retryHeaders = new Headers(options.headers || {});

        retryHeaders.set("Content-Type", "application/json");

        if (newAccessToken) {
            retryHeaders.set("Authorization", `Bearer ${newAccessToken}`);
        }

        response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}${path}`, {
            ...options,
            headers: retryHeaders,
        });
    }

    return response;
}
