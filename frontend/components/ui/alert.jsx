import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";

import { cn } from "@/lib/utils";

const tones = {
  info: {
    wrap: "border-info/25 bg-info-soft text-info",
    icon: Info,
  },
  success: {
    wrap: "border-up/25 bg-up-soft text-up",
    icon: CheckCircle2,
  },
  warning: {
    wrap: "border-warn/25 bg-warn-soft text-warn",
    icon: AlertTriangle,
  },
  danger: {
    wrap: "border-down/25 bg-down-soft text-down",
    icon: XCircle,
  },
  neutral: {
    wrap: "border-line bg-surface-2 text-fg-muted",
    icon: Info,
  },
};

export function Alert({
  tone = "info",
  title,
  children,
  className,
  icon: CustomIcon,
  action,
}) {
  const config = tones[tone] || tones.info;
  const Icon = CustomIcon || config.icon;

  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={cn(
        "flex items-start gap-3 rounded-[10px] border px-3.5 py-3",
        config.wrap,
        className,
      )}
    >
      <Icon className="mt-0.5 size-4 shrink-0" strokeWidth={1.8} aria-hidden="true" />
      <div className="min-w-0 flex-1 text-[12.5px] leading-relaxed">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? (
          <div className={cn(title && "mt-0.5", "text-current/85")}>{children}</div>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
