import Link from "next/link";

import { cn } from "@/lib/utils";

export function LogoMark({ className, size = 28 }) {
  return (
    <span
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-[9px] border border-white/10 bg-[linear-gradient(145deg,#101728,#090d16)] shadow-[inset_0_1px_0_rgba(255,255,255,.08)]",
        className,
      )}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <svg
        viewBox="0 0 28 28"
        width={size * 0.66}
        height={size * 0.66}
        fill="none"
      >
        <rect x="4" y="15" width="4.5" height="9" rx="1.6" fill="#6C97FF" />
        <rect
          x="11.75"
          y="9.5"
          width="4.5"
          height="14.5"
          rx="1.6"
          fill="#6C97FF"
          opacity="0.72"
        />
        <rect
          x="19.5"
          y="4"
          width="4.5"
          height="20"
          rx="1.6"
          fill="#6C97FF"
          opacity="0.42"
        />
      </svg>
    </span>
  );
}

export function Logo({ className, href = "/", showWordmark = true, size = 28 }) {
  const content = (
    <>
      <LogoMark size={size} />
      {showWordmark ? (
        <span className="flex items-baseline">
          <span className="text-[17px] font-semibold leading-none tracking-[-0.045em] text-fg">
            stox
          </span>
          <span className="text-[17px] font-semibold leading-none text-brand">
            .
          </span>
        </span>
      ) : null}
    </>
  );

  if (!href) {
    return (
      <span className={cn("inline-flex items-center gap-2.5", className)}>
        {content}
      </span>
    );
  }

  return (
    <Link
      href={href}
      className={cn(
        "inline-flex items-center gap-2.5 rounded-md",
        className,
      )}
      aria-label="Stox home"
    >
      {content}
    </Link>
  );
}
