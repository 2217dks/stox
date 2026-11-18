import { cn } from "@/lib/utils";

export function Card({ className, interactive, as: Component = "div", ...props }) {
  return (
    <Component
      className={cn(
        "panel relative",
        interactive &&
          "transition-[border-color,background-color] duration-[var(--dur-fast)] ease-[var(--ease-out)] hover:border-line-strong",
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, children, ...props }) {
  return (
    <div
      className={cn(
        "flex items-start justify-between gap-4 px-4 pt-4 pb-3 sm:px-5 sm:pt-5",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardHeading({ className, ...props }) {
  return <div className={cn("min-w-0 space-y-1", className)} {...props} />;
}

export function CardTitle({ className, as: Component = "h2", ...props }) {
  return (
    <Component
      className={cn(
        "text-[14px] font-semibold leading-tight tracking-[-0.01em] text-fg",
        className,
      )}
      {...props}
    />
  );
}

export function CardDescription({ className, ...props }) {
  return (
    <p className={cn("text-[12.5px] leading-snug text-fg-muted", className)} {...props} />
  );
}

export function CardAction({ className, ...props }) {
  return (
    <div
      className={cn("flex shrink-0 items-center gap-1.5", className)}
      {...props}
    />
  );
}

export function CardContent({ className, ...props }) {
  return <div className={cn("px-4 pb-4 sm:px-5 sm:pb-5", className)} {...props} />;
}

export function CardFooter({ className, ...props }) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 border-t border-line px-4 py-3 sm:px-5",
        className,
      )}
      {...props}
    />
  );
}
