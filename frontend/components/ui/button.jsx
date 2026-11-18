import { forwardRef } from "react";
import { Slot } from "@radix-ui/react-slot";
import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";

const variants = {
  primary:
    "bg-brand text-brand-ink border border-brand shadow-[inset_0_1px_0_rgba(255,255,255,.22)] hover:bg-brand-strong hover:border-brand-strong",
  secondary:
    "bg-surface-2 text-fg border border-line hover:border-line-strong hover:bg-surface-3",
  ghost:
    "bg-transparent text-fg-muted border border-transparent hover:bg-surface-2 hover:text-fg",
  outline:
    "bg-transparent text-fg border border-line-strong hover:bg-surface-2",
  danger:
    "bg-down text-white border border-down hover:brightness-110",
  "danger-ghost":
    "bg-transparent text-down border border-transparent hover:bg-down-soft",
  success:
    "bg-up text-[#04120b] border border-up hover:brightness-105",
  link: "bg-transparent text-brand border border-transparent hover:text-brand-strong hover:underline underline-offset-4",
};

const sizes = {
  xs: "h-7 px-2.5 text-[12px] gap-1.5 rounded-[7px]",
  sm: "h-8 px-3 text-[12.5px] gap-1.5 rounded-[8px]",
  md: "h-[38px] px-4 text-[13.5px] gap-2 rounded-[9px]",
  lg: "h-11 px-5 text-[14px] gap-2 rounded-[10px]",
  icon: "h-9 w-9 p-0 rounded-[9px]",
  "icon-sm": "h-8 w-8 p-0 rounded-[8px]",
  "icon-xs": "h-7 w-7 p-0 rounded-[7px]",
};

export const Button = forwardRef(function Button(
  {
    className,
    variant = "secondary",
    size = "md",
    loading = false,
    disabled,
    leftIcon,
    rightIcon,
    children,
    type = "button",
    fullWidth = false,
    asChild = false,
    ...props
  },
  ref,
) {
  const Component = asChild ? Slot : "button";

  return (
    <Component
      ref={ref}
      type={asChild ? undefined : type}
      disabled={asChild ? undefined : disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        "relative inline-flex select-none items-center justify-center whitespace-nowrap font-medium",
        "transition-[background-color,border-color,color,transform,opacity] duration-[var(--dur-press)] ease-[var(--ease-out)]",
        "active:scale-[0.97] disabled:pointer-events-none disabled:opacity-45",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
        variants[variant],
        sizes[size],
        fullWidth && "w-full",
        className,
      )}
      {...props}
    >
      {asChild ? (
        children
      ) : (
        <>
          {loading ? (
            <Loader2 className="size-4 animate-[stox-spin_.8s_linear_infinite]" />
          ) : (
            leftIcon
          )}
          {children}
          {!loading && rightIcon}
        </>
      )}
    </Component>
  );
});

export function IconButton({
  label,
  className,
  variant = "ghost",
  size = "icon",
  ...props
}) {
  return (
    <Button
      aria-label={label}
      title={label}
      variant={variant}
      size={size}
      className={className}
      {...props}
    />
  );
}
