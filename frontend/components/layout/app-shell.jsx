"use client";

import { AuthGuard } from "@/components/layout/auth-guard";
import { MobileNav } from "@/components/layout/mobile-nav";
import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";

export function AppShell({ children }) {
  return (
    <AuthGuard>
      <div className="app-surface flex min-h-dvh">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar />
          <main
            id="main-content"
            className="mx-auto w-full max-w-[1600px] flex-1 px-3 pb-24 pt-4 sm:px-5 sm:pt-6 lg:px-7 lg:pb-8"
          >
            {children}
          </main>
          <footer className="mx-auto flex w-full max-w-[1600px] flex-wrap items-center justify-between gap-2 border-t border-line px-4 pb-[calc(72px+env(safe-area-inset-bottom))] pt-4 text-[10.5px] text-fg-subtle sm:px-6 lg:pb-4 lg:px-8">
            <span>Virtual funds. Real market data. No financial advice.</span>
            <span className="flex items-center gap-3">
              <span>Stox paper terminal</span>
              <span className="text-line-strong" aria-hidden="true">
                ·
              </span>
              <span>v1.0</span>
            </span>
          </footer>
        </div>
        <MobileNav />
      </div>
    </AuthGuard>
  );
}
