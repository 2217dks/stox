"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Shield,
} from "lucide-react";

import { Logo } from "@/components/ui/logo";
import { Tooltip } from "@/components/ui/tooltip";
import { PortfolioSwitcher } from "@/components/layout/portfolio-switcher";
import { useActivePortfolio } from "@/lib/hooks";
import {
  communityNav,
  isNavActive,
  primaryNav,
  resolveNavHref,
} from "@/lib/navigation";
import { cn } from "@/lib/utils";
import { useSession } from "@/store/use-session";
import { useUI } from "@/store/use-ui";

function NavLink({ item, collapsed, portfolioId }) {
  const pathname = usePathname();
  const active = isNavActive(pathname, item.href);
  const href = resolveNavHref(item, portfolioId);

  const link = (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group relative flex h-9 items-center gap-2.5 rounded-[8px] px-2.5 text-[13px] font-medium transition-[background-color,color] duration-[var(--dur-fast)] ease-[var(--ease-out)]",
        active
          ? "bg-brand-soft text-brand"
          : "text-fg-muted hover:bg-surface-2 hover:text-fg",
        collapsed && "justify-center px-0",
      )}
    >
      {active ? (
        <span
          className="absolute -left-3 top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-full bg-brand"
          aria-hidden="true"
        />
      ) : null}
      <item.icon
        className={cn("size-[17px] shrink-0", active ? "text-brand" : "text-fg-subtle")}
        strokeWidth={1.7}
        aria-hidden="true"
      />
      {!collapsed ? <span className="truncate">{item.label}</span> : null}
    </Link>
  );

  if (collapsed) {
    return (
      <Tooltip content={item.label} side="right">
        {link}
      </Tooltip>
    );
  }

  return link;
}

function NavGroup({ label, items, collapsed, portfolioId }) {
  if (!items.length) return null;

  return (
    <div className="space-y-1">
      {!collapsed ? <p className="eyebrow px-2.5 pb-1.5">{label}</p> : null}
      {items.map((item) => (
        <NavLink
          key={item.href}
          item={item}
          collapsed={collapsed}
          portfolioId={portfolioId}
        />
      ))}
    </div>
  );
}

export function Sidebar() {
  const collapsed = useUI((state) => state.sidebarCollapsed);
  const toggleSidebar = useUI((state) => state.toggleSidebar);
  const user = useSession((state) => state.user);
  // The "Portfolio" entry follows the portfolio shown in the switcher above it.
  const { portfolioId } = useActivePortfolio();

  const accountItems = [
    { href: "/settings", label: "Settings", icon: Settings },
    ...(user?.role === "ADMIN"
      ? [{ href: "/admin", label: "Admin", icon: Shield }]
      : []),
  ];

  return (
    <aside
      className={cn(
        "group sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-line bg-canvas transition-[width] duration-200 ease-[var(--ease-out)] lg:flex",
        collapsed ? "w-[76px]" : "w-[248px]",
      )}
    >
      <div
        className={cn(
          "flex h-[60px] shrink-0 items-center border-b border-line",
          collapsed ? "justify-center" : "justify-between px-4",
        )}
      >
        <Logo href="/dashboard" showWordmark={!collapsed} size={26} />
        {!collapsed ? (
          <button
            type="button"
            onClick={toggleSidebar}
            className="flex size-7 items-center justify-center rounded-[6px] text-fg-subtle transition-colors hover:bg-surface-2 hover:text-fg"
            aria-label="Collapse sidebar"
          >
            <PanelLeftClose className="size-4" strokeWidth={1.7} />
          </button>
        ) : (
          <button
            type="button"
            onClick={toggleSidebar}
            className="absolute left-1/2 top-[52px] flex size-6 -translate-x-1/2 items-center justify-center rounded-full border border-line bg-surface text-fg-subtle opacity-0 transition-opacity hover:text-fg focus-visible:opacity-100 group-hover:opacity-100"
            aria-label="Expand sidebar"
          >
            <PanelLeftOpen className="size-3" strokeWidth={1.8} />
          </button>
        )}
      </div>

      <div className={cn("shrink-0 pt-3", collapsed ? "px-3" : "px-3")}>
        <PortfolioSwitcher collapsed={collapsed} />
      </div>

      <nav
        className="mt-5 flex-1 space-y-6 overflow-y-auto px-3 pb-4 no-scrollbar"
        aria-label="Main navigation"
      >
        <NavGroup
          label="Trade"
          items={primaryNav}
          collapsed={collapsed}
          portfolioId={portfolioId}
        />
        <NavGroup label="Community" items={communityNav} collapsed={collapsed} />
        <NavGroup label="Account" items={accountItems} collapsed={collapsed} />
      </nav>

      <div className="shrink-0 border-t border-line p-3">
        {!collapsed ? (
          <div className="rounded-[9px] border border-line bg-surface px-3 py-2.5">
            <div className="flex items-center gap-2">
              <span className="live-dot size-1.5 rounded-full bg-up" />
              <span className="text-[11px] font-medium text-fg">
                Paper account
              </span>
            </div>
            <p className="mt-1 text-[10.5px] leading-relaxed text-fg-subtle">
              Virtual funds. Real market data.
            </p>
          </div>
        ) : (
          <Tooltip content="Paper account · virtual funds" side="right">
            <span className="flex justify-center py-1">
              <span className="live-dot size-1.5 rounded-full bg-up" />
            </span>
          </Tooltip>
        )}
      </div>
    </aside>
  );
}
