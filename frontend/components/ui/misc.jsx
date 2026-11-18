import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";

export function Spinner({ className, label = "Loading" }) {
  return (
    <span role="status" className={cn("inline-flex items-center gap-2", className)}>
      <Loader2 className="size-4 animate-[stox-spin_.8s_linear_infinite] text-fg-muted" />
      <span className="sr-only">{label}</span>
    </span>
  );
}

export function Kbd({ children, className }) {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-[5px] border border-line bg-surface-2 px-1 font-mono text-[10px] font-medium text-fg-subtle",
        className,
      )}
    >
      {children}
    </kbd>
  );
}

export function Progress({ value = 0, tone = "brand", className, label }) {
  const safe = Math.min(Math.max(Number(value) || 0, 0), 100);
  const tones = {
    brand: "bg-brand",
    up: "bg-up",
    down: "bg-down",
    warn: "bg-warn",
    violet: "bg-violet",
    neutral: "bg-fg-subtle",
  };

  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(safe)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      className={cn("h-1.5 w-full overflow-hidden rounded-full bg-surface-3", className)}
    >
      <div
        className={cn("h-full rounded-full transition-[width] duration-500 ease-[var(--ease-out)]", tones[tone])}
        style={{ width: `${safe}%` }}
      />
    </div>
  );
}

export function Divider({ className, label }) {
  if (label) {
    return (
      <div className={cn("flex items-center gap-3", className)}>
        <span className="h-px flex-1 bg-line" />
        <span className="text-[10.5px] uppercase tracking-[0.09em] text-fg-subtle">
          {label}
        </span>
        <span className="h-px flex-1 bg-line" />
      </div>
    );
  }

  return <div className={cn("h-px w-full bg-line", className)} />;
}

export function VisuallyHidden({ children }) {
  return <span className="sr-only">{children}</span>;
}
