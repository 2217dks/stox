"use client";

import { useId } from "react";
import {
  Area,
  AreaChart as RechartsAreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { formatCompact, formatCurrency, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

function ChartTooltip({ active, payload, label, valueFormatter, labelFormatter }) {
  if (!active || !payload?.length) return null;
  const value = payload[0].value;

  return (
    <div className="rounded-[8px] border border-line bg-surface px-2.5 py-2 shadow-[var(--shadow-pop)]">
      <p className="text-[10px] uppercase tracking-[0.07em] text-fg-subtle">
        {labelFormatter ? labelFormatter(label) : label}
      </p>
      <p className="tnum mt-0.5 text-[12.5px] font-semibold text-fg">
        {valueFormatter ? valueFormatter(value) : value}
      </p>
    </div>
  );
}

export function AreaChart({
  data = [],
  xKey = "date",
  yKey = "value",
  height = 240,
  tone = "brand",
  currency = true,
  compactY = true,
  showGrid = true,
  xTickFormatter,
  tooltipLabelFormatter,
  className,
  ariaLabel = "Area chart",
}) {
  const gradientId = useId().replace(/:/g, "");
  const colors = {
    brand: "var(--brand)",
    up: "var(--up)",
    down: "var(--down)",
    warn: "var(--warn)",
    violet: "var(--violet)",
    cyan: "var(--cyan)",
  };
  const color = colors[tone] || colors.brand;

  return (
    <div
      className={cn("w-full", className)}
      style={{ height }}
      role="img"
      aria-label={ariaLabel}
    >
      <ResponsiveContainer width="100%" height="100%">
        <RechartsAreaChart data={data} margin={{ top: 6, right: 2, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.26} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          {showGrid ? (
            <CartesianGrid
              vertical={false}
              stroke="var(--chart-grid)"
              strokeDasharray="0"
            />
          ) : null}
          <XAxis
            dataKey={xKey}
            axisLine={false}
            tickLine={false}
            minTickGap={28}
            tick={{ fill: "var(--fg-subtle)", fontSize: 10, fontFamily: "var(--font-geist-mono)" }}
            tickFormatter={xTickFormatter || ((value) => formatDate(value, { month: "short", day: "numeric", year: undefined }))}
            dy={6}
          />
          <YAxis
            axisLine={false}
            tickLine={false}
            width={52}
            tick={{ fill: "var(--fg-subtle)", fontSize: 10, fontFamily: "var(--font-geist-mono)" }}
            tickFormatter={(value) =>
              compactY
                ? formatCompact(value)
                : currency
                  ? formatCurrency(value, { showSymbol: false })
                  : value
            }
          />
          <Tooltip
            cursor={{ stroke: "var(--line-strong)", strokeDasharray: "3 3" }}
            content={
              <ChartTooltip
                valueFormatter={(value) =>
                  currency ? formatCurrency(value) : value
                }
                labelFormatter={tooltipLabelFormatter}
              />
            }
          />
          <Area
            type="monotone"
            dataKey={yKey}
            stroke={color}
            strokeWidth={1.8}
            fill={`url(#${gradientId})`}
            isAnimationActive={false}
            activeDot={{
              r: 3.5,
              fill: color,
              stroke: "var(--surface)",
              strokeWidth: 2,
            }}
          />
        </RechartsAreaChart>
      </ResponsiveContainer>
    </div>
  );
}
