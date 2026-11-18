"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Bell,
  LogOut,
  Menu,
  Moon,
  Plus,
  Search,
  Settings,
  Shield,
  Sun,
} from "lucide-react";
import { useState } from "react";

import { Avatar } from "@/components/ui/avatar";
import { IconButton } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown";
import { Logo } from "@/components/ui/logo";
import {
  communityNav,
  getPageMeta,
  isNavActive,
  primaryNav,
} from "@/lib/navigation";
import { useMarketOverview, useUnreadNotifications } from "@/lib/hooks";
import { cn } from "@/lib/utils";
import { useSession } from "@/store/use-session";
import { useUI } from "@/store/use-ui";

function MarketPulse() {
  const { overview, loading, error } = useMarketOverview("CRYPTO", 1);

  const state = error
    ? { label: "Data offline", tone: "down" }
    : loading && !overview
      ? { label: "Connecting", tone: "warn" }
      : { label: "Markets live", tone: "up" };

  return (
    <span className="hidden h-7 items-center gap-1.5 rounded-full border border-line bg-surface-2 px-2.5 text-[10.5px] font-medium text-fg-muted md:inline-flex">
      <span
        className={cn(
          "size-1.5 rounded-full",
          state.tone === "up"
            ? "bg-up live-dot"
            : state.tone === "warn"
              ? "bg-warn"
              : "bg-down",
        )}
        aria-hidden="true"
      />
      {state.label}
    </span>
  );
}

function NotificationBell() {
  const { count } = useUnreadNotifications();

  return (
    <Link
      href="/notifications"
      aria-label={
        count > 0 ? `Notifications, ${count} unread` : "Notifications"
      }
      className="relative flex size-9 items-center justify-center rounded-[9px] text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
    >
      <Bell className="size-[17px]" strokeWidth={1.7} aria-hidden="true" />
      {count > 0 ? (
        <span className="tnum absolute -right-0.5 -top-0.5 flex h-[16px] min-w-[16px] items-center justify-center rounded-full bg-brand px-1 text-[9px] font-semibold leading-none text-brand-ink ring-2 ring-canvas">
          {count > 99 ? "99+" : count}
        </span>
      ) : null}
    </Link>
  );
}

function ThemeToggle() {
  const theme = useUI((state) => state.theme);
  const toggleTheme = useUI((state) => state.toggleTheme);

  return (
    <IconButton
      label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
      variant="ghost"
      onClick={toggleTheme}
      className="hidden sm:inline-flex"
    >
      {theme === "dark" ? (
        <Sun className="size-[17px]" strokeWidth={1.7} />
      ) : (
        <Moon className="size-[17px]" strokeWidth={1.7} />
      )}
    </IconButton>
  );
}

