"use client";

import * as SwitchPrimitive from "@radix-ui/react-switch";
import { useId } from "react";

import { cn } from "@/lib/utils";

export function Switch({ className, label, description, id, ...props }) {
  const generatedId = useId();
  const inputId = id || generatedId;

  if (label) {
    return (
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <label
            htmlFor={inputId}
            className="block text-[13px] font-medium leading-snug text-fg"
          >
            {label}
          </label>
          {description ? (
            <p className="mt-0.5 text-[11.5px] leading-snug text-fg-subtle">
              {description}
            </p>
          ) : null}
        </div>
        <SwitchPrimitive.Root
          id={inputId}
          className={cn(
            "relative inline-flex h-[22px] w-[38px] shrink-0 cursor-pointer items-center rounded-full border border-line bg-surface-3 transition-colors duration-[var(--dur-fast)] data-[state=checked]:border-brand data-[state=checked]:bg-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-45",
            className,
          )}
          {...props}
        >
          <SwitchPrimitive.Thumb className="block size-[16px] translate-x-[2px] rounded-full bg-fg-muted shadow-sm transition-transform duration-[var(--dur-fast)] ease-[var(--ease-out)] data-[state=checked]:translate-x-[18px] data-[state=checked]:bg-brand-ink" />
        </SwitchPrimitive.Root>
      </div>
    );
  }

  return (
    <SwitchPrimitive.Root
      id={inputId}
      className={cn(
        "relative inline-flex h-[22px] w-[38px] shrink-0 cursor-pointer items-center rounded-full border border-line bg-surface-3 transition-colors duration-[var(--dur-fast)] data-[state=checked]:border-brand data-[state=checked]:bg-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-45",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="block size-[16px] translate-x-[2px] rounded-full bg-fg-muted shadow-sm transition-transform duration-[var(--dur-fast)] ease-[var(--ease-out)] data-[state=checked]:translate-x-[18px] data-[state=checked]:bg-brand-ink" />
    </SwitchPrimitive.Root>
  );
}
