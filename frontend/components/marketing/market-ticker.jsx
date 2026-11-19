"use client";

import Link from "next/link";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";

import { useQuotes } from "@/lib/hooks";
import { formatCurrency, formatPercent, tickerOf } from "@/lib/format";
import { cn } from "@/lib/utils";

const symbols = [
  "BTCUSDT",
  "ETHUSDT",
  "SOLUSDT",
  "BNBUSDT",
  "XRPUSDT",
  "DOGEUSDT",
  "AAPL",
  "NVDA",
  "TSLA",
  "MSFT",
];

export function MarketTicker() {
  // No polling: the market socket streams ticks, and the global API limiter
  // is tight enough that an idle landing tab would exhaust it.
  const { quotes } = useQuotes(symbols, {
    AAPL: "STOCK",
    NVDA: "STOCK",
    TSLA: "STOCK",
    MSFT: "STOCK",
  });

  const items = symbols.map((symbol) => ({
    symbol,
    quote: quotes[symbol],
    asset:
      symbol === "AAPL" || symbol === "NVDA" || symbol === "TSLA" || symbol === "MSFT"
        ? "STOCK"
        : "CRYPTO",
  }));

  return (
    <div
      className="relative overflow-hidden border-y border-line bg-canvas-deep/70 py-2.5 mask-fade-x"
      aria-label="Live market prices"
    >
      <div className="flex w-max animate-marquee items-center gap-7 pr-7">
        {[...items, ...items].map((item, index) => {
          const change = Number(item.quote?.changePercent ?? 0);
          const isUp = change >= 0;

          return (
            <Link
              key={`${item.symbol}-${index}`}
              href={`/markets/${item.symbol}?asset=${item.asset}`}
              aria-hidden={index >= items.length}
              tabIndex={index >= items.length ? -1 : 0}
              className="group flex shrink-0 items-center gap-2.5 rounded-[5px] px-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            >
              <span className="text-[11px] font-semibold tracking-[0.02em] text-fg-muted transition-colors group-hover:text-fg">
                {tickerOf(item.symbol)}
              </span>
              <span className="tnum text-[11.5px] text-fg">
                {item.quote ? formatCurrency(item.quote.price) : "—"}
              </span>
              {item.quote?.changePercent != null ? (
                <span
                  className={cn(
                    "tnum inline-flex items-center gap-0.5 text-[10.5px]",
                    isUp ? "text-up" : "text-down",
                  )}
                >
                  {isUp ? (
                    <ArrowUpRight className="size-2.5" aria-hidden="true" />
                  ) : (
                    <ArrowDownRight className="size-2.5" aria-hidden="true" />
                  )}
                  {formatPercent(item.quote.changePercent)}
                </span>
              ) : (
                <span className="text-[10.5px] text-fg-subtle">—</span>
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
