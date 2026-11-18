"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Script from "next/script";

import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { authApi } from "@/lib/endpoints";
import { useUI } from "@/store/use-ui";

export default function GoogleSignInButton({ onSuccess, onError }) {
  const buttonRef = useRef(null);
  const theme = useUI((state) => state.theme);
  const [scriptReady, setScriptReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleCredentialResponse = useCallback(
    async (response) => {
      if (!response?.credential) {
        const message = "Google did not return a credential.";
        setError(message);
        onError?.(new Error(message));
        return;
      }

      try {
        setLoading(true);
        setError("");
        const data = await authApi.google(response.credential);
        onSuccess?.(data);
      } catch (err) {
        const message = err?.message || "Google authentication failed.";
        setError(message);
        onError?.(err);
      } finally {
        setLoading(false);
      }
    },
    [onSuccess, onError],
  );

  const renderGoogleButton = useCallback(() => {
    if (!window.google?.accounts?.id) return;

    const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
    if (!clientId || clientId.includes("your_google_client_id")) return;

    window.google.accounts.id.initialize({
      client_id: clientId,
      callback: handleCredentialResponse,
    });

    if (buttonRef.current) {
      buttonRef.current.innerHTML = "";
      window.google.accounts.id.renderButton(buttonRef.current, {
        theme: theme === "dark" ? "filled_black" : "outline",
        size: "large",
        text: "continue_with",
        shape: "rectangular",
        logo_alignment: "left",
        width: 340,
      });
    }
  }, [handleCredentialResponse, theme]);

  useEffect(() => {
    if (scriptReady) renderGoogleButton();
  }, [scriptReady, renderGoogleButton]);

  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
  const configured = Boolean(clientId && !clientId.includes("your_"));

  const handleScriptLoad = () => {
    const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
    if (!clientId || clientId.includes("your_google_client_id")) {
      setError("Google sign-in is not configured.");
      return;
    }
    setScriptReady(true);
    renderGoogleButton();
  };

  if (!configured) {
    return (
      <Button variant="secondary" size="lg" fullWidth disabled>
        Google sign-in not configured
      </Button>
    );
  }

  return (
    <div className="space-y-2">
      <Script
        src="https://accounts.google.com/gsi/client"
        strategy="afterInteractive"
        onLoad={handleScriptLoad}
        onError={() => {
          setError("Could not load Google sign-in.");
        }}
      />
      <div className="relative flex min-h-10 items-center justify-center">
        {!scriptReady || loading ? (
          <div className="flex h-10 w-full items-center justify-center gap-2 rounded-[9px] border border-line bg-surface-2 text-[12.5px] text-fg-muted">
            <Loader2 className="size-4 animate-[stox-spin_.8s_linear_infinite]" />
            {loading ? "Signing in with Google…" : "Loading Google…"}
          </div>
        ) : null}
        <div
          ref={buttonRef}
          className={!scriptReady || loading ? "absolute opacity-0" : "w-full [&>div]:!w-full"}
        />
      </div>
      {error ? (
        <p className="text-[11.5px] text-down" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
