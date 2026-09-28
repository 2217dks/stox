"use client";

import { useCallback, useRef, useState } from "react";
import Script from "next/script";
import { saveAuthSession } from "../../lib/auth";

export default function GoogleSignInButton({ onSuccess, onError }) {
    const buttonRef = useRef(null);

    const [status, setStatus] = useState("idle");
    const [message, setMessage] = useState("");

    const handleCredentialResponse = useCallback(
        async (response) => {
            if (!response?.credential) {
                const error = new Error("Google did not return a credential.");

                setStatus("error");
                setMessage(error.message);

                onError?.(error);
                return;
            }

            try {
                setStatus("loading");
                setMessage("Signing in with Google...");

                const apiUrl = process.env.NEXT_PUBLIC_API_URL;

                const backendResponse = await fetch(`${apiUrl}/auth/google`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        credential: response.credential,
                    }),
                });

                const data = await backendResponse.json();

                if (!backendResponse.ok) {
                    throw new Error(
                        data?.error?.message || "Google authentication failed.",
                    );
                }

                saveAuthSession(data.data);

                setStatus("success");
                setMessage(`Signed in successfully as ${data.data.user.email}`);

                onSuccess?.(data.data);
            } catch (error) {
                console.error("Google authentication failed:", error);

                setStatus("error");
                setMessage(error.message || "Google authentication failed.");

                onError?.(error);
            }
        },
        [onSuccess, onError],
    );

    const initializeGoogle = useCallback(() => {
        if (!window.google?.accounts?.id) {
            console.error("Google Identity Services did not load.");
            return;
        }

        const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;

        if (!clientId) {
            console.error("NEXT_PUBLIC_GOOGLE_CLIENT_ID is missing.");
            return;
        }

        window.google.accounts.id.initialize({
            client_id: clientId,
            callback: handleCredentialResponse,
        });

        if (buttonRef.current) {
            buttonRef.current.innerHTML = "";

            window.google.accounts.id.renderButton(buttonRef.current, {
                theme: "outline",
                size: "large",
                text: "continue_with",
                shape: "rectangular",
                width: 320,
            });
        }
    }, [handleCredentialResponse]);

    return (
        <div className="flex flex-col items-center gap-4">
            <Script
                src="https://accounts.google.com/gsi/client"
                strategy="afterInteractive"
                onLoad={initializeGoogle}
                onError={() => {
                    const error = new Error("Could not load Google Sign-In.");

                    setStatus("error");
                    setMessage(error.message);

                    onError?.(error);
                }}
            />

            <div ref={buttonRef} />

            {status === "loading" && (
                <p className="text-sm text-gray-500">{message}</p>
            )}

            {status === "success" && (
                <p className="text-sm text-green-600">{message}</p>
            )}

            {status === "error" && (
                <p className="text-sm text-red-600">{message}</p>
            )}
        </div>
    );
}
