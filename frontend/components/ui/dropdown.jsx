"use client";

import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { Check } from "lucide-react";

import { cn } from "@/lib/utils";

export const DropdownMenu = DropdownMenuPrimitive.Root;
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;
export const DropdownMenuGroup = DropdownMenuPrimitive.Group;

export function DropdownMenuContent({ className, sideOffset = 6, ...props }) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        sideOffset={sideOffset}
        className={cn(
          "z-[70] min-w-[190px] overflow-hidden rounded-[10px] border border-line bg-surface p-1 shadow-[var(--shadow-pop)]",
          "scale-100",
          "data-[state=open]:animate-[menu-in_160ms_cubic-bezier(0.23,1,0.32,1)]",
          "[transform-origin:var(--radix-dropdown-menu-content-transform-origin)]",
          className,
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  );
}

export function DropdownMenuItem({
  className,
  inset,
  danger,
  ...props
}) {
  return (
    <DropdownMenuPrimitive.Item
      className={cn(
        "relative flex h-8 cursor-pointer select-none items-center gap-2 rounded-[6px] px-2 text-[12.5px] outline-none transition-colors",
        "data-[highlighted]:bg-surface-2 data-[highlighted]:text-fg",
        danger ? "text-down data-[highlighted]:bg-down-soft" : "text-fg-muted",
        inset && "pl-7",
        "data-[disabled]:pointer-events-none data-[disabled]:opacity-45",
        className,
      )}
      {...props}
    />
  );
}

export function DropdownMenuCheckboxItem({ className, children, checked, ...props }) {
  return (
    <DropdownMenuPrimitive.CheckboxItem
      checked={checked}
      className={cn(
        "relative flex h-8 cursor-pointer select-none items-center rounded-[6px] pl-7 pr-2 text-[12.5px] text-fg-muted outline-none transition-colors data-[highlighted]:bg-surface-2 data-[highlighted]:text-fg",
        className,
      )}
      {...props}
    >
      <span className="absolute left-2 flex size-3.5 items-center justify-center">
        <DropdownMenuPrimitive.ItemIndicator>
          <Check className="size-3.5 text-brand" />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.CheckboxItem>
  );
}

export function DropdownMenuLabel({ className, ...props }) {
  return (
    <DropdownMenuPrimitive.Label
      className={cn("px-2 py-1.5 text-[10.5px] font-medium uppercase tracking-[0.08em] text-fg-subtle", className)}
      {...props}
    />
  );
}

export function DropdownMenuSeparator({ className, ...props }) {
  return (
    <DropdownMenuPrimitive.Separator
      className={cn("my-1 h-px bg-line", className)}
      {...props}
    />
  );
}
