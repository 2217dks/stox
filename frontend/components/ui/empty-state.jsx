import { cn } from "@/lib/utils";

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
  compact = false,
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center px-6 text-center",
        compact ? "py-8" : "py-14",
        className,
      )}
    >
      {Icon ? (
        <span className="mb-4 flex size-12 items-center justify-center rounded-xl border border-line bg-surface-2 text-fg-muted">
          <Icon className="size-5" strokeWidth={1.6} aria-hidden="true" />
        </span>
      ) : null}
      <h3 className="text-[14px] font-semibold text-fg">{title}</h3>
      {description ? (
        <p className="mt-1.5 max-w-[42ch] text-[12.5px] leading-relaxed text-fg-muted">
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export function ErrorState({
  code,
  title = "Could not load this data",
  description,
  action,
  className,
  compact = false,
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center px-6 text-center",
        compact ? "py-8" : "py-14",
        className,
      )}
      role="alert"
    >
      <span className="mb-4 flex size-12 items-center justify-center rounded-xl border border-down/20 bg-down-soft text-down">
        <svg viewBox="0 0 24 24" className="size-5" fill="none" aria-hidden="true">
          <path
            d="M12 8v5m0 3.5v.5M10.3 3.9 2.7 17.1A2 2 0 0 0 4.4 20h15.2a2 2 0 0 0 1.7-2.9L13.7 3.9a2 2 0 0 0-3.4 0Z"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
          />
        </svg>
      </span>
      {code ? (
        <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.12em] text-down">
          {code}
        </p>
      ) : null}
      <h3 className="text-[14px] font-semibold text-fg">{title}</h3>
      {description ? (
        <p className="mt-1.5 max-w-[46ch] text-[12.5px] leading-relaxed text-fg-muted">
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
