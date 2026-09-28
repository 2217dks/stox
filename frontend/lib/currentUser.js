import { clearAuthSession, getAccessToken, refreshSession } from "./auth";

export async function fetchCurrentUser() {
    let accessToken = getAccessToken();

    if (!accessToken) {
        return null;
    }

    let response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/auth/me`, {
        headers: {
            Authorization: `Bearer ${accessToken}`,
        },
    });

    if (response.status === 401) {
        const refreshed = await refreshSession();

        if (!refreshed) {
            clearAuthSession();
            return null;
        }

        accessToken = getAccessToken();

        response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/auth/me`, {
            headers: {
                Authorization: `Bearer ${accessToken}`,
            },
        });
    }

    if (!response.ok) {
        return null;
    }

    const data = await response.json();

    return data.data.user;
}
