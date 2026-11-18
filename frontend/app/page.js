import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  BellRing,
  ChartCandlestick,
  CircleDollarSign,
  Gauge,
  Globe2,
  Layers3,
  LineChart,
  LockKeyhole,
  Medal,
  ShieldCheck,
  Sparkles,
  Trophy,
  Users,
  Wallet,
} from "lucide-react";

import { MarketTicker } from "@/components/marketing/market-ticker";
import { LandingNav } from "@/components/marketing/landing-nav";
import { HeroMarketCard } from "@/components/marketing/hero-market-card";
import { ProductPreview } from "@/components/marketing/product-preview";
import { Logo } from "@/components/ui/logo";
import { Badge } from "@/components/ui/badge";

const stats = [
  ["$10,000", "Virtual capital per portfolio"],
  ["4", "Order types, including stops"],
  ["< 1s", "Order event visibility"],
  ["0", "Real money at risk"],
];

const features = [
  {
    icon: Layers3,
    title: "Four order types",
    description:
      "Market, limit, stop-loss and take-profit orders with cash reservations, expiry, and a full lifecycle audit trail.",
    className: "md:col-span-2",
    accent: "brand",
  },
  {
    icon: Wallet,
    title: "Multiple portfolios",
    description:
      "Run separate strategies with isolated cash, holdings, orders and performance. Compare them side by side.",
    accent: "cyan",
  },
  {
    icon: ChartCandlestick,
    title: "Stocks and crypto",
    description:
      "Live quotes, historical candles and market movers from public providers. Practice across asset classes.",
    accent: "violet",
  },
  {
    icon: Gauge,
    title: "Risk-aware analytics",
    description:
      "Volatility, drawdown, Sharpe-like ratio, benchmark comparison and a daily P&L heatmap.",
    accent: "warn",
  },
  {
    icon: BellRing,
    title: "Price and percent alerts",
    description:
      "Above, below, or a percentage move — with a captured baseline so every alert has a real reference point.",
    accent: "brand",
  },
  {
    icon: CircleDollarSign,
    title: "Copy trading",
    description:
      "Mirror a trader's market orders with an allocation percentage and a notional cap you control.",
    className: "md:col-span-2",
    accent: "cyan",
  },
  {
    icon: Trophy,
    title: "Leaderboards and leagues",
    description:
      "Daily, weekly, monthly and all-time rankings. Join time-bound leagues with their own portfolio.",
    accent: "warn",
  },
  {
    icon: Users,
    title: "Social feed",
    description:
      "Share ideas with a symbol tag, follow traders, and keep your public profile focused on the numbers.",
    accent: "violet",
  },
];

const accentMap = {
  brand: "bg-brand-soft text-brand",
  cyan: "bg-[rgba(94,234,212,.1)] text-cyan",
  violet: "bg-violet-soft text-violet",
  warn: "bg-warn-soft text-warn",
};

const steps = [
  {
    number: "01",
    title: "Create an account",
    description:
      "Sign up with email or Google. Your default portfolio starts with $10,000 in virtual cash.",
    icon: Sparkles,
  },
  {
    number: "02",
    title: "Place your first order",
    description:
      "Search a stock or crypto pair, choose market or a conditional order, and size the position.",
    icon: LineChart,
  },
  {
    number: "03",
    title: "Measure and iterate",
    description:
      "Track P&L, risk and allocation. Compare strategies, follow traders, or climb the leaderboard.",
    icon: BarChart3,
  },
];

const simulatorPoints = [
  {
    icon: ShieldCheck,
    title: "Virtual capital only",
    description:
      "No deposits, withdrawals, brokerage accounts or payment details. Every balance is simulated.",
  },
  {
    icon: LockKeyhole,
    title: "Your session, your data",
    description:
      "JWT sessions with refresh rotation, owner-scoped portfolios and server-side validation on every trade.",
  },
  {
    icon: Globe2,
    title: "Real market context",
    description:
      "Quotes and candles come from public market-data providers so decisions feel like the real thing.",
  },
];

