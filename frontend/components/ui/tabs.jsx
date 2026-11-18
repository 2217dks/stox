"use client";

import * as TabsPrimitive from "@radix-ui/react-tabs";

import { cn } from "@/lib/utils";

export const Tabs = TabsPrimitive.Root;

export function TabsList({ className, variant = "underline", ...props }) {
  return (
    <TabsPrimitive.List
      className={cn(
        variant === "underline"
          ? "flex w-full items-center gap-5 border-b border-line"
          : "inline-flex items-center gap-0.5 rounded-[9px] border border-line bg-surface-2 p-[3px]",
        className,
      )}
      {...props}
    />
  );
}

export function TabsTrigger({ className, variant = "underline", ...props }) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        "relative inline-flex items-center justify-center gap-1.5 whitespace-nowrap font-medium text-fg-muted transition-[color,background-color] duration-[var(--dur-fast)] ease-[var(--ease-out)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:pointer-events-none disabled:opacity-50 data-[state=active]:text-fg",
        variant === "underline"
          ? "-mb-px h-10 border-b-2 border-transparent px-0.5 text-[13px] data-[state=active]:border-brand"
          : "h-8 rounded-[7px] px-3 text-[12.5px] data-[state=active]:bg-surface data-[state=active]:shadow-[0_1px_2px_rgba(0,0,0,.18)]",
        className,
      )}
      {...props}
    />
  );
}

export function TabsContent({ className, ...props }) {
  return (
    <TabsPrimitive.Content
      className={cn("mt-4 focus-visible:outline-none", className)}
      {...props}
    />
  );
}
