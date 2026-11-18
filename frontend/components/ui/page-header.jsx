import { cn } from "@/lib/utils";

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  className,
  children,
}) {
  return (
    <header className={cn("flex flex-col gap-4", className)}>
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div className="min-w-0 space-y-1.5">
          {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
          <h1 className="text-[26px] font-semibold leading-[1.12] tracking-[-0.03em] text-fg sm:text-[28px]">
            {title}
          </h1>
          {description ? (
            <p className="max-w-[68ch] text-[13px] leading-relaxed text-fg-muted">
              {description}
            </p>
          ) : null}
        </div>
        {actions ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {actions}
          </div>
        ) : null}
      </div>
      {children}
    </header>
  );
}
