"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import GoogleSignInButton from "../../components/auth/GoogleSignInButton";
import { saveAuthSession } from "../../lib/auth";

export default function LoginPage() {
    const router = useRouter();

    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");

    async function handlePasswordLogin(event) {
        event.preventDefault();

        setLoading(true);
        setError("");

        try {
            const response = await fetch(
                `${process.env.NEXT_PUBLIC_API_URL}/auth/login`,
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        email,
                        password,
                    }),
                },
            );

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data?.error?.message || "Login failed.");
            }

            saveAuthSession(data.data);

            router.push("/dashboard");
        } catch (err) {
            setError(err.message || "Unable to sign in.");
        } finally {
            setLoading(false);
        }
    }

    function handleGoogleSuccess() {
        router.push("/dashboard");
    }

    return (
        <main className="flex min-h-screen items-center justify-center px-6">
            <div className="w-full max-w-md rounded-2xl border p-8 shadow-sm">
                <div className="mb-8 text-center">
                    <h1 className="text-3xl font-bold">Sign in to Stox</h1>

                    <p className="mt-2 text-sm text-gray-500">
                        Practice trading without real financial risk.
                    </p>
                </div>

                <form onSubmit={handlePasswordLogin} className="space-y-4">
                    <div>
                        <label
                            htmlFor="email"
                            className="mb-1 block text-sm font-medium"
                        >
                            Email
                        </label>

                        <input
                            id="email"
                            type="email"
                            required
                            value={email}
                            onChange={(event) => setEmail(event.target.value)}
                            className="w-full rounded-lg border px-3 py-2"
                            placeholder="you@example.com"
                        />
                    </div>

                    <div>
                        <label
                            htmlFor="password"
                            className="mb-1 block text-sm font-medium"
                        >
                            Password
                        </label>

                        <input
                            id="password"
                            type="password"
                            required
                            value={password}
                            onChange={(event) =>
                                setPassword(event.target.value)
                            }
                            className="w-full rounded-lg border px-3 py-2"
                            placeholder="Your password"
                        />
                    </div>

                    {error && <p className="text-sm text-red-600">{error}</p>}

                    <button
                        type="submit"
                        disabled={loading}
                        className="w-full rounded-lg bg-black px-4 py-2 text-white disabled:opacity-50"
                    >
                        {loading ? "Signing in..." : "Sign in"}
                    </button>
                </form>

                <div className="my-6 flex items-center gap-3">
                    <div className="h-px flex-1 bg-gray-200" />

                    <span className="text-xs text-gray-400">OR</span>

                    <div className="h-px flex-1 bg-gray-200" />
                </div>

                <div className="flex justify-center">
                    <GoogleSignInButton
                        onSuccess={handleGoogleSuccess}
                        onError={(err) => {
                            setError(
                                err.message || "Google authentication failed.",
                            );
                        }}
                    />
                </div>
            </div>
        </main>
    );
}
