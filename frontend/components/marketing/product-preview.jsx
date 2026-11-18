import {
  Bell,
  ChartCandlestick,
  LayoutDashboard,
  ListOrdered,
  Search,
  Wallet,
} from "lucide-react";

import { Sparkline } from "@/components/charts/sparkline";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const series = [
  38, 39, 37.5, 40, 41.2, 40.5, 42, 43.8, 43.2, 44.6, 46.1, 45.4, 47.2,
  48.8, 48.1, 49.6, 51.2, 50.4, 52.6, 54.1, 53.4, 55.8, 56.2, 58.4, 57.9,
  60.2, 61.8, 61.1, 63.4, 65.2,
];

const holdings = [
  { symbol: "NVDA", name: "NVIDIA", qty: "12.00", value: "$6,284.40", pnl: "+8.42%", up: true },
  { symbol: "BTC", name: "Bitcoin", qty: "0.084", value: "$5,412.20", pnl: "+3.10%", up: true },
  { symbol: "AAPL", name: "Apple", qty: "18.00", value: "$3,878.10", pnl: "-0.64%", up: false },
];

export function ProductPreview() {
  return (
    <div className="relative mx-auto w-full max-w-[980px]">
      <div
        className="absolute -inset-10 -z-10 rounded-full opacity-50 blur-[80px]"
        style={{
          background:
            "radial-gradient(50% 50% at 50% 50%, rgba(108,151,255,.18), transparent 70%)",
        }}
      />
      <div className="rounded-[20px] border border-line bg-canvas p-1.5 shadow-[0_40px_100px_rgba(0,0,0,.45)] sm:p-2">
        <div className="overflow-hidden rounded-[15px] border border-line bg-surface">
          <div className="flex h-9 items-center gap-2 border-b border-line bg-canvas px-3">
            <span className="flex gap-1.5" aria-hidden="true">
              <span className="size-2 rounded-full bg-[#ff5f57]/70" />
              <span className="size-2 rounded-full bg-[#febc2e]/70" />
              <span className="size-2 rounded-full bg-[#28c840]/70" />
            </span>
            <span className="mx-auto flex h-5 w-40 items-center justify-center rounded-[4px] border border-line bg-surface-2 text-[8px] text-fg-subtle">
              app.stox.local/dashboard
            </span>
          </div>

          <div className="flex">
            <aside className="hidden w-[150px] shrink-0 border-r border-line bg-canvas/60 p-2.5 sm:block">
              <div className="mb-3 flex items-center gap-1.5 px-1">
                <span className="flex size-5 items-center justify-center rounded-[5px] bg-[#101728]">
                  <span className="flex items-end gap-[2px]">
                    <span className="h-1.5 w-[3px] rounded-sm bg-brand" />
                    <span className="h-2.5 w-[3px] rounded-sm bg-brand/70" />
                    <span className="h-3.5 w-[3px] rounded-sm bg-brand/40" />
                  </span>
                </span>
                <span className="text-[10px] font-semibold tracking-[-0.04em] text-fg">
                  stox<span className="text-brand">.</span>
                </span>
              </div>
              <div className="mb-3 rounded-[6px] border border-line bg-surface-2 p-1.5">
                <p className="text-[7.5px] uppercase tracking-[0.08em] text-fg-subtle">
                  Portfolio
                </p>
                <p className="text-[9px] font-medium text-fg">Main Portfolio</p>
                <p className="tnum text-[7.5px] text-fg-subtle">$8,420 available</p>
              </div>
              <div className="space-y-0.5">
                {[
                  { icon: LayoutDashboard, label: "Dashboard", active: true },
                  { icon: ChartCandlestick, label: "Markets" },
                  { icon: Wallet, label: "Portfolios" },
                  { icon: ListOrdered, label: "Orders" },
                  { icon: Bell, label: "Alerts" },
                ].map((item) => (
                  <div
                    key={item.label}
                    className={cn(
                      "flex items-center gap-1.5 rounded-[4px] px-1.5 py-1 text-[8px]",
                      item.active
                        ? "bg-brand-soft text-brand"
                        : "text-fg-subtle",
                    )}
                  >
                    <item.icon className="size-2.5" strokeWidth={1.8} />
                    {item.label}
                  </div>
                ))}
              </div>
            </aside>

            <div className="min-w-0 flex-1">
              <div className="flex h-9 items-center gap-2 border-b border-line px-3">
                <span className="flex h-5 flex-1 items-center gap-1.5 rounded-[4px] border border-line bg-surface-2 px-1.5 text-[7.5px] text-fg-subtle">
                  <Search className="size-2.5" />
                  Search markets…
                </span>
                <span className="size-4 rounded-full bg-gradient-to-br from-[#3b5bdb] to-[#6c97ff]" />
              </div>

              <div className="space-y-2 p-3">
                <div className="flex items-end justify-between">
                  <div>
                    <p className="text-[7.5px] uppercase tracking-[0.08em] text-fg-subtle">
                      Total value
                    </p>
                    <p className="tnum text-[16px] font-semibold leading-none tracking-[-0.03em] text-fg">
                      $24,820.70
                    </p>
                  </div>
                  <Badge tone="up" className="h-3.5 px-1.5 text-[6.5px]">
                    +4.82% today
                  </Badge>
                </div>

                <div className="grid grid-cols-3 gap-1.5">
                  {[
                    ["Cash", "$8,420.00"],
                    ["Invested", "$16,400.70"],
                    ["Return", "+$2,140.30"],
                  ].map(([label, value]) => (
                    <div
                      key={label}
                      className="rounded-[5px] border border-line bg-surface-2/60 px-2 py-1.5"
                    >
                      <p className="text-[6.5px] uppercase tracking-[0.08em] text-fg-subtle">
                        {label}
                      </p>
                      <p className="tnum text-[9px] font-medium text-fg">{value}</p>
                    </div>
                  ))}
                </div>

                <div className="rounded-[6px] border border-line bg-surface-2/40 p-2">
                  <div className="mb-1 flex items-center justify-between">
                    <p className="text-[7.5px] font-medium text-fg">
                      Portfolio value
                    </p>
                    <p className="text-[6.5px] text-fg-subtle">30D</p>
                  </div>
                  <Sparkline
                    data={series}
                    width={520}
                    height={64}
                    tone="brand"
                    ariaLabel="Illustrative portfolio value trend"
                    className="w-full"
                  />
                </div>

                <div className="rounded-[6px] border border-line">
                  <div className="grid grid-cols-[1fr_auto_auto] gap-2 border-b border-line px-2 py-1 text-[6.5px] uppercase tracking-[0.08em] text-fg-subtle">
                    <span>Holding</span>
                    <span className="text-right">Value</span>
                    <span className="w-12 text-right">P&L</span>
                  </div>
                  {holdings.map((holding) => (
                    <div
                      key={holding.symbol}
                      className="grid grid-cols-[1fr_auto_auto] items-center gap-2 border-b border-line/50 px-2 py-1.5 last:border-0"
                    >
                      <span className="flex items-center gap-1.5">
                        <span className="flex size-4 items-center justify-center rounded-full bg-surface-3 text-[6px] font-semibold text-fg-muted">
                          {holding.symbol.slice(0, 2)}
                        </span>
                        <span>
                          <span className="block text-[8px] font-medium leading-tight text-fg">
                            {holding.symbol}
                          </span>
                          <span className="block text-[6.5px] leading-tight text-fg-subtle">
                            {holding.qty} shares
                          </span>
                        </span>
                      </span>
                      <span className="tnum text-right text-[8px] text-fg">
                        {holding.value}
                      </span>
                      <span
                        className={cn(
                          "tnum w-12 text-right text-[7.5px]",
                          holding.up ? "text-up" : "text-down",
                        )}
                      >
                        {holding.pnl}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <Badge
        tone="outline"
        className="absolute -bottom-3 left-1/2 -translate-x-1/2 bg-canvas text-[9px]"
      >
        Illustrative preview · virtual funds
      </Badge>
    </div>
  );
}
