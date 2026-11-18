"use client";

import { forwardRef, useId } from "react";

import { cn } from "@/lib/utils";

const fieldBase =
  "w-full rounded-[9px] border bg-surface-2 text-[13.5px] text-fg shadow-[0_1px_0_rgba(255,255,255,.02)_inset] transition-[border-color,background-color,box-shadow] duration-[var(--dur-fast)] ease-[var(--ease-out)] placeholder:text-fg-subtle/80 hover:border-line-strong focus:border-brand/70 focus:bg-surface-3 focus:outline-none focus:ring-4 focus:ring-brand-soft disabled:cursor-not-allowed disabled:opacity-50";

export const Input = forwardRef(function Input(
  {
    className,
    invalid,
    leftIcon,
    rightSlot,
    inputSize = "md",
    ...props
  },
  ref,
) {
  const sizes = {
    sm: "h-8 px-2.5 text-[12.5px]",
    md: "h-[38px] px-3",
    lg: "h-11 px-3.5",
  };

  if (leftIcon || rightSlot) {
    return (
      <div className="relative flex items-center">
        {leftIcon ? (
          <span className="pointer-events-none absolute left-3 flex text-fg-subtle">
            {leftIcon}
          </span>
        ) : null}
        <input
          ref={ref}
          className={cn(
            fieldBase,
            sizes[inputSize],
            leftIcon && "pl-9",
            rightSlot && "pr-10",
            invalid && "border-down/70 focus:border-down focus:ring-down-soft",
            className,
          )}
          aria-invalid={invalid || undefined}
          {...props}
        />
        {rightSlot ? (
          <span className="absolute right-2 flex items-center">
            {rightSlot}
          </span>
        ) : null}
      </div>
    );
  }

  return (
    <input
      ref={ref}
      className={cn(
        fieldBase,
        sizes[inputSize],
        invalid && "border-down/70 focus:border-down focus:ring-down-soft",
        className,
      )}
      aria-invalid={invalid || undefined}
      {...props}
    />
  );
});

export const Textarea = forwardRef(function Textarea(
  { className, invalid, ...props },
  ref,
) {
  return (
    <textarea
      ref={ref}
      className={cn(
        fieldBase,
        "min-h-[88px] resize-y px-3 py-2.5 leading-relaxed",
        invalid && "border-down/70 focus:border-down focus:ring-down-soft",
        className,
      )}
      aria-invalid={invalid || undefined}
      {...props}
    />
  );
});

export function Field({
  label,
  htmlFor,
  hint,
  error,
  required,
  optional,
  action,
  className,
  children,
}) {
  const generatedId = useId();
  const id = htmlFor || generatedId;

  return (
    <div className={cn("space-y-1.5", className)}>
      {label ? (
        <div className="flex items-baseline justify-between gap-3">
          <label
            htmlFor={id}
            className="text-[12.5px] font-medium leading-none text-fg"
          >
            {label}
            {required ? (
              <span className="ml-1 text-brand" aria-hidden="true">
                *
              </span>
            ) : null}
            {optional ? (
              <span className="ml-1.5 text-[11px] font-normal text-fg-subtle">
                optional
              </span>
            ) : null}
          </label>
          {action}
        </div>
      ) : null}
      {typeof children === "function" ? children({ id }) : children}
      {error ? (
        <p className="text-[11.5px] leading-snug text-down" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-[11.5px] leading-snug text-fg-subtle">{hint}</p>
      ) : null}
    </div>
  );
}

export function Checkbox({ label, className, id, ...props }) {
  const generatedId = useId();
  const inputId = id || generatedId;

  return (
    <label
      htmlFor={inputId}
      className={cn(
        "flex cursor-pointer select-none items-start gap-2.5 text-[13px] text-fg-muted",
        className,
      )}
    >
      <input
        id={inputId}
        type="checkbox"
        className="mt-0.5 size-4 shrink-0 cursor-pointer rounded-[5px] border-line bg-surface-2 accent-[var(--brand)]"
        {...props}
      />
      <span className="leading-snug">{label}</span>
    </label>
  );
}
