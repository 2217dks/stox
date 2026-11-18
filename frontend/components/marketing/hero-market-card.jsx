"use client";

import useSWR from "swr";
import { ArrowUpRight, Radio } from "lucide-react";

import { Sparkline } from "@/components/charts/sparkline";
import { Badge } from "@/components/ui/badge";
import { marketApi } from "@/lib/endpoints";
import { useMarketStream, useQuote } from "@/lib/hooks";
import { formatCurrency, formatPercent, formatQuantity } from "@/lib/format";
import { cn } from "@/lib/utils";

export function HeroMarketCard() {
  const { quote } = useQuote("BTCUSDT", "CRYPTO", { refreshInterval: 60000 });
  const tick = useMarketStream("BTCUSDT", "CRYPTO");
  const livePrice = tick?.price || quote?.price;
  const { data: history } = useSWR(
    "landing:btc:history",
    async () => {
      const to = Date.now();
      const from = to - 1000 * 60 * 60 * 36;
      return marketApi.history("BTCUSDT", {
        interval: "1h",
        from,
        to,
        limit: 48,
        assetClass: "CRYPTO",
      });
    },
    { refreshInterval: 180000, shouldRetryOnError: false },
  );

  const prices = (history?.prices ?? []).map((candle) => Number(candle.close));
  const change = Number(quote?.changePercent ?? 0);
  const isUp = change >= 0;

  return (
    <div className="relative">
      <div
        className="absolute -inset-6 -z-10 rounded-[32px] opacity-60 blur-[50px]"
        style={{
          background:
            "radial-gradient(60% 60% at 70% 30%, rgba(108,151,255,.26), transparent 70%)",
        }}
      />
      <div className="overflow-hidden rounded-[18px] border border-line bg-surface/90 shadow-[var(--shadow-modal)] backdrop-blur">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <div className="flex items-center gap-2.5">
            <span className="flex size-7 items-center justify-center rounded-full bg-[#F7931A]/12 font-mono text-[11px] font-bold text-[#F7931A]">
              ₿
            </span>
            <div>
              <p className="text-[12px] font-semibold leading-tight text-fg">
                BTC / USDT
              </p>
              <p className="text-[10px] leading-tight text-fg-subtle">
                Bitcoin · Binance
              </p>
            </div>
          </div>
          <Badge tone="up" dot pulse>
            Live
          </Badge>
        </div>

        <div className="px-4 pb-3 pt-4">
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="tnum text-[30px] font-semibold leading-none tracking-[-0.04em] text-fg">
                {livePrice ? formatCurrency(livePrice) : "—"}
              </p>
              <p
                className={cn(
                  "tnum mt-1.5 flex items-center gap-1 text-[12px]",
                  isUp ? "text-up" : "text-down",
                )}
              >
                {quote?.changePercent != null ? (
                  <>
                    <ArrowUpRight
                      className={cn("size-3.5", !isUp && "rotate-90")}
                      aria-hidden="true"
                    />
                    {formatPercent(change)}{" "}
                    <span className="text-fg-subtle">24h</span>
                  </>
                ) : (
                  <span className="text-fg-subtle">Waiting for quote…</span>
                )}
              </p>
            </div>
            <div className="text-right">
              <p className="text-[9.5px] uppercase tracking-[0.08em] text-fg-subtle">
                Volume
              </p>
              <p className="tnum mt-0.5 text-[11.5px] text-fg-muted">
                {quote?.volume ? formatQuantity(quote.volume, 0) : "—"}
              </p>
            </div>
          </div>

          <div className="mt-3 -mx-1">
            {prices.length > 1 ? (
              <Sparkline
                data={prices}
                width={420}
                height={112}
                strokeWidth={1.6}
                tone={isUp ? "up" : "down"}
                ariaLabel={`Bitcoin price trend over the last 36 hours, ${
                  isUp ? "up" : "down"
                } ${Math.abs(change).toFixed(2)} percent`}
                className="w-full"
              />
            ) : (
              <div
                className="h-[112px] w-full rounded-[8px] border border-dashed border-line bg-surface-2/40"
                aria-hidden="true"
              />
            )}
          </div>

          <div className="mt-2 grid grid-cols-3 divide-x divide-line rounded-[9px] border border-line bg-surface-2/50">
            {[
              { label: "24h high", value: quote?.high },
              { label: "24h low", value: quote?.low },
              { label: "Open", value: quote?.open },
            ].map((stat) => (
              <div key={stat.label} className="px-2.5 py-2">
                <p className="text-[9.5px] uppercase tracking-[0.07em] text-fg-subtle">
                  {stat.label}
                </p>
                <p className="tnum mt-0.5 text-[11px] text-fg">
                  {stat.value ? formatCurrency(stat.value) : "—"}
                </p>
              </div>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-line bg-surface-2/40 px-4 py-2.5">
          <span className="flex items-center gap-1.5 text-[10px] text-fg-subtle">
            <Radio className="size-3 text-up" aria-hidden="true" />
            Binance market stream
          </span>
          <span className="tnum text-[10px] text-fg-subtle">
            {tick?.timestamp || quote?.timestamp
              ? new Date(tick?.timestamp || quote.timestamp).toLocaleTimeString(
                  "en-US",
                  { hour12: false },
                )
              : "—"}{" "}
            UTC
          </span>
        </div>
      </div>

      <div className="absolute -bottom-5 -left-6 hidden w-[190px] rounded-[12px] border border-line bg-surface p-3 shadow-[var(--shadow-pop)] sm:block">
        <p className="text-[9.5px] uppercase tracking-[0.08em] text-fg-subtle">
          Simulated P&L
        </p>
        <p className="tnum mt-1 text-[17px] font-semibold text-up">+$1,284.40</p>
        <p className="text-[9.5px] text-fg-subtle">
          Illustrative · virtual funds
        </p>
      </div>
    </div>
  );
}