function UserMenu() {
  const user = useSession((state) => state.user);
  const signOut = useSession((state) => state.signOut);
  const router = useRouter();

  if (!user) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-2 rounded-full p-0.5 transition-opacity hover:opacity-85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          aria-label="Account menu"
        >
          <Avatar src={user.avatarUrl} name={user.name} size={30} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[236px]">
        <DropdownMenuLabel>Signed in</DropdownMenuLabel>
        <div className="flex items-center gap-2.5 px-2 pb-2 pt-0.5">
          <Avatar src={user.avatarUrl} name={user.name} size={34} />
          <div className="min-w-0">
            <p className="truncate text-[12.5px] font-medium text-fg">
              {user.name}
            </p>
            <p className="truncate text-[10.5px] text-fg-subtle">{user.email}</p>
          </div>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => router.push("/settings")}>
          <Settings className="size-3.5" aria-hidden="true" />
          Settings
        </DropdownMenuItem>
        {user.role === "ADMIN" ? (
          <DropdownMenuItem onSelect={() => router.push("/admin")}>
            <Shield className="size-3.5" aria-hidden="true" />
            Admin console
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          danger
          onSelect={async () => {
            await signOut();
            router.push("/login");
          }}
        >
          <LogOut className="size-3.5" aria-hidden="true" />
          Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function MobileMenu() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const user = useSession((state) => state.user);
  const theme = useUI((state) => state.theme);
  const toggleTheme = useUI((state) => state.toggleTheme);
  const signOut = useSession((state) => state.signOut);
  const router = useRouter();

  const groups = [
    { label: "Trade", items: primaryNav },
    { label: "Community", items: communityNav },
    {
      label: "Account",
      items: [
        { href: "/settings", label: "Settings", icon: Settings },
        ...(user?.role === "ADMIN"
          ? [{ href: "/admin", label: "Admin", icon: Shield }]
          : []),
      ],
    },
  ];

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex size-9 items-center justify-center rounded-[9px] text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg lg:hidden"
        aria-label="Open navigation"
      >
        <Menu className="size-[18px]" strokeWidth={1.7} />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          size="sm"
          className="left-3 top-3 bottom-3 h-[calc(100dvh-24px)] max-h-none w-[calc(100%-24px)] max-w-[320px] translate-x-0 translate-y-0 rounded-[16px] data-[state=open]:animate-[fade-in_180ms_ease-out]"
        >
          <DialogHeader>
            <DialogTitle>Navigate</DialogTitle>
          </DialogHeader>
          <div className="space-y-6 px-4 pb-6">
            {groups.map((group) => (
              <div key={group.label}>
                <p className="eyebrow mb-1.5 px-2">{group.label}</p>
                <div className="space-y-0.5">
                  {group.items.map((item) => {
                    const active = isNavActive(pathname, item.href);
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        onClick={() => setOpen(false)}
                        className={cn(
                          "flex h-10 items-center gap-3 rounded-[8px] px-2 text-[13px] font-medium transition-colors",
                          active
                            ? "bg-brand-soft text-brand"
                            : "text-fg-muted hover:bg-surface-2 hover:text-fg",
                        )}
                      >
                        <item.icon
                          className={cn(
                            "size-[17px]",
                            active ? "text-brand" : "text-fg-subtle",
                          )}
                          strokeWidth={1.7}
                        />
                        {item.label}
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
            <div className="space-y-0.5 border-t border-line pt-4">
              <button
                type="button"
                onClick={toggleTheme}
                className="flex h-10 w-full items-center gap-3 rounded-[8px] px-2 text-[13px] font-medium text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
              >
                {theme === "dark" ? (
                  <Sun className="size-[17px] text-fg-subtle" strokeWidth={1.7} />
                ) : (
                  <Moon className="size-[17px] text-fg-subtle" strokeWidth={1.7} />
                )}
                {theme === "dark" ? "Light theme" : "Dark theme"}
              </button>
              <button
                type="button"
                onClick={async () => {
                  setOpen(false);
                  await signOut();
                  router.push("/login");
                }}
                className="flex h-10 w-full items-center gap-3 rounded-[8px] px-2 text-[13px] font-medium text-down transition-colors hover:bg-down-soft"
              >
                <LogOut className="size-[17px]" strokeWidth={1.7} />
                Log out
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function Topbar() {
  const pathname = usePathname();
  const setCommandOpen = useUI((state) => state.setCommandOpen);
  const meta = getPageMeta(pathname);

  return (
    <header className="glass sticky top-0 z-40 flex h-[60px] shrink-0 items-center gap-2 border-b border-line px-3 sm:px-5 lg:px-7">
      <MobileMenu />
      <div className="lg:hidden">
        <Logo href="/dashboard" size={24} />
      </div>
      <div className="hidden min-w-0 items-center gap-2 lg:flex">
        <span className="truncate text-[13px] font-medium text-fg">
          {meta.title}
        </span>
        <span className="text-fg-subtle" aria-hidden="true">
          /
        </span>
        <span className="truncate text-[12px] text-fg-subtle">
          {meta.description}
        </span>
      </div>

      <div className="ml-auto flex items-center gap-1 sm:gap-1.5">
        <button
          type="button"
          onClick={() => setCommandOpen(true)}
          className="hidden h-8 w-[190px] items-center gap-2 rounded-[8px] border border-line bg-surface-2/70 px-2.5 text-[12px] text-fg-subtle transition-colors hover:border-line-strong hover:text-fg-muted md:flex"
        >
          <Search className="size-3.5" aria-hidden="true" />
          <span className="flex-1 text-left">Search…</span>
          <span className="rounded-[4px] border border-line bg-surface px-1 font-mono text-[9.5px]">
            ⌘K
          </span>
        </button>
        <IconButton
          label="Search"
          variant="ghost"
          onClick={() => setCommandOpen(true)}
          className="md:hidden"
        >
          <Search className="size-[17px]" strokeWidth={1.7} />
        </IconButton>
        <Link
          href="/orders?new=1"
          aria-label="New order"
          className="flex size-9 items-center justify-center rounded-[9px] text-brand transition-colors hover:bg-brand-soft sm:hidden"
        >
          <Plus className="size-[18px]" strokeWidth={1.9} aria-hidden="true" />
        </Link>
        <MarketPulse />
        <NotificationBell />
        <ThemeToggle />
        <Link
          href="/orders?new=1"
          className="ml-1 hidden h-8 items-center gap-1.5 rounded-[8px] bg-brand px-3 text-[12.5px] font-medium text-brand-ink transition-colors hover:bg-brand-strong sm:inline-flex"
        >
          <Plus className="size-3.5" strokeWidth={2} aria-hidden="true" />
          New order
        </Link>
        <div className="ml-1">
          <UserMenu />
        </div>
      </div>
    </header>
  );
}
