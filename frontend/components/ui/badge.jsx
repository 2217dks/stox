import { cn } from "@/lib/utils";

const tones = {
  neutral: "border-line bg-surface-2 text-fg-muted",
  brand: "border-transparent bg-brand-soft text-brand",
  up: "border-transparent bg-up-soft text-up",
  down: "border-transparent bg-down-soft text-down",
  warn: "border-transparent bg-warn-soft text-warn",
  info: "border-transparent bg-info-soft text-info",
  violet: "border-transparent bg-violet-soft text-violet",
  cyan: "border-transparent bg-[rgba(94,234,212,.1)] text-cyan",
  outline: "border-line-strong bg-transparent text-fg-muted",
};

const dotTones = {
  neutral: "bg-fg-subtle",
  brand: "bg-brand",
  up: "bg-up",
  down: "bg-down",
  warn: "bg-warn",
  info: "bg-info",
  violet: "bg-violet",
  cyan: "bg-cyan",
};

export function Badge({
  tone = "neutral",
  dot = false,
  pulse = false,
  className,
  children,
  ...props
}) {
  return (
    <span
      className={cn(
        "inline-flex h-[22px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2 text-[10.5px] font-semibold uppercase leading-none tracking-[0.065em]",
        tones[tone] || tones.neutral,
        className,
      )}
      {...props}
    >
      {dot ? (
        <span
          className={cn(
            "size-1.5 rounded-full",
            dotTones[tone] || dotTones.neutral,
            pulse && "live-dot",
          )}
          aria-hidden="true"
        />
      ) : null}
      {children}
    </span>
  );
}

export function CountBadge({ children, tone = "brand", className }) {
  return (
    <span
      className={cn(
        "inline-flex min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-semibold leading-[18px]",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
