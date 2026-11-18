"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Command } from "cmdk";
import {
  ArrowLeftRight,
  Award,
  Bell,
  BookOpen,
  ChartCandlestick,
  CircleDollarSign,
  LayoutDashboard,
  ListOrdered,
  LogOut,
  Moon,
  Settings,
  Shield,
  Sun,
  Trophy,
  Users,
  Wallet,
} from "lucide-react";

import { Kbd } from "@/components/ui/misc";
import { useSession } from "@/store/use-session";
import { useUI } from "@/store/use-ui";

const groups = [
  {
    label: "Trade",
    items: [
      { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
      { label: "Markets", href: "/markets", icon: ChartCandlestick },
      { label: "Portfolios", href: "/portfolios", icon: Wallet },
      { label: "Orders", href: "/orders", icon: ListOrdered },
      { label: "Trades", href: "/trades", icon: ArrowLeftRight },
      { label: "Price alerts", href: "/alerts", icon: Bell },
    ],
  },
  {
    label: "Community",
    items: [
      { label: "Social feed", href: "/social", icon: Users },
      { label: "Leaderboard", href: "/leaderboard", icon: Trophy },
      { label: "Copy trading", href: "/copy-trading", icon: CircleDollarSign },
      { label: "Leagues", href: "/leagues", icon: BookOpen },
      { label: "Achievements", href: "/achievements", icon: Award },
    ],
  },
  {
    label: "Account",
    items: [
      { label: "Notifications", href: "/notifications", icon: Bell },
      { label: "Settings", href: "/settings", icon: Settings },
      { label: "Admin", href: "/admin", icon: Shield, role: "ADMIN" },
    ],
  },
];

export function CommandMenu() {
  const router = useRouter();
  const open = useUI((state) => state.commandOpen);
  const setOpen = useUI((state) => state.setCommandOpen);
  const toggleTheme = useUI((state) => state.toggleTheme);
  const theme = useUI((state) => state.theme);
  const user = useSession((state) => state.user);
  const signOut = useSession((state) => state.signOut);

  useEffect(() => {
    const onKeyDown = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen(!useUI.getState().commandOpen);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [setOpen]);

  const go = (href) => {
    setOpen(false);
    router.push(href);
  };

  const groupsWithAccess = groups.map((group) => ({
    ...group,
    items: group.items.filter(
      (item) => !item.role || item.role === user?.role,
    ),
  }));

  return (
    <Command.Dialog
      open={open}
      onOpenChange={setOpen}
      label="Command menu"
      loop
      overlayClassName="fixed inset-0 z-[90] bg-[var(--overlay)] backdrop-blur-[3px]"
      contentClassName="fixed left-1/2 top-[12vh] z-[90] w-[calc(100%-32px)] max-w-[560px] -translate-x-1/2 overflow-hidden rounded-[14px] border border-line bg-surface shadow-[var(--shadow-modal)]"
    >
        <div className="flex items-center gap-3 border-b border-line px-4">
          <Command.Input
            autoFocus
            placeholder="Search pages, actions…"
            className="h-12 w-full bg-transparent text-[14px] text-fg outline-none placeholder:text-fg-subtle"
          />
          <Kbd>ESC</Kbd>
        </div>
        <Command.List className="max-h-[min(440px,55dvh)] overflow-y-auto p-2">
          <Command.Empty className="px-3 py-10 text-center text-[12.5px] text-fg-muted">
            No matches. Try “orders” or “markets”.
          </Command.Empty>

          {groupsWithAccess.map((group) => (
            <Command.Group
              key={group.label}
              heading={group.label}
              className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.09em] [&_[cmdk-group-heading]]:text-fg-subtle"
            >
              {group.items.map((item) => (
                <Command.Item
                  key={item.href}
                  onSelect={() => go(item.href)}
                  className="flex h-9 cursor-pointer items-center gap-2.5 rounded-[7px] px-2 text-[13px] text-fg-muted data-[selected=true]:bg-brand-soft data-[selected=true]:text-fg"
                >
                  <item.icon
                    className="size-4 text-fg-subtle"
                    strokeWidth={1.7}
                    aria-hidden="true"
                  />
                  {item.label}
                </Command.Item>
              ))}
            </Command.Group>
          ))}

          <Command.Separator className="my-1.5 h-px bg-line" />

          <Command.Group
            heading="Actions"
            className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.09em] [&_[cmdk-group-heading]]:text-fg-subtle"
          >
            <Command.Item
              onSelect={() => {
                setOpen(false);
                router.push("/orders?new=1");
              }}
              className="flex h-9 cursor-pointer items-center gap-2.5 rounded-[7px] px-2 text-[13px] text-fg-muted data-[selected=true]:bg-brand-soft data-[selected=true]:text-fg"
            >
              <ArrowLeftRight
                className="size-4 text-fg-subtle"
                strokeWidth={1.7}
              />
              Place a new order
            </Command.Item>
            <Command.Item
              onSelect={() => {
                toggleTheme();
                setOpen(false);
              }}
              className="flex h-9 cursor-pointer items-center gap-2.5 rounded-[7px] px-2 text-[13px] text-fg-muted data-[selected=true]:bg-brand-soft data-[selected=true]:text-fg"
            >
              {theme === "dark" ? (
                <Sun className="size-4 text-fg-subtle" strokeWidth={1.7} />
              ) : (
                <Moon className="size-4 text-fg-subtle" strokeWidth={1.7} />
              )}
              Switch to {theme === "dark" ? "light" : "dark"} theme
            </Command.Item>
            {user ? (
              <Command.Item
                onSelect={async () => {
                  setOpen(false);
                  await signOut();
                  router.push("/login");
                }}
                className="flex h-9 cursor-pointer items-center gap-2.5 rounded-[7px] px-2 text-[13px] text-down data-[selected=true]:bg-down-soft"
              >
                <LogOut className="size-4" strokeWidth={1.7} />
                Log out
              </Command.Item>
            ) : null}
          </Command.Group>
        </Command.List>
        <div className="flex items-center justify-between border-t border-line px-3 py-2 text-[10.5px] text-fg-subtle">
          <span className="flex items-center gap-1.5">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd>
            navigate
          </span>
          <span className="flex items-center gap-1.5">
            <Kbd>↵</Kbd>
            open
          </span>
        </div>
    </Command.Dialog>
  );
}
