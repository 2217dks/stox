"use client";

import { cn } from "@/lib/utils";

export function SegmentedControl({
  options = [],
  value,
  onChange,
  size = "md",
  className,
  ariaLabel = "View",
  fullWidth = false,
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn(
        "inline-flex items-center gap-0.5 rounded-[9px] border border-line bg-surface-2 p-[3px]",
        fullWidth && "flex w-full",
        className,
      )}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange?.(option.value)}
            className={cn(
              "relative inline-flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-[7px] font-medium transition-[background-color,color] duration-[var(--dur-fast)] ease-[var(--ease-out)]",
              size === "sm" ? "h-7 px-2.5 text-[11.5px]" : "h-8 px-3 text-[12.5px]",
              active
                ? "bg-surface text-fg shadow-[0_1px_2px_rgba(0,0,0,.18)]"
                : "text-fg-muted hover:text-fg",
            )}
          >
            {option.icon ? <option.icon className="size-3.5" aria-hidden="true" /> : null}
            {option.label}
            {option.count !== undefined ? (
              <span
                className={cn(
                  "tnum text-[10px]",
                  active ? "text-fg-subtle" : "text-fg-subtle/70",
                )}
              >
                {option.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
