"use client";

import { Check, ChevronsUpDown, Plus, Wallet } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown";
import { Skeleton } from "@/components/ui/skeleton";
import { useActivePortfolio } from "@/lib/hooks";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";

export function PortfolioSwitcher({ collapsed = false }) {
  const router = useRouter();
  const pathname = usePathname();
  const {
    activePortfolios,
    portfolio,
    loading,
    setActivePortfolioId,
  } = useActivePortfolio();

  /**
   * Select a portfolio from the switcher.
   *
   * The detail page derives its id from the route (`/portfolios/:id`), so a
   * switch made while viewing one must move the URL too — otherwise the page
   * keeps rendering the old portfolio. `replace` is deliberate: switching
   * accounts is a context change, not a destination, so it should not stack
   * history entries the back button has to walk through.
   */
  function selectPortfolio(portfolioId) {
    setActivePortfolioId(portfolioId);

    if (/^\/portfolios\/[^/]+$/.test(pathname)) {
      router.replace(`/portfolios/${portfolioId}`);
    }
  }

  if (loading && !portfolio) {
    return (
      <div className={cn("px-1", collapsed && "flex justify-center")}>
        <Skeleton className={cn("h-[42px] rounded-[9px]", collapsed ? "w-9" : "w-full")} />
      </div>
    );
  }

  if (!portfolio) {
    return (
      <button
        type="button"
        onClick={() => router.push("/portfolios?new=1")}
        className={cn(
          "flex items-center gap-2 rounded-[9px] border border-dashed border-line-strong px-3 py-2 text-[12px] text-fg-muted transition-colors hover:border-brand/50 hover:text-fg",
          collapsed ? "size-9 justify-center p-0" : "w-full",
        )}
      >
        <Plus className="size-4" aria-hidden="true" />
        {!collapsed ? "Create portfolio" : null}
      </button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            "group flex w-full items-center gap-2.5 rounded-[9px] border border-line bg-surface-2 px-2.5 py-2 text-left transition-colors hover:border-line-strong hover:bg-surface-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
            collapsed && "justify-center px-0",
          )}
          aria-label={`Active portfolio: ${portfolio.name}`}
        >
          <span className="flex size-7 shrink-0 items-center justify-center rounded-[7px] bg-brand-soft text-brand">
            <Wallet className="size-3.5" strokeWidth={1.8} aria-hidden="true" />
          </span>
          {!collapsed ? (
            <>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12.5px] font-medium leading-tight text-fg">
                  {portfolio.name}
                </span>
                <span className="tnum mt-0.5 block text-[10.5px] leading-none text-fg-subtle">
                  {formatCurrency(portfolio.availableCash ?? portfolio.cashBalance, {
                    compact: true,
                  })}{" "}
                  available
                </span>
              </span>
              <ChevronsUpDown className="size-3.5 shrink-0 text-fg-subtle" aria-hidden="true" />
            </>
          ) : null}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        side={collapsed ? "right" : "bottom"}
        className="w-[248px]"
      >
        <DropdownMenuLabel>Portfolios</DropdownMenuLabel>
        {activePortfolios.map((item) => (
          <DropdownMenuItem
            key={item.id}
            onSelect={() => selectPortfolio(item.id)}
            className="justify-between gap-3"
          >
            <span className="min-w-0">
              <span className="block truncate text-fg">{item.name}</span>
              <span className="tnum block text-[10.5px] text-fg-subtle">
                {formatCurrency(item.availableCash ?? item.cashBalance, {
                  compact: true,
                })}{" "}
                available
              </span>
            </span>
            {item.id === portfolio.id ? (
              <Check className="size-3.5 shrink-0 text-brand" aria-hidden="true" />
            ) : null}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => router.push("/portfolios?new=1")}
          className="text-fg"
        >
          <Plus className="size-3.5" aria-hidden="true" />
          New portfolio
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => router.push("/portfolios")}>
          Manage portfolios
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
