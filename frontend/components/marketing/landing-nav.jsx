"use client";

import Link from "next/link";
import { ArrowRight, Menu, X } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Logo } from "@/components/ui/logo";
import { useSession } from "@/store/use-session";
import { cn } from "@/lib/utils";

const links = [
  { href: "#product", label: "Product" },
  { href: "#features", label: "Features" },
  { href: "#how", label: "How it works" },
  { href: "#security", label: "Simulator" },
];

export function LandingNav() {
  const [open, setOpen] = useState(false);
  const status = useSession((state) => state.status);

  return (
    <header className="glass sticky top-0 z-50 border-b border-line">
      <div className="mx-auto flex h-[62px] w-full max-w-[1200px] items-center gap-6 px-5 sm:px-8">
        <Logo href="/" size={28} />
        <nav className="hidden items-center gap-1 md:flex" aria-label="Sections">
          {links.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="rounded-[7px] px-2.5 py-1.5 text-[12.5px] font-medium text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
            >
              {link.label}
            </a>
          ))}
        </nav>

        <div className="ml-auto hidden items-center gap-2 md:flex">
          {status === "authed" ? (
            <Link
              href="/dashboard"
              className="inline-flex h-8 items-center gap-1.5 rounded-[8px] bg-brand px-3 text-[12.5px] font-medium text-brand-ink transition-colors hover:bg-brand-strong"
            >
              Open terminal
              <ArrowRight className="size-3.5" aria-hidden="true" />
            </Link>
          ) : (
            <>
              <Link
                href="/login"
                className="inline-flex h-8 items-center rounded-[8px] px-3 text-[12.5px] font-medium text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
              >
                Sign in
              </Link>
              <Link
                href="/register"
                className="inline-flex h-8 items-center gap-1.5 rounded-[8px] bg-brand px-3 text-[12.5px] font-medium text-brand-ink transition-colors hover:bg-brand-strong"
              >
                Start free
                <ArrowRight className="size-3.5" aria-hidden="true" />
              </Link>
            </>
          )}
        </div>

        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="ml-auto flex size-9 items-center justify-center rounded-[8px] text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg md:hidden"
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
        >
          {open ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
      </div>

      <div
        className={cn(
          "overflow-hidden border-t border-line md:hidden",
          open ? "block animate-fade" : "hidden",
        )}
      >
        <nav className="space-y-1 px-5 py-3" aria-label="Mobile sections">
          {links.map((link) => (
            <a
              key={link.href}
              href={link.href}
              onClick={() => setOpen(false)}
              className="block rounded-[8px] px-2.5 py-2 text-[13px] font-medium text-fg-muted hover:bg-surface-2 hover:text-fg"
            >
              {link.label}
            </a>
          ))}
          <div className="grid grid-cols-2 gap-2 pt-2">
            {status === "authed" ? (
              <Button
                asChild
                variant="primary"
                size="sm"
                className="col-span-2"
              >
                <Link href="/dashboard">Open terminal</Link>
              </Button>
            ) : (
              <>
                <Button asChild variant="secondary" size="sm">
                  <Link href="/login">Sign in</Link>
                </Button>
                <Button asChild variant="primary" size="sm">
                  <Link href="/register">Start free</Link>
                </Button>
              </>
            )}
          </div>
        </nav>
      </div>
    </header>
  );
}
