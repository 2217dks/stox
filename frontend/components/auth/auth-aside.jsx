"use client";

import Link from "next/link";
import { ArrowUpRight, ShieldCheck, Sparkles, Trophy } from "lucide-react";

import { Logo } from "@/components/ui/logo";
import { useQuotes } from "@/lib/hooks";
import { formatCurrency, formatPercent, tickerOf } from "@/lib/format";
import { cn } from "@/lib/utils";

const symbols = ["BTCUSDT", "ETHUSDT", "SOLUSDT"];

const proof = [
  { icon: Sparkles, label: "$10,000 virtual capital on every portfolio" },
  { icon: Trophy, label: "Leaderboards, leagues and copy trading" },
  { icon: ShieldCheck, label: "Risk-free practice with real market data" },
];

export function AuthAside() {
  const { quotes } = useQuotes(symbols, {});

  return (
    <aside className="relative hidden overflow-hidden border-r border-line bg-canvas-deep px-12 py-10 lg:flex lg:flex-col">
      <div className="grid-lines pointer-events-none absolute inset-0 opacity-70" />
      <div
        className="pointer-events-none absolute -right-32 -top-32 size-[520px] rounded-full opacity-40 blur-[100px]"
        style={{
          background:
            "radial-gradient(circle, rgba(108,151,255,.36), transparent 65%)",
        }}
      />

      <div className="relative z-10 flex items-center justify-between">
        <Logo href="/" size={30} />
        <Link
          href="/markets"
          className="text-[11.5px] font-medium text-fg-subtle transition-colors hover:text-fg"
        >
          Explore markets ↗
        </Link>
      </div>

      <div className="relative z-10 my-auto max-w-[460px] py-12">
        <p className="eyebrow mb-4 flex items-center gap-2">
          <span className="live-dot size-1.5 rounded-full bg-up" />
          Paper trading · real markets
        </p>
        <h2 className="text-[46px] font-semibold leading-[0.98] tracking-[-0.05em] text-fg">
          Trade the market.
          <br />
          <span className="text-fg-muted">Risk nothing.</span>
        </h2>
        <p className="mt-5 max-w-[38ch] text-[13.5px] leading-relaxed text-fg-muted">
          A professional trading terminal for stocks and crypto. Build a
          strategy, track performance and compete — with virtual capital.
        </p>

        <div className="mt-8 space-y-2.5">
          {proof.map((item) => (
            <div key={item.label} className="flex items-center gap-2.5">
              <span className="flex size-6 items-center justify-center rounded-[7px] border border-line bg-surface text-fg-subtle">
                <item.icon className="size-3.5" strokeWidth={1.7} />
              </span>
              <span className="text-[12px] text-fg-muted">{item.label}</span>
            </div>
          ))}
        </div>

        <div className="mt-9 rounded-[14px] border border-line bg-surface/80 p-1.5 shadow-[var(--shadow-pop)] backdrop-blur">
          <div className="flex items-center justify-between px-3 pb-2 pt-2">
            <span className="text-[10.5px] uppercase tracking-[0.09em] text-fg-subtle">
              Live crypto
            </span>
            <span className="flex items-center gap-1.5 text-[10.5px] text-fg-subtle">
              <span className="live-dot size-1.5 rounded-full bg-up" />
              Streaming
            </span>
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {symbols.map((symbol) => {
              const quote = quotes[symbol];
              const change = Number(quote?.changePercent ?? 0);
              return (
                <div
                  key={symbol}
                  className="rounded-[10px] border border-line bg-surface-2/60 px-3 py-2.5"
                >
                  <p className="text-[11px] font-medium text-fg">
                    {tickerOf(symbol)}
                  </p>
                  <p className="tnum mt-1.5 text-[13px] font-semibold text-fg">
                    {quote ? formatCurrency(quote.price) : "—"}
                  </p>
                  <p
                    className={cn(
                      "tnum mt-0.5 flex items-center gap-0.5 text-[10.5px]",
                      change > 0
                        ? "text-up"
                        : change < 0
                          ? "text-down"
                          : "text-fg-subtle",
                    )}
                  >
                    {quote ? (
                      <>
                        <ArrowUpRight
                          className={cn("size-3", change < 0 && "rotate-90")}
                          aria-hidden="true"
                        />
                        {formatPercent(change)}
                      </>
                    ) : (
                      "—"
                    )}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="relative z-10 flex items-center gap-4 text-[10.5px] text-fg-subtle">
        <span>© 2026 Stox</span>
        <span className="text-line-strong">·</span>
        <span>Virtual funds only</span>
      </div>
    </aside>
  );
}
