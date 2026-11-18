"use client";

import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { Search } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/misc";
import { marketApi } from "@/lib/endpoints";
import { useDebouncedValue } from "@/lib/hooks";
import { cn, normalizeMarketSymbol } from "@/lib/utils";

export function SymbolSearch({
  value,
  onChange,
  onSelect,
  placeholder = "Search symbol or company",
  autoFocus = false,
  className,
  inputClassName,
  assetClass,
}) {
  const [internalValue, setInternalValue] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const containerRef = useRef(null);

  const controlled = value !== undefined;
  const query = controlled ? value : internalValue;
  const debounced = useDebouncedValue(query, 220);
  const trimmed = debounced.trim();

  const { data, isLoading, error } = useSWR(
    open && trimmed.length >= 2
      ? `symbol-search:${assetClass || "ALL"}:${trimmed}`
      : null,
    async () => {
      try {
        return await marketApi.search({
          query: trimmed,
          limit: 8,
          assetClass,
        });
      } catch (error) {
        // Without a configured stock provider, an unfiltered search fails
        // entirely. Degrade to crypto search instead of returning nothing.
        if (!assetClass && error?.code === "MARKET_DATA_NOT_CONFIGURED") {
          return marketApi.search({
            query: trimmed,
            limit: 8,
            assetClass: "CRYPTO",
          });
        }
        throw error;
      }
    },
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );

  const results =
    trimmed.length >= 2 && Array.isArray(data)
      ? data.map((result) => ({
          ...result,
          symbol: normalizeMarketSymbol(result.symbol),
        }))
      : [];

  useEffect(() => {
    const onPointerDown = (event) => {
      if (!containerRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  const updateValue = (next) => {
    if (!controlled) setInternalValue(next);
    onChange?.(next);
  };

  const choose = (result) => {
    updateValue(result.symbol);
    onSelect?.(result);
    setOpen(false);
    setActiveIndex(-1);
  };

  const onKeyDown = (event) => {
    if (!open || !results.length) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % results.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => (index - 1 + results.length) % results.length);
    } else if (event.key === "Enter" && activeIndex >= 0) {
      event.preventDefault();
      choose(results[Math.min(activeIndex, results.length - 1)]);
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <Input
        value={query}
        onChange={(event) => {
          const next = event.target.value.toUpperCase();
          updateValue(next);
          setOpen(true);
          setActiveIndex(-1);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        autoFocus={autoFocus}
        autoComplete="off"
        spellCheck={false}
        leftIcon={
          isLoading ? (
            <Spinner className="[&_svg]:size-3.5" />
          ) : (
            <Search className="size-4" aria-hidden="true" />
          )
        }
        className={cn("font-mono uppercase tracking-[0.02em]", inputClassName)}
        role="combobox"
        aria-expanded={open && results.length > 0}
        aria-controls="symbol-results"
        aria-autocomplete="list"
      />

      {open && (isLoading || results.length > 0 || trimmed.length >= 2) ? (
        <div
          id="symbol-results"
          role="listbox"
          className="absolute left-0 right-0 top-[calc(100%+6px)] z-30 max-h-[280px] overflow-y-auto rounded-[10px] border border-line bg-surface p-1 shadow-[var(--shadow-pop)]"
        >
          {results.length === 0 && !isLoading ? (
            <p className="px-2.5 py-3 text-[11.5px] text-fg-subtle">
              {error
                ? "Market search is unavailable for this asset class right now."
                : `No markets found for “${query}”.`}
            </p>
          ) : null}

          {results.map((result, index) => (
            <button
              key={`${result.symbol}-${result.assetClass}`}
              type="button"
              role="option"
              aria-selected={index === activeIndex}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(result)}
              onMouseEnter={() => setActiveIndex(index)}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-[7px] px-2 py-2 text-left transition-colors",
                index === activeIndex ? "bg-surface-2" : "hover:bg-surface-2",
              )}
            >
              <span className="flex size-7 shrink-0 items-center justify-center rounded-[6px] bg-surface-2 text-[9px] font-semibold text-fg-muted">
                {result.symbol.slice(0, 2)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-mono text-[11.5px] font-medium text-fg">
                  {result.symbol}
                </span>
                <span className="block truncate text-[10.5px] text-fg-subtle">
                  {result.name || result.type || "—"}
                </span>
              </span>
              <span className="shrink-0 text-[9px] uppercase tracking-[0.06em] text-fg-subtle">
                {result.assetClass}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
