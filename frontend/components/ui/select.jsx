"use client";

import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown, ChevronUp } from "lucide-react";

import { cn } from "@/lib/utils";

export const Select = SelectPrimitive.Root;
export const SelectValue = SelectPrimitive.Value;

export function SelectTrigger({ className, children, invalid, ...props }) {
  return (
    <SelectPrimitive.Trigger
      className={cn(
        "flex h-[38px] w-full items-center justify-between gap-2 rounded-[9px] border border-line bg-surface-2 px-3 text-left text-[13.5px] text-fg transition-[border-color,background-color] duration-[var(--dur-fast)] hover:border-line-strong focus:border-brand/70 focus:outline-none focus:ring-4 focus:ring-brand-soft disabled:cursor-not-allowed disabled:opacity-50 data-[placeholder]:text-fg-subtle",
        invalid && "border-down/70 focus:border-down focus:ring-down-soft",
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDown className="size-4 shrink-0 text-fg-subtle" aria-hidden="true" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

export function SelectContent({ className, children, position = "popper", ...props }) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        position={position}
        sideOffset={6}
        className={cn(
          "z-[70] max-h-[min(340px,var(--radix-select-content-available-height))] min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-[10px] border border-line bg-surface shadow-[var(--shadow-pop)]",
          "data-[state=open]:animate-[menu-in_160ms_cubic-bezier(0.23,1,0.32,1)]",
          className,
        )}
        {...props}
      >
        <SelectPrimitive.ScrollUpButton className="flex h-6 items-center justify-center text-fg-subtle">
          <ChevronUp className="size-3.5" />
        </SelectPrimitive.ScrollUpButton>
        <SelectPrimitive.Viewport className="p-1">{children}</SelectPrimitive.Viewport>
        <SelectPrimitive.ScrollDownButton className="flex h-6 items-center justify-center text-fg-subtle">
          <ChevronDown className="size-3.5" />
        </SelectPrimitive.ScrollDownButton>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}

export function SelectItem({ className, children, ...props }) {
  return (
    <SelectPrimitive.Item
      className={cn(
        "relative flex h-8 cursor-pointer select-none items-center rounded-[6px] pr-7 pl-2 text-[12.5px] text-fg-muted outline-none transition-colors data-[highlighted]:bg-surface-2 data-[highlighted]:text-fg data-[state=checked]:text-fg data-[disabled]:pointer-events-none data-[disabled]:opacity-45",
        className,
      )}
      {...props}
    >
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
      <span className="absolute right-2 flex size-3.5 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <Check className="size-3.5 text-brand" />
        </SelectPrimitive.ItemIndicator>
      </span>
    </SelectPrimitive.Item>
  );
}

export function SelectSeparator({ className, ...props }) {
  return (
    <SelectPrimitive.Separator className={cn("my-1 h-px bg-line", className)} {...props} />
  );
}
