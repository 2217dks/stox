"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { getAccessToken, getStoredUser, logoutSession } from "../../lib/auth";

export default function DashboardPage() {
    const router = useRouter();

    const [user, setUser] = useState(null);

    useEffect(() => {
        const token = getAccessToken();
        const storedUser = getStoredUser();

        if (!token || !storedUser) {
            router.replace("/login");
            return;
        }

        setUser(storedUser);
    }, [router]);

    async function handleLogout() {
        await logoutSession();
        router.replace("/login");
    }

    if (!user) {
        return (
            <main className="flex min-h-screen items-center justify-center">
                <p>Loading...</p>
            </main>
        );
    }

    return (
        <main className="min-h-screen p-8">
            <div className="mx-auto max-w-4xl">
                <div className="flex items-center justify-between">
                    <div>
                        <p className="text-sm text-gray-500">Welcome back</p>

                        <h1 className="text-3xl font-bold">{user.name}</h1>
                    </div>

                    <button
                        onClick={handleLogout}
                        className="rounded-lg border px-4 py-2"
                    >
                        Log out
                    </button>
                </div>

                <div className="mt-8 rounded-xl border p-6">
                    <h2 className="text-xl font-semibold">Account</h2>

                    <div className="mt-4 space-y-2 text-sm">
                        <p>
                            <strong>Email:</strong> {user.email}
                        </p>

                        <p>
                            <strong>Role:</strong> {user.role}
                        </p>

                        <p>
                            <strong>Verified:</strong>{" "}
                            {user.isVerified ? "Yes" : "No"}
                        </p>
                    </div>
                </div>
            </div>
        </main>
    );
}
