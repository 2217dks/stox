"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { bottomNav, isNavActive } from "@/lib/navigation";
import { cn } from "@/lib/utils";

export function MobileNav() {
  const pathname = usePathname();

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-canvas/92 backdrop-blur-xl lg:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      aria-label="Primary"
    >
      <div className="grid h-[58px] grid-cols-5">
        {bottomNav.map((item) => {
          const active = isNavActive(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative flex flex-col items-center justify-center gap-1 text-[10px] font-medium transition-colors",
                active ? "text-brand" : "text-fg-subtle hover:text-fg-muted",
              )}
            >
              {active ? (
                <span
                  className="absolute top-0 h-[2px] w-8 rounded-full bg-brand"
                  aria-hidden="true"
                />
              ) : null}
              <item.icon
                className="size-[19px]"
                strokeWidth={active ? 1.9 : 1.6}
                aria-hidden="true"
              />
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
