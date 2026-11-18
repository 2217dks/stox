import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Logo } from "@/components/ui/logo";

export default function NotFound() {
  return (
    <div className="app-surface flex min-h-dvh flex-col items-center justify-center px-6 text-center">
      <Logo href="/" size={30} />
      <p className="eyebrow mt-10">404 · Route not found</p>
      <h1 className="mt-3 text-[34px] font-semibold leading-tight tracking-[-0.04em] text-fg">
        This page is not on the tape.
      </h1>
      <p className="mt-2 max-w-[42ch] text-[13px] leading-relaxed text-fg-muted">
        The route may have moved, or the resource no longer exists. Your
        portfolios and orders are untouched.
      </p>
      <div className="mt-7 flex flex-wrap justify-center gap-2">
        <Button asChild variant="primary" size="md">
          <Link href="/dashboard">Go to dashboard</Link>
        </Button>
        <Button asChild variant="secondary" size="md">
          <Link href="/markets">Browse markets</Link>
        </Button>
      </div>
    </div>
  );
}
