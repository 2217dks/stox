"use client";

import {
  Bar,
  BarChart as RechartsBarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { formatCompact, formatCurrency, monthLabel } from "@/lib/format";

function BarTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const value = Number(payload[0].value);

  return (
    <div className="rounded-[8px] border border-line bg-surface px-2.5 py-2 shadow-[var(--shadow-pop)]">
      <p className="text-[10px] uppercase tracking-[0.07em] text-fg-subtle">
        {/^\d{4}-\d{2}$/.test(label)
          ? monthLabel(`${label}-01T00:00:00Z`)
          : label}
      </p>
      <p
        className={`tnum mt-0.5 text-[12.5px] font-semibold ${
          value > 0 ? "text-up" : value < 0 ? "text-down" : "text-fg"
        }`}
      >
        {formatCurrency(value, { signed: true })}
      </p>
    </div>
  );
}

export function MonthlyBarChart({
  data = [],
  xKey = "month",
  yKey = "netPnl",
  height = 220,
  className,
  ariaLabel = "Monthly performance",
}) {
  return (
    <div
      className={className}
      style={{ height }}
      role="img"
      aria-label={ariaLabel}
    >
      <ResponsiveContainer width="100%" height="100%">
        <RechartsBarChart data={data} margin={{ top: 8, right: 2, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
          <XAxis
            dataKey={xKey}
            axisLine={false}
            tickLine={false}
            tick={{ fill: "var(--fg-subtle)", fontSize: 10 }}
            tickFormatter={(value) => monthLabel(`${value}-01T00:00:00Z`)}
            dy={6}
          />
          <YAxis
            axisLine={false}
            tickLine={false}
            width={48}
            tick={{ fill: "var(--fg-subtle)", fontSize: 10, fontFamily: "var(--font-geist-mono)" }}
            tickFormatter={(value) => formatCompact(value)}
          />
          <ReferenceLine y={0} stroke="var(--line-strong)" strokeWidth={1} />
          <Tooltip cursor={{ fill: "var(--surface-2)" }} content={<BarTooltip />} />
          <Bar dataKey={yKey} radius={[3, 3, 0, 0]} maxBarSize={28} isAnimationActive={false}>
            {data.map((entry, index) => {
              const value = Number(entry[yKey] || 0);
              return (
                <Cell
                  key={`${entry[xKey]}-${index}`}
                  fill={value >= 0 ? "var(--up)" : "var(--down)"}
                  fillOpacity={0.8}
                />
              );
            })}
          </Bar>
        </RechartsBarChart>
      </ResponsiveContainer>
    </div>
  );
}