export default function HomePage() {
  return (
    <div className="min-h-dvh bg-canvas">
      <LandingNav />

      <main id="main-content">
        <section className="relative overflow-hidden border-b border-line">
          <div className="grid-lines pointer-events-none absolute inset-0 opacity-80" />
          <div
            className="pointer-events-none absolute -top-40 left-1/2 h-[560px] w-[900px] -translate-x-1/2 rounded-full opacity-50 blur-[120px]"
            style={{
              background:
                "radial-gradient(45% 55% at 50% 50%, rgba(108,151,255,.28), transparent 70%)",
            }}
          />

          <div className="relative mx-auto grid w-full max-w-[1200px] items-center gap-12 px-5 pb-16 pt-14 sm:px-8 sm:pb-20 sm:pt-20 lg:grid-cols-[1.08fr_.92fr] lg:gap-10 lg:pb-24 lg:pt-24">
            <div className="animate-rise">
              <Badge tone="brand" dot pulse className="mb-5">
                Paper trading · live market data
              </Badge>
              <h1 className="max-w-[12ch] text-[clamp(2.6rem,6.4vw,4.4rem)] font-semibold leading-[0.94] tracking-[-0.055em] text-fg">
                Trade the market.
                <br />
                <span className="text-fg-muted">Risk nothing.</span>
              </h1>
              <p className="mt-6 max-w-[46ch] text-[14.5px] leading-relaxed text-fg-muted sm:text-[15px]">
                A professional paper-trading terminal for stocks and crypto.
                Build strategies with $10,000 in virtual capital, track real
                performance analytics, and compete with other traders.
              </p>

              <div className="mt-8 flex flex-wrap items-center gap-2.5">
                <Link
                  href="/register"
                  className="inline-flex h-11 items-center gap-2 rounded-[10px] bg-brand px-5 text-[14px] font-medium text-brand-ink shadow-[inset_0_1px_0_rgba(255,255,255,.22)] transition-[background-color,transform] duration-[var(--dur-press)] hover:bg-brand-strong active:scale-[0.97]"
                >
                  Start trading free
                  <ArrowRight className="size-4" aria-hidden="true" />
                </Link>
                <Link
                  href="/markets"
                  className="inline-flex h-11 items-center gap-2 rounded-[10px] border border-line-strong px-5 text-[14px] font-medium text-fg transition-colors hover:bg-surface-2"
                >
                  Explore markets
                  <ArrowUpRight className="size-4" aria-hidden="true" />
                </Link>
              </div>

              <div className="mt-7 flex flex-wrap items-center gap-x-5 gap-y-2 text-[11.5px] text-fg-subtle">
                <span className="flex items-center gap-1.5">
                  <ShieldCheck className="size-3.5 text-up" aria-hidden="true" />
                  No card required
                </span>
                <span className="flex items-center gap-1.5">
                  <Globe2 className="size-3.5 text-brand" aria-hidden="true" />
                  Stocks and crypto
                </span>
                <span className="flex items-center gap-1.5">
                  <Medal className="size-3.5 text-warn" aria-hidden="true" />
                  Leaderboards included
                </span>
              </div>
            </div>

            <div className="animate-rise [animation-delay:120ms]">
              <HeroMarketCard />
            </div>
          </div>

          <MarketTicker />
        </section>

        <section className="border-b border-line bg-canvas-deep/40">
          <div className="mx-auto grid w-full max-w-[1200px] grid-cols-2 divide-x divide-line px-5 sm:px-8 lg:grid-cols-4">
            {stats.map(([value, label]) => (
              <div key={label} className="px-4 py-7 first:pl-0 sm:px-6 lg:py-8">
                <p className="tnum text-[22px] font-semibold tracking-[-0.03em] text-fg sm:text-[26px]">
                  {value}
                </p>
                <p className="mt-1 text-[11px] leading-snug text-fg-subtle">
                  {label}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section id="product" className="scroll-mt-24 border-b border-line">
          <div className="mx-auto w-full max-w-[1200px] px-5 py-20 sm:px-8 sm:py-24">
            <div className="mx-auto mb-12 max-w-[620px] text-center">
              <p className="eyebrow mb-3">The terminal</p>
              <h2 className="text-[30px] font-semibold leading-[1.08] tracking-[-0.04em] text-fg sm:text-[38px]">
                Everything a trading desk needs,
                <br className="hidden sm:block" /> none of the risk.
              </h2>
              <p className="mt-4 text-[13.5px] leading-relaxed text-fg-muted">
                Built around the same information architecture as a real
                terminal: portfolios, live quotes, order control, and
                performance — all in one calm surface.
              </p>
            </div>
            <ProductPreview />
          </div>
        </section>

        <section id="features" className="scroll-mt-24 border-b border-line">
          <div className="mx-auto w-full max-w-[1200px] px-5 py-20 sm:px-8 sm:py-24">
            <div className="flex flex-col justify-between gap-5 md:flex-row md:items-end">
              <div className="max-w-[560px]">
                <p className="eyebrow mb-3">Capabilities</p>
                <h2 className="text-[30px] font-semibold leading-[1.08] tracking-[-0.04em] text-fg sm:text-[36px]">
                  A full practice stack.
                </h2>
                <p className="mt-3 max-w-[52ch] text-[13.5px] leading-relaxed text-fg-muted">
                  From conditional orders to risk metrics and copy trading, the
                  simulator covers the parts of trading that are hard to learn
                  without losing money.
                </p>
              </div>
              <Link
                href="/register"
                className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-brand transition-colors hover:text-brand-strong"
              >
                Open your account
                <ArrowRight className="size-3.5" aria-hidden="true" />
              </Link>
            </div>

            <div className="mt-10 grid gap-3 md:grid-cols-3">
              {features.map((feature) => (
                <div
                  key={feature.title}
                  className={`group rounded-[14px] border border-line bg-surface p-5 transition-colors duration-200 hover:border-line-strong ${feature.className || ""}`}
                >
                  <span
                    className={`flex size-9 items-center justify-center rounded-[9px] ${accentMap[feature.accent]}`}
                  >
                    <feature.icon
                      className="size-[18px]"
                      strokeWidth={1.7}
                      aria-hidden="true"
                    />
                  </span>
                  <h3 className="mt-4 text-[14px] font-semibold tracking-[-0.01em] text-fg">
                    {feature.title}
                  </h3>
                  <p className="mt-1.5 text-[12.5px] leading-relaxed text-fg-muted">
                    {feature.description}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="how" className="scroll-mt-24 border-b border-line bg-canvas-deep/40">
          <div className="mx-auto w-full max-w-[1200px] px-5 py-20 sm:px-8 sm:py-24">
            <div className="grid gap-12 lg:grid-cols-[.85fr_1.15fr]">
              <div>
                <p className="eyebrow mb-3">How it works</p>
                <h2 className="text-[30px] font-semibold leading-[1.08] tracking-[-0.04em] text-fg sm:text-[36px]">
                  From zero to a
                  <br />
                  real strategy.
                </h2>
                <p className="mt-4 max-w-[38ch] text-[13.5px] leading-relaxed text-fg-muted">
                  The loop is simple: take a position, watch what happens, and
                  adjust with evidence. Stox gives you the whole loop.
                </p>
                <Link
                  href="/register"
                  className="mt-7 inline-flex h-10 items-center gap-2 rounded-[9px] border border-line-strong px-4 text-[13px] font-medium text-fg transition-colors hover:bg-surface-2"
                >
                  Create your free account
                  <ArrowRight className="size-3.5" aria-hidden="true" />
                </Link>
              </div>

              <div className="grid gap-3">
                {steps.map((step) => (
                  <div
                    key={step.number}
                    className="grid grid-cols-[auto_1fr_auto] items-start gap-4 rounded-[14px] border border-line bg-surface p-5"
                  >
                    <span className="tnum font-mono text-[11px] text-brand">
                      {step.number}
                    </span>
                    <div>
                      <h3 className="text-[14px] font-semibold text-fg">
                        {step.title}
                      </h3>
                      <p className="mt-1 text-[12.5px] leading-relaxed text-fg-muted">
                        {step.description}
                      </p>
                    </div>
                    <span className="flex size-8 items-center justify-center rounded-[8px] border border-line bg-surface-2 text-fg-subtle">
                      <step.icon className="size-4" strokeWidth={1.7} />
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section id="security" className="scroll-mt-24 border-b border-line">
          <div className="mx-auto w-full max-w-[1200px] px-5 py-20 sm:px-8 sm:py-24">
            <div className="overflow-hidden rounded-[20px] border border-line bg-surface">
              <div className="grid lg:grid-cols-2">
                <div className="relative overflow-hidden border-b border-line p-7 sm:p-10 lg:border-b-0 lg:border-r">
                  <div className="grid-lines pointer-events-none absolute inset-0 opacity-60" />
                  <div className="relative">
                    <Badge tone="up" dot className="mb-5">
                      Simulator by design
                    </Badge>
                    <h2 className="max-w-[14ch] text-[28px] font-semibold leading-[1.06] tracking-[-0.04em] text-fg sm:text-[34px]">
                      A safe place to be wrong.
                    </h2>
                    <p className="mt-4 max-w-[40ch] text-[13px] leading-relaxed text-fg-muted">
                      Stox never connects to a broker and never moves real
                      money. Mistakes are data, not losses. That is the point.
                    </p>
                    <div className="mt-8 flex items-center gap-3 rounded-[12px] border border-line bg-canvas/60 px-4 py-3">
                      <span className="flex size-9 items-center justify-center rounded-full bg-up-soft text-up">
                        <ShieldCheck className="size-5" strokeWidth={1.8} />
                      </span>
                      <div>
                        <p className="text-[12px] font-medium text-fg">
                          Virtual funds only
                        </p>
                        <p className="text-[10.5px] text-fg-subtle">
                          No deposits, withdrawals or payment details
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="divide-y divide-line">
                  {simulatorPoints.map((point) => (
                    <div key={point.title} className="flex gap-4 p-6 sm:p-7">
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-[9px] border border-line bg-surface-2 text-fg-muted">
                        <point.icon className="size-[17px]" strokeWidth={1.7} />
                      </span>
                      <div>
                        <h3 className="text-[13.5px] font-semibold text-fg">
                          {point.title}
                        </h3>
                        <p className="mt-1 text-[12.5px] leading-relaxed text-fg-muted">
                          {point.description}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="relative overflow-hidden">
          <div
            className="pointer-events-none absolute inset-0 opacity-70"
            style={{
              background:
                "radial-gradient(50% 70% at 50% 100%, rgba(108,151,255,.16), transparent 70%)",
            }}
          />
          <div className="relative mx-auto w-full max-w-[1200px] px-5 py-20 text-center sm:px-8 sm:py-24">
            <p className="eyebrow mb-4">Ready when you are</p>
            <h2 className="mx-auto max-w-[16ch] text-[34px] font-semibold leading-[1.02] tracking-[-0.045em] text-fg sm:text-[46px]">
              Your first trade is
              <br />
              <span className="text-fg-muted">risk-free.</span>
            </h2>
            <p className="mx-auto mt-5 max-w-[46ch] text-[13.5px] leading-relaxed text-fg-muted">
              Create an account, get $10,000 in virtual capital, and place your
              first order in under a minute.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-2.5">
              <Link
                href="/register"
                className="inline-flex h-11 items-center gap-2 rounded-[10px] bg-brand px-6 text-[14px] font-medium text-brand-ink shadow-[inset_0_1px_0_rgba(255,255,255,.22)] transition-[background-color,transform] duration-[var(--dur-press)] hover:bg-brand-strong active:scale-[0.97]"
              >
                Create free account
                <ArrowRight className="size-4" aria-hidden="true" />
              </Link>
              <Link
                href="/login"
                className="inline-flex h-11 items-center rounded-[10px] border border-line-strong px-6 text-[14px] font-medium text-fg transition-colors hover:bg-surface-2"
              >
                Sign in
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-line bg-canvas-deep/50">
        <div className="mx-auto w-full max-w-[1200px] px-5 py-12 sm:px-8">
          <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
            <div>
              <Logo href="/" size={28} />
              <p className="mt-4 max-w-[32ch] text-[12px] leading-relaxed text-fg-subtle">
                A paper-trading terminal for people who want to learn the craft
                without burning capital.
              </p>
              <p className="mt-5 flex items-center gap-1.5 text-[10.5px] text-fg-subtle">
                <span className="live-dot size-1.5 rounded-full bg-up" />
                Virtual funds. Real market data.
              </p>
            </div>
            <div>
              <p className="eyebrow mb-3">Product</p>
              <ul className="space-y-2 text-[12px] text-fg-muted">
                <li><a href="#product" className="hover:text-fg">Terminal</a></li>
                <li><a href="#features" className="hover:text-fg">Features</a></li>
                <li><Link href="/markets" className="hover:text-fg">Markets</Link></li>
                <li><Link href="/leaderboard" className="hover:text-fg">Leaderboard</Link></li>
              </ul>
            </div>
            <div>
              <p className="eyebrow mb-3">Account</p>
              <ul className="space-y-2 text-[12px] text-fg-muted">
                <li><Link href="/login" className="hover:text-fg">Sign in</Link></li>
                <li><Link href="/register" className="hover:text-fg">Create account</Link></li>
                <li><Link href="/settings" className="hover:text-fg">Settings</Link></li>
                <li><Link href="/notifications" className="hover:text-fg">Notifications</Link></li>
              </ul>
            </div>
            <div>
              <p className="eyebrow mb-3">Transparency</p>
              <ul className="space-y-2 text-[12px] text-fg-muted">
                <li><a href="#security" className="hover:text-fg">Simulator policy</a></li>
                <li><span className="text-fg-subtle">No financial advice</span></li>
                <li><span className="text-fg-subtle">Market data may be delayed</span></li>
              </ul>
            </div>
          </div>
          <div className="mt-10 flex flex-col justify-between gap-3 border-t border-line pt-5 text-[10.5px] text-fg-subtle sm:flex-row">
            <span>© 2026 Stox. All balances are simulated.</span>
            <span>
              Stox is not a broker-dealer and does not execute real trades.
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}
