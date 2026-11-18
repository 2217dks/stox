"use client";

import {
  CartesianGrid,
  Line,
  LineChart as RechartsLineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { formatDate, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

function LineTooltip({ active, payload, label, valueFormatter }) {
  if (!active || !payload?.length) return null;

  return (
    <div className="rounded-[8px] border border-line bg-surface px-2.5 py-2 shadow-[var(--shadow-pop)]">
      <p className="text-[10px] uppercase tracking-[0.07em] text-fg-subtle">
        {formatDate(label, { month: "short", day: "numeric", year: undefined })}
      </p>
      <div className="mt-1 space-y-0.5">
        {payload.map((item) => (
          <div key={item.dataKey} className="flex items-center gap-2 text-[11px]">
            <span
              className="size-1.5 rounded-full"
              style={{ background: item.color }}
              aria-hidden="true"
            />
            <span className="text-fg-muted">{item.name}</span>
            <span className="tnum ml-auto font-medium text-fg">
              {valueFormatter ? valueFormatter(item.value) : formatNumber(item.value)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function LineChart({
  data = [],
  xKey = "date",
  series = [],
  height = 240,
  className,
  yFormatter = (value) => formatNumber(value, { maximumFractionDigits: 2 }),
  ariaLabel = "Line chart",
}) {
  return (
    <div
      className={cn("w-full", className)}
      style={{ height }}
      role="img"
      aria-label={ariaLabel}
    >
      <ResponsiveContainer width="100%" height="100%">
        <RechartsLineChart data={data} margin={{ top: 6, right: 2, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
          <XAxis
            dataKey={xKey}
            axisLine={false}
            tickLine={false}
            minTickGap={28}
            tick={{ fill: "var(--fg-subtle)", fontSize: 10 }}
            tickFormatter={(value) =>
              formatDate(value, { month: "short", day: "numeric", year: undefined })
            }
            dy={6}
          />
          <YAxis
            axisLine={false}
            tickLine={false}
            width={52}
            tick={{ fill: "var(--fg-subtle)", fontSize: 10, fontFamily: "var(--font-geist-mono)" }}
            tickFormatter={yFormatter}
          />
          <Tooltip content={<LineTooltip valueFormatter={yFormatter} />} />
          {series.map((item) => (
            <Line
              key={item.key}
              type="monotone"
              dataKey={item.key}
              name={item.label}
              stroke={item.color}
              strokeWidth={1.8}
              dot={false}
              activeDot={{ r: 3, strokeWidth: 2, stroke: "var(--surface)" }}
              isAnimationActive={false}
              connectNulls
            />
          ))}
        </RechartsLineChart>
      </ResponsiveContainer>
    </div>
  );
}
