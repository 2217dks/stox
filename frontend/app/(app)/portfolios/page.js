"use client";

import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowRight,
  ArrowUpRight,
  Layers3,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
  Wallet,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown";
import { EmptyState, ErrorState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Progress } from "@/components/ui/misc";
import { Skeleton } from "@/components/ui/skeleton";
import { PortfolioDialog } from "@/components/portfolios/portfolio-dialog";
import { DeactivatePortfolioDialog } from "@/components/portfolios/deactivate-portfolio-dialog";
import {
  useHoldings,
  usePortfolios,
  usePortfolioSummary,
  useQuotes,
} from "@/lib/hooks";
import {
  formatCurrency,
  formatPercent,
  pnlTone,
  tickerOf,
} from "@/lib/format";
import { cn } from "@/lib/utils";

function PortfolioCard({ portfolio }) {
  const { data: summaryData, loading } = usePortfolioSummary(portfolio.id);
  const { data: holdingsData } = useHoldings(portfolio.id);
  const summary = summaryData?.portfolio;
  const holdings = (holdingsData?.holdings ?? []).filter(
    (holding) => Number(holding.quantity) !== 0,
  );
  const assetTypes = Object.fromEntries(
    holdings.map((holding) => [holding.symbol, holding.assetType]),
  );
  const { quotes } = useQuotes(
    holdings.map((holding) => holding.symbol),
    assetTypes,
  );

  const liveValue = useMemo(() => {
    if (!holdings.length) return Number(summary?.holdingsValue || 0);
    return holdings.reduce((sum, holding) => {
      const price = Number(quotes[holding.symbol]?.price || 0);
      return sum + (price > 0 ? price * Number(holding.quantity) : Number(holding.totalInvested));
    }, 0);
  }, [holdings, quotes, summary?.holdingsValue]);

  const cash = Number(summary?.cashBalance ?? portfolio.cashBalance);
  const totalValue = cash + liveValue;
  const starting = Number(summary?.startingBalance ?? portfolio.startingBalance);
  const pnl = totalValue - starting;
  const pnlPct = starting ? (pnl / starting) * 100 : 0;
  const investedPct = totalValue ? (liveValue / totalValue) * 100 : 0;

  return (
    <Card
      className={cn(
        "group flex flex-col overflow-hidden",
        portfolio.isActive === false && "opacity-65",
      )}
    >
      <div
        className="h-1 w-full"
        style={{
          background: portfolio.isDefault
            ? "var(--brand)"
            : "color-mix(in oklab, var(--brand) 30%, var(--surface-3))",
        }}
        aria-hidden="true"
      />
      <CardContent className="flex flex-1 flex-col p-4 pt-3.5 sm:p-5 sm:pt-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <h2 className="truncate text-[15px] font-semibold tracking-[-0.01em] text-fg">
                {portfolio.name}
              </h2>
              {portfolio.isDefault ? <Badge tone="brand">Default</Badge> : null}
              {portfolio.isActive === false ? (
                <Badge tone="neutral">Inactive</Badge>
              ) : null}
            </div>
            <p className="mt-1 line-clamp-2 min-h-[32px] text-[11.5px] leading-relaxed text-fg-subtle">
              {portfolio.description || "No description"}
            </p>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton label="Portfolio actions" size="icon-sm">
                <MoreHorizontal className="size-4" />
              </IconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <PortfolioDialog
                portfolio={portfolio}
                trigger={
                  <DropdownMenuItem onSelect={(event) => event.preventDefault()}>
                    <Pencil className="size-3.5" aria-hidden="true" />
                    Edit portfolio
                  </DropdownMenuItem>
                }
              />
              <DropdownMenuSeparator />
              <DeactivatePortfolioDialog
                portfolio={portfolio}
                trigger={
                  <DropdownMenuItem
                    danger
                    disabled={portfolio.isDefault}
                    onSelect={(event) => event.preventDefault()}
                  >
                    <Trash2 className="size-3.5" aria-hidden="true" />
                    Deactivate
                  </DropdownMenuItem>
                }
              />
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="mt-4">
          {loading && !summary ? (
            <Skeleton className="h-8 w-36" />
          ) : (
            <p className="tnum text-[27px] font-semibold leading-none tracking-[-0.035em] text-fg">
              {formatCurrency(totalValue)}
            </p>
          )}
          <p className={cn("tnum mt-1.5 text-[11.5px]", pnlTone(pnl))}>
            {formatCurrency(pnl, { signed: true })} · {formatPercent(pnlPct)}
            <span className="ml-1 text-fg-subtle">all time</span>
          </p>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <div className="rounded-[8px] border border-line bg-surface-2/50 px-2.5 py-2">
            <p className="text-[9px] uppercase tracking-[0.07em] text-fg-subtle">
              Cash
            </p>
            <p className="tnum mt-0.5 text-[11.5px] text-fg">
              {formatCurrency(cash, { compact: true })}
            </p>
          </div>
          <div className="rounded-[8px] border border-line bg-surface-2/50 px-2.5 py-2">
            <p className="text-[9px] uppercase tracking-[0.07em] text-fg-subtle">
              Positions
            </p>
            <p className="tnum mt-0.5 text-[11.5px] text-fg">
              {holdings.length}
            </p>
          </div>
        </div>

        <div className="mt-3">
          <div className="mb-1 flex items-center justify-between text-[9.5px] text-fg-subtle">
            <span>Invested {investedPct.toFixed(0)}%</span>
            <span>Cash {(100 - investedPct).toFixed(0)}%</span>
          </div>
          <Progress value={investedPct} tone="brand" label="Portfolio invested allocation" />
        </div>

        {holdings.length ? (
          <div className="mt-3 flex flex-wrap gap-1">
            {holdings.slice(0, 5).map((holding) => (
              <span
                key={holding.symbol}
                className="rounded-full border border-line bg-surface-2 px-1.5 py-0.5 font-mono text-[9px] text-fg-subtle"
              >
                {tickerOf(holding.symbol)}
              </span>
            ))}
            {holdings.length > 5 ? (
              <span className="px-1 py-0.5 text-[9px] text-fg-subtle">
                +{holdings.length - 5}
              </span>
            ) : null}
          </div>
        ) : null}

        <div className="mt-auto flex items-center gap-2 pt-4">
          <Button asChild variant="secondary" size="sm" className="flex-1">
            <Link href={`/portfolios/${portfolio.id}`}>
              Open portfolio
              <ArrowRight className="size-3.5" aria-hidden="true" />
            </Link>
          </Button>
          <Button asChild variant="ghost" size="icon-sm" aria-label="Place an order">
            <Link href={`/orders?new=1&portfolioId=${portfolio.id}`}>
              <ArrowUpRight className="size-3.5" aria-hidden="true" />
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function PortfoliosContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const openNew = searchParams.get("new") === "1";
  const { portfolios, loading, error, mutate } = usePortfolios();
  const [createOpen, setCreateOpen] = useState(false);
  const isCreateOpen = createOpen || openNew;

  const active = portfolios.filter((portfolio) => portfolio.isActive !== false);
  const inactive = portfolios.filter((portfolio) => portfolio.isActive === false);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Capital allocation"
        title="Portfolios"
        description="Run separate strategies with isolated cash and holdings. Compare what works without mixing the evidence."
        actions={
          <PortfolioDialog
            open={isCreateOpen}
            onOpenChange={(next) => {
              setCreateOpen(next);
              if (!next && openNew) {
                router.replace("/portfolios", { scroll: false });
              }
            }}
            redirect
            trigger={
              <Button variant="primary" size="md">
                <Plus className="size-4" aria-hidden="true" />
                New portfolio
              </Button>
            }
          />
        }
      >
        <div className="flex flex-wrap items-center gap-2 text-[11.5px] text-fg-subtle">
          <span className="flex items-center gap-1.5">
            <Layers3 className="size-3.5" aria-hidden="true" />
            {active.length} active
          </span>
          <span className="text-line-strong" aria-hidden="true">
            ·
          </span>
          <span>Each portfolio starts with $10,000 virtual cash</span>
          <span className="text-line-strong" aria-hidden="true">
            ·
          </span>
          <span>Default: {active.find((p) => p.isDefault)?.name || "—"}</span>
        </div>
      </PageHeader>

      {error ? (
        <ErrorState
          code={error.code}
          title="Could not load portfolios"
          description={error.message}
          action={
            <Button variant="secondary" size="sm" onClick={() => mutate()}>
              Retry
            </Button>
          }
        />
      ) : loading && !portfolios.length ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((key) => (
            <Skeleton key={key} className="h-[300px] rounded-[12px]" />
          ))}
        </div>
      ) : active.length === 0 ? (
        <EmptyState
          icon={Wallet}
          title="Create your first portfolio"
          description="A portfolio holds cash, positions and orders for one strategy. You can run as many as you like."
          action={
            <PortfolioDialog
              trigger={
                <Button variant="primary" size="md">
                  <Plus className="size-4" aria-hidden="true" />
                  Create portfolio
                </Button>
              }
            />
          }
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {active.map((portfolio) => (
            <PortfolioCard key={portfolio.id} portfolio={portfolio} />
          ))}
          <Link
            href="/portfolios?new=1"
            className="flex min-h-[300px] flex-col items-center justify-center gap-2 rounded-[12px] border border-dashed border-line-strong text-fg-subtle transition-colors hover:border-brand/40 hover:bg-surface/50 hover:text-brand"
          >
            <span className="flex size-10 items-center justify-center rounded-full border border-line bg-surface">
              <Plus className="size-4" aria-hidden="true" />
            </span>
            <span className="text-[12px] font-medium">New strategy</span>
            <span className="text-[10.5px]">Starts with $10,000 virtual</span>
          </Link>
        </div>
      )}

      {inactive.length ? (
        <div className="space-y-3 pt-2">
          <div className="flex items-center gap-3">
            <h2 className="text-[13px] font-semibold text-fg-muted">
              Inactive portfolios
            </h2>
            <span className="h-px flex-1 bg-line" />
            <span className="text-[10.5px] text-fg-subtle">
              History preserved
            </span>
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {inactive.map((portfolio) => (
              <PortfolioCard key={portfolio.id} portfolio={portfolio} />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default function PortfoliosPage() {
  return (
    <Suspense
      fallback={
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((key) => (
            <Skeleton key={key} className="h-[300px] rounded-[12px]" />
          ))}
        </div>
      }
    >
      <PortfoliosContent />
    </Suspense>
  );
}
