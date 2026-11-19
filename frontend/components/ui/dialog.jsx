"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({
  className,
  children,
  size = "md",
  showClose = true,
  ...props
}) {
  const sizes = {
    sm: "max-w-[420px]",
    md: "max-w-[540px]",
    lg: "max-w-[680px]",
    xl: "max-w-[840px]",
  };

  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[var(--overlay)] backdrop-blur-[3px] data-[state=closed]:animate-[stox-fade_120ms_ease-out] data-[state=open]:animate-[stox-fade_180ms_ease-out]" />
      <DialogPrimitive.Content
        className={cn(
          "fixed left-1/2 top-1/2 z-50 w-[calc(100%-24px)] -translate-x-1/2 -translate-y-1/2 rounded-[16px] border border-line bg-surface shadow-[var(--shadow-modal)]",
          "scale-100",
          "max-h-[calc(100dvh-32px)] overflow-y-auto",
          "data-[state=open]:animate-[dialog-in_220ms_cubic-bezier(0.23,1,0.32,1)]",
          sizes[size],
          className,
        )}
        {...props}
      >
        {children}
        {showClose ? (
          <DialogPrimitive.Close
            className="absolute right-3.5 top-3.5 flex size-8 items-center justify-center rounded-[8px] text-fg-subtle transition-colors hover:bg-surface-2 hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            aria-label="Close dialog"
          >
            <X className="size-4" aria-hidden="true" />
          </DialogPrimitive.Close>
        ) : null}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DialogHeader({ className, ...props }) {
  return <div className={cn("space-y-1.5 px-5 pb-4 pt-5 pr-12", className)} {...props} />;
}

export function DialogTitle({ className, ...props }) {
  return (
    <DialogPrimitive.Title
      className={cn("text-[17px] font-semibold leading-tight tracking-[-0.02em] text-fg", className)}
      {...props}
    />
  );
}

export function DialogDescription({ className, ...props }) {
  return (
    <DialogPrimitive.Description
      className={cn("text-[12.5px] leading-relaxed text-fg-muted", className)}
      {...props}
    />
  );
}

export function DialogBody({ className, ...props }) {
  return <div className={cn("px-5 pb-5", className)} {...props} />;
}

export function DialogFooter({ className, ...props }) {
  return (
    <div
      className={cn(
        "flex flex-col-reverse gap-2 border-t border-line px-5 py-3.5 sm:flex-row sm:justify-end",
        className,
      )}
      {...props}
    />
  );
}
