"use client";

import { useState } from "react";

import { cn, hashString, initials } from "@/lib/utils";

const gradients = [
  "from-[#3b5bdb] to-[#6c97ff]",
  "from-[#0f766e] to-[#5eead4]",
  "from-[#6d28d9] to-[#a78bfa]",
  "from-[#9a3412] to-[#f5b84b]",
  "from-[#9d174d] to-[#f472b6]",
  "from-[#155e75] to-[#56c8f5]",
];

export function Avatar({
  src,
  name = "",
  size = 32,
  className,
  ring = false,
  ...props
}) {
  const [failedSrc, setFailedSrc] = useState(null);
  const failed = Boolean(src) && failedSrc === src;
  const gradient = gradients[hashString(name) % gradients.length];
  const dimension = typeof size === "number" ? `${size}px` : size;

  return (
    <span
      className={cn(
        "relative inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full bg-surface-2",
        ring && "ring-2 ring-canvas",
        className,
      )}
      style={{ width: dimension, height: dimension }}
      {...props}
    >
      {src && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={name ? `${name}'s avatar` : "User avatar"}
          className="size-full object-cover"
          loading="lazy"
          onError={() => setFailedSrc(src)}
        />
      ) : (
        <span
          className={cn(
            "flex size-full items-center justify-center bg-gradient-to-br font-semibold text-white",
            gradient,
          )}
          style={{ fontSize: Math.max(10, Number.parseInt(size, 10) * 0.36) }}
          aria-hidden="true"
        >
          {initials(name) || "?"}
        </span>
      )}
    </span>
  );
}
