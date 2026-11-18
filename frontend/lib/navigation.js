import {
  ArrowLeftRight,
  Award,
  Bell,
  BookOpen,
  ChartCandlestick,
  CircleDollarSign,
  LayoutDashboard,
  ListOrdered,
  Settings,
  Trophy,
  Users,
  Wallet,
} from "lucide-react";

export const primaryNav = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/markets", label: "Markets", icon: ChartCandlestick },
  { href: "/portfolios", label: "Portfolios", icon: Wallet },
  { href: "/orders", label: "Orders", icon: ListOrdered },
  { href: "/trades", label: "Trades", icon: ArrowLeftRight },
  { href: "/alerts", label: "Alerts", icon: Bell },
];

export const communityNav = [
  { href: "/social", label: "Social", icon: Users },
  { href: "/leaderboard", label: "Leaderboard", icon: Trophy },
  { href: "/copy-trading", label: "Copy trading", icon: CircleDollarSign },
  { href: "/leagues", label: "Leagues", icon: BookOpen },
  { href: "/achievements", label: "Achievements", icon: Award },
];

export const bottomNav = [
  { href: "/dashboard", label: "Home", icon: LayoutDashboard },
  { href: "/markets", label: "Markets", icon: ChartCandlestick },
  { href: "/portfolios", label: "Portfolio", icon: Wallet },
  { href: "/orders", label: "Orders", icon: ListOrdered },
  { href: "/social", label: "Social", icon: Users },
];

export const utilityNav = [
  { href: "/settings", label: "Settings", icon: Settings },
];

export const pageMeta = [
  {
    match: /^\/dashboard/,
    title: "Dashboard",
    description: "Your trading desk at a glance",
  },
  {
    match: /^\/markets/,
    title: "Markets",
    description: "Quotes, charts and market movers",
  },
  {
    match: /^\/portfolios/,
    title: "Portfolios",
    description: "Holdings, cash and performance",
  },
  { match: /^\/orders/, title: "Orders", description: "Every order and event" },
  { match: /^\/trades/, title: "Trades", description: "Executed trade history" },
  { match: /^\/alerts/, title: "Alerts", description: "Price and percentage alerts" },
  { match: /^\/social/, title: "Social", description: "Traders and ideas" },
  {
    match: /^\/leaderboard/,
    title: "Leaderboard",
    description: "Rankings across periods",
  },
  {
    match: /^\/copy-trading/,
    title: "Copy trading",
    description: "Mirror traders with your own limits",
  },
  { match: /^\/leagues/, title: "Leagues", description: "Time-bound competitions" },
  {
    match: /^\/achievements/,
    title: "Achievements",
    description: "Milestones on your trading journey",
  },
  {
    match: /^\/notifications/,
    title: "Notifications",
    description: "Order, alert and social activity",
  },
  { match: /^\/settings/, title: "Settings", description: "Profile and preferences" },
  { match: /^\/admin/, title: "Admin", description: "Platform operations" },
];

export function getPageMeta(pathname = "") {
  return (
    pageMeta.find((item) => item.match.test(pathname)) || {
      title: "Stox",
      description: "Paper trading, real markets",
    }
  );
}

export function isNavActive(pathname, href) {
  if (href === "/dashboard") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}
