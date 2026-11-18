"use client";

import { useEffect } from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Logo } from "@/components/ui/logo";

export default function ErrorPage({ error, reset }) {
  useEffect(() => {
    // Surface the error once in the console for local debugging.
    if (process.env.NODE_ENV !== "production") {
      console.error(error);
    }
  }, [error]);

  return (
    <div className="app-surface flex min-h-dvh flex-col items-center justify-center px-6 text-center">
      <Logo href="/" size={30} />
      <p className="eyebrow mt-10">Unexpected error</p>
      <h1 className="mt-3 text-[32px] font-semibold leading-tight tracking-[-0.04em] text-fg">
        The terminal hit turbulence.
      </h1>
      <p className="mt-2 max-w-[44ch] text-[13px] leading-relaxed text-fg-muted">
        Your session and portfolio data are safe. You can retry this screen or
        return to the dashboard.
      </p>
      {process.env.NODE_ENV !== "production" && error?.message ? (
        <p className="mt-4 max-w-[60ch] rounded-[8px] border border-line bg-surface-2 px-3 py-2 font-mono text-[10.5px] text-fg-subtle">
          {error.message}
        </p>
      ) : null}
      <div className="mt-7 flex flex-wrap justify-center gap-2">
        <Button variant="primary" size="md" onClick={() => reset()}>
          Try again
        </Button>
        <Button asChild variant="secondary" size="md">
          <Link href="/dashboard">Back to dashboard</Link>
        </Button>
      </div>
    </div>
  );
}
