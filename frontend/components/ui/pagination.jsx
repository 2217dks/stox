"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "./button";

export function Pagination({
  page = 1,
  totalPages = 1,
  total,
  limit,
  onPageChange,
  className,
  compact = false,
}) {
  if (!totalPages || totalPages <= 1) {
    return total ? (
      <p className={cn("text-[11.5px] text-fg-subtle", className)}>
        {total.toLocaleString()} {total === 1 ? "result" : "results"}
      </p>
    ) : null;
  }

  const safePage = Math.min(Math.max(page, 1), totalPages);
  const start = total ? (safePage - 1) * (limit || 0) + 1 : 0;
  const end = limit ? Math.min(safePage * limit, total || safePage * limit) : 0;

  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 text-[11.5px] text-fg-subtle",
        className,
      )}
    >
      {!compact ? (
        <p className="tnum">
          {total ? (
            <>
              {start.toLocaleString()}–{end.toLocaleString()} of{" "}
              {total.toLocaleString()}
            </>
          ) : (
            <>Page {safePage} of {totalPages}</>
          )}
        </p>
      ) : (
        <span />
      )}
      <div className="flex items-center gap-1.5">
        <Button
          variant="secondary"
          size="icon-sm"
          aria-label="Previous page"
          disabled={safePage <= 1}
          onClick={() => onPageChange?.(safePage - 1)}
        >
          <ChevronLeft className="size-4" aria-hidden="true" />
        </Button>
        <span className="tnum min-w-14 text-center text-[12px] text-fg-muted">
          {safePage} / {totalPages}
        </span>
        <Button
          variant="secondary"
          size="icon-sm"
          aria-label="Next page"
          disabled={safePage >= totalPages}
          onClick={() => onPageChange?.(safePage + 1)}
        >
          <ChevronRight className="size-4" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}
