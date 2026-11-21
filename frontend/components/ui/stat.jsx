import { ArrowDownRight, ArrowUpRight } from "lucide-react";

import { cn } from "@/lib/utils";

export function Stat({
  label,
  value,
  delta,
  deltaLabel,
  icon: Icon,
  hint,
  tone,
  className,
  children,
}) {
  // delta is often a formatted string ("+1.23%"), so Number() would be NaN; parseFloat reads the sign.
  const deltaValue = Number.parseFloat(delta);
  const deltaTone =
    tone ||
    (Number.isNaN(deltaValue) || deltaValue === 0
      ? "flat"
      : deltaValue > 0
        ? "up"
        : "down");

  return (
    <div className={cn("panel group relative overflow-hidden p-4 sm:p-5", className)}>
      <div className="flex items-start justify-between gap-3">
        <p className="eyebrow">{label}</p>
        {Icon ? (
          <Icon
            className="size-4 text-fg-subtle transition-colors group-hover:text-fg-muted"
            strokeWidth={1.6}
            aria-hidden="true"
          />
        ) : null}
      </div>
      <p className="tnum mt-2.5 text-[26px] font-semibold leading-none tracking-[-0.035em] text-fg sm:text-[28px]">
        {value}
      </p>
      <div className="mt-2.5 flex min-h-[18px] items-center gap-2">
        {delta !== undefined && delta !== null ? (
          <span
            className={cn(
              "tnum inline-flex items-center gap-1 text-[12px] font-medium",
              deltaTone === "up"
                ? "text-up"
                : deltaTone === "down"
                  ? "text-down"
                  : "text-fg-muted",
            )}
          >
            {deltaTone === "up" ? (
              <ArrowUpRight className="size-3.5" aria-hidden="true" />
            ) : deltaTone === "down" ? (
              <ArrowDownRight className="size-3.5" aria-hidden="true" />
            ) : null}
            {delta}
          </span>
        ) : null}
        {deltaLabel ? (
          <span className="truncate text-[11.5px] text-fg-subtle">
            {deltaLabel}
          </span>
        ) : null}
      </div>
      {hint ? <p className="mt-1 text-[11.5px] text-fg-subtle">{hint}</p> : null}
      {children}
    </div>
  );
}
