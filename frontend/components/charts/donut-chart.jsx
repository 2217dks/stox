"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

import { formatCurrency, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";

const palette = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--fg-subtle)",
];

function DonutTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const item = payload[0];
  return (
    <div className="rounded-[8px] border border-line bg-surface px-2.5 py-2 shadow-[var(--shadow-pop)]">
      <p className="text-[10px] uppercase tracking-[0.07em] text-fg-subtle">
        {item.name}
      </p>
      <p className="tnum mt-0.5 text-[12.5px] font-semibold text-fg">
        {formatCurrency(item.value)}
      </p>
      <p className="tnum text-[10.5px] text-fg-muted">
        {formatPercent(item.payload?.weight, { signed: false })} of portfolio
      </p>
    </div>
  );
}

export function DonutChart({
  data = [],
  centerLabel,
  centerValue,
  height = 200,
  className,
  ariaLabel = "Allocation",
}) {
  const total = data.reduce((sum, item) => sum + Number(item.value || 0), 0);
  const enriched = data.map((item, index) => ({
    ...item,
    color: item.color || palette[index % palette.length],
    weight: total ? (Number(item.value) / total) * 100 : 0,
  }));

  return (
    <div
      className={cn("relative w-full", className)}
      style={{ height }}
      role="img"
      aria-label={ariaLabel}
    >
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={enriched}
            dataKey="value"
            nameKey="name"
            innerRadius="68%"
            outerRadius="92%"
            paddingAngle={1.5}
            strokeWidth={0}
            isAnimationActive={false}
          >
            {enriched.map((item) => (
              <Cell key={item.name} fill={item.color} />
            ))}
          </Pie>
          <Tooltip content={<DonutTooltip />} />
        </PieChart>
      </ResponsiveContainer>
      {centerValue ? (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[9.5px] uppercase tracking-[0.08em] text-fg-subtle">
            {centerLabel}
          </span>
          <span className="tnum mt-0.5 text-[17px] font-semibold tracking-[-0.02em] text-fg">
            {centerValue}
          </span>
        </div>
      ) : null}
    </div>
  );
}

export function AllocationLegend({ data = [], className }) {
  const total = data.reduce((sum, item) => sum + Number(item.value || 0), 0);

  return (
    <ul className={cn("space-y-2", className)}>
      {data.map((item, index) => {
        const weight = total ? (Number(item.value) / total) * 100 : 0;
        return (
          <li key={item.name} className="flex items-center gap-2.5 text-[12px]">
            <span
              className="size-2 shrink-0 rounded-full"
              style={{
                background: item.color || palette[index % palette.length],
              }}
              aria-hidden="true"
            />
            <span className="min-w-0 flex-1 truncate text-fg-muted">
              {item.name}
            </span>
            <span className="tnum text-fg">{formatCurrency(item.value)}</span>
            <span className="tnum w-11 text-right text-fg-subtle">
              {weight.toFixed(1)}%
            </span>
          </li>
        );
      })}
    </ul>
  );
}
