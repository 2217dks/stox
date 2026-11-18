"use client";

import { useId } from "react";

import { cn } from "@/lib/utils";

export function Sparkline({
  data = [],
  width = 120,
  height = 36,
  strokeWidth = 1.5,
  tone = "brand",
  fill = true,
  className,
  ariaLabel = "Trend",
}) {
  const gradientId = useId().replace(/:/g, "");
  const values = data
    .map((point) => (typeof point === "number" ? point : Number(point?.value ?? point?.close ?? point)))
    .filter((value) => Number.isFinite(value));

  if (values.length < 2) {
    return (
      <div
        className={cn("rounded-[4px] bg-surface-2", className)}
        style={{ width, height }}
        aria-hidden="true"
      />
    );
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const padding = strokeWidth;
  const innerWidth = width - padding * 2;
  const innerHeight = height - padding * 2;

  const points = values.map((value, index) => {
    const x = padding + (index / (values.length - 1)) * innerWidth;
    const y = padding + (1 - (value - min) / range) * innerHeight;
    return [x, y];
  });

  const line = points
    .map(([x, y], index) => `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`)
    .join(" ");
  const area = `${line} L${points.at(-1)[0].toFixed(2)},${height} L${points[0][0].toFixed(2)},${height} Z`;

  const colors = {
    brand: "var(--brand)",
    up: "var(--up)",
    down: "var(--down)",
    warn: "var(--warn)",
    violet: "var(--violet)",
    neutral: "var(--fg-muted)",
  };
  const color = colors[tone] || colors.brand;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cn("overflow-visible", className)}
      role="img"
      aria-label={ariaLabel}
    >
      {fill ? (
        <>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.24" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={area} fill={`url(#${gradientId})`} />
        </>
      ) : null}
      <path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
