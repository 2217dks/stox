"use client";

import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Bell,
  ChartCandlestick,
  Plus,
} from "lucide-react";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardHeading,
  CardTitle,
} from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { EmptyState, ErrorState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { SegmentedControl } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { SymbolSearch } from "@/components/market/symbol-search";
import { AlertDialog } from "@/components/alerts/alert-dialog";
import {
  useActivePortfolio,
  useApi,
  useHoldings,
  useMarketOverview,
  useQuotes,
} from "@/lib/hooks";
import {
  CURATED_MARKET_META,
  CURATED_SYMBOLS,
} from "@/lib/constants";
import {
  formatCurrency,
  formatPercent,
  formatPrice,
  formatQuantity,
  isCrypto,
  tickerOf,
} from "@/lib/format";
import { canonicalMarketSymbol, cn } from "@/lib/utils";
import { aggregateHoldings } from "@/lib/position";

const allCurated = [
  ...CURATED_SYMBOLS.STOCK,
  ...CURATED_SYMBOLS.CRYPTO,
];

const assetTypes = Object.fromEntries(
  allCurated.map((symbol) => [symbol, CURATED_MARKET_META[symbol]?.assetType]),
);

const filters = [
  { value: "ALL", label: "All markets" },
  { value: "STOCK", label: "Stocks" },
  { value: "CRYPTO", label: "Crypto" },
];

function MarketsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialAsset = searchParams.get("asset");
  const [filter, setFilter] = useState(
    initialAsset === "STOCK" || initialAsset === "CRYPTO" ? initialAsset : "ALL",
  );
  const [sort, setSort] = useState("movers");

  // Both lists load on "All"; the Crypto tab avoids stock requests entirely.
  // The HTTP call is a single snapshot per mount — live prices arrive over the
  // socket — so this does not become a polling loop.
  const quoteSymbols = useMemo(
    () =>
      filter === "CRYPTO"
        ? CURATED_SYMBOLS.CRYPTO
        : [...CURATED_SYMBOLS.CRYPTO, ...CURATED_SYMBOLS.STOCK],
    [filter],
  );

  const { quotes, loading, error, mutate } = useQuotes(
    quoteSymbols,
    assetTypes,
    { refreshInterval: 0 },
  );
  const {
    overview,
    movers,
    loading: overviewLoading,
    error: overviewError,
  } = useMarketOverview("CRYPTO", 8);
  const { data: alertsData, loading: alertsLoading } = useApi("/alerts", {
    query: { status: "ACTIVE", limit: 5 },
    refreshInterval: 180000,
  });
  const { portfolioId } = useActivePortfolio();
  const {
    data: holdingsData,
    loading: holdingsLoading,
    error: holdingsError,
  } = useHoldings(portfolioId);

  const holdingsByKey = useMemo(() => {
    const grouped = new Map();
    for (const holding of holdingsData?.holdings ?? []) {
      if (Number(holding?.quantity) === 0) continue;
      const canonical = canonicalMarketSymbol(holding?.symbol);
      if (!canonical) continue;
      const type =
        holding?.assetType || (isCrypto(holding?.symbol) ? "CRYPTO" : "STOCK");
      const key = `${type}:${canonical}`;
      if (!grouped.has(key)) {
        grouped.set(key, []);
      }
      grouped.get(key).push(holding);
    }
    const map = new Map();
    for (const [key, list] of grouped.entries()) {
      map.set(key, aggregateHoldings(list));
    }
    return map;
  }, [holdingsData]);

  const rows = useMemo(() => {
    const curatedRows = allCurated.map((symbol) => {
      const assetType =
        CURATED_MARKET_META[symbol]?.assetType ||
        assetTypes[symbol] ||
        (isCrypto(symbol) ? "CRYPTO" : "STOCK");
      const canonical = canonicalMarketSymbol(symbol);
      return {
        symbol,
        name: CURATED_MARKET_META[symbol]?.name || symbol,
        assetType,
        exchange: CURATED_MARKET_META[symbol]?.exchange || "—",
        quote: quotes[symbol],
        holding: holdingsByKey.get(`${assetType}:${canonical}`) || null,
      };
    });

    const existing = new Set(curatedRows.map((row) => row.symbol));
    const moverRows = (movers || [])
      .filter((mover) => !existing.has(mover.symbol))
      .map((mover) => {
        const canonical = canonicalMarketSymbol(mover.symbol);
        return {
          symbol: mover.symbol,
          name: tickerOf(mover.symbol),
          assetType: "CRYPTO",
          exchange: "Binance",
          quote: {
            price: mover.price,
            changePercent: mover.changePercent,
            volume: mover.quoteVolume,
          },
          holding: holdingsByKey.get(`CRYPTO:${canonical}`) || null,
        };
      });

    const merged = [...curatedRows, ...moverRows].filter(
      (row) => filter === "ALL" || row.assetType === filter,
    );

    return merged.sort((a, b) => {
      if (sort === "az") return a.symbol.localeCompare(b.symbol);
      return (
        Math.abs(Number(b.quote?.changePercent || 0)) -
        Math.abs(Number(a.quote?.changePercent || 0))
      );
    });
  }, [quotes, movers, filter, sort, holdingsByKey]);

  const alerts = alertsData?.alerts ?? [];

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Market data"
        title="Markets"
        description="Search stocks and crypto, follow live quotes, and move from an idea to an order in one screen."
        actions={
          <>
            <AlertDialog
              defaultSymbol="BTCUSDT"
              defaultAssetType="CRYPTO"
              trigger={
                <Button variant="secondary" size="md">
                  <Bell className="size-4" aria-hidden="true" />
                  Create alert
                </Button>
              }
            />
            <Button asChild variant="primary" size="md">
              <Link href="/orders?new=1">
                <Plus className="size-4" aria-hidden="true" />
                New order
              </Link>
            </Button>
          </>
        }
      />

      <div className="panel relative overflow-hidden p-4 sm:p-5">
        <div
          className="pointer-events-none absolute -right-20 -top-24 size-64 rounded-full opacity-40 blur-3xl"
          style={{
            background:
              "radial-gradient(circle, rgba(108,151,255,.28), transparent 65%)",
          }}
        />
        <div className="relative grid gap-4 lg:grid-cols-[1fr_auto] lg:items-end">
          <div>
            <p className="eyebrow mb-2">Find a market</p>
            <div className="max-w-xl">
              <SymbolSearch
                placeholder="Search AAPL, BTC/USDT, NVIDIA…"
                onSelect={(result) =>
                  router.push(
                    `/markets/${result.symbol}?asset=${result.assetClass}`,
                  )
                }
                inputClassName="h-11 text-[13px]"
              />
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <span className="text-[10.5px] text-fg-subtle">Quick:</span>
              {["AAPL", "NVDA", "TSLA", "BTCUSDT", "ETHUSDT", "SOLUSDT"].map(
                (symbol) => (
                  <Link
                    key={symbol}
                    href={`/markets/${symbol}?asset=${assetTypes[symbol] || (symbol.includes("USDT") ? "CRYPTO" : "STOCK")}`}
                    className="rounded-full border border-line bg-surface-2 px-2 py-0.5 font-mono text-[10px] text-fg-muted transition-colors hover:border-line-strong hover:text-fg"
                  >
                    {tickerOf(symbol)}
                  </Link>
                ),
              )}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 lg:w-[320px]">
            {[
              ["Assets", rows.length || "—"],
              ["Crypto", "24/7"],
              ["Refresh", "Live"],
            ].map(([label, value]) => (
              <div
                key={label}
                className="rounded-[8px] border border-line bg-surface-2/60 px-2.5 py-2"
              >
                <p className="text-[9px] uppercase tracking-[0.08em] text-fg-subtle">
                  {label}
                </p>
                <p className="tnum mt-0.5 text-[12px] font-medium text-fg">
                  {value}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {filter !== "CRYPTO" &&
      rows.some((row) => row.assetType === "STOCK" && !row.quote?.price) ? (
        <Alert tone="info" title="Some stock quotes are unavailable">
          The stock market-data provider did not return a price for every
          symbol. Crypto markets remain live and tradable.
        </Alert>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-12">
        <Card className="xl:col-span-8">
          <CardHeader className="flex-col gap-3 sm:flex-row sm:items-center">
            <SegmentedControl
              options={filters}
              value={filter}
              onChange={setFilter}
              ariaLabel="Asset class"
            />
            <div className="flex items-center gap-2 sm:ml-auto">
              <span className="text-[10.5px] text-fg-subtle">Sort</span>
              <SegmentedControl
                options={[
                  { value: "movers", label: "Movers" },
                  { value: "az", label: "A–Z" },
                ]}
                value={sort}
                onChange={setSort}
                size="sm"
                ariaLabel="Sort markets"
              />
            </div>
          </CardHeader>
          <DataTable
            caption="Markets"
            loading={loading && !rows.length}
            rows={rows}
            getRowKey={(row) => row.symbol}
            onRowClick={(row) =>
              router.push(`/markets/${row.symbol}?asset=${row.assetType}`)
            }
            empty={
              error ? (
                <ErrorState
                  compact
                  code={error.code}
                  title="Market data unavailable"
                  description={error.message}
                  action={
                    <Button variant="secondary" size="sm" onClick={() => mutate()}>
                      Retry
                    </Button>
                  }
                />
              ) : (
                <EmptyState
                  compact
                  icon={ChartCandlestick}
                  title="No markets match this filter"
                  description="Try another asset class or search for a symbol."
                />
              )
            }
            columns={[
              {
                key: "symbol",
                header: "Asset",
                render: (row) => (
                  <div className="flex items-center gap-2.5">
                    <span className="flex size-8 items-center justify-center rounded-full bg-surface-2 text-[9px] font-semibold text-fg-muted">
                      {tickerOf(row.symbol).slice(0, 2)}
                    </span>
                    <div className="min-w-0">
                      <p className="font-mono text-[12px] font-medium text-fg">
                        {tickerOf(row.symbol)}
                        <span className="ml-1.5 text-[9px] text-fg-subtle">
                          {row.assetType === "CRYPTO" ? "/ USDT" : ""}
                        </span>
                      </p>
                      <p className="max-w-[180px] truncate text-[10px] text-fg-subtle">
                        {row.name}
                      </p>
                    </div>
                  </div>
                ),
              },
              {
                key: "price",
                header: "Price",
                align: "right",
                render: (row) =>
                  row.quote?.price ? formatCurrency(row.quote.price) : "—",
              },
              {
                key: "change",
                header: "24h",
                align: "right",
                render: (row) => {
                  const change = Number(row.quote?.changePercent);
                  if (!Number.isFinite(change)) return "—";
                  return (
                    <span
                      className={cn(
                        "tnum text-[12px]",
                        change >= 0 ? "text-up" : "text-down",
                      )}
                    >
                      {formatPercent(change)}
                    </span>
                  );
                },
              },
              {
                key: "high",
                header: "24h high",
                align: "right",
                render: (row) =>
                  row.quote?.high ? formatPrice(row.quote.high) : "—",
              },
              {
                key: "low",
                header: "24h low",
                align: "right",
                render: (row) =>
                  row.quote?.low ? formatPrice(row.quote.low) : "—",
              },
              {
                key: "position",
                header: "Position",
                align: "right",
                render: (row) => {
                  if (row.holding) {
                    return (
                      <div>
                        <p className="tnum text-[11.5px] text-fg">
                          {formatQuantity(row.holding.quantity)}
                        </p>
                        <p className="tnum text-[9.5px] text-fg-subtle">
                          @ {formatPrice(row.holding.averageBuyPrice)} avg
                        </p>
                      </div>
                    );
                  }
                  if (holdingsLoading) {
                    return <span className="text-fg-subtle">…</span>;
                  }
                  if (holdingsError) {
                    return <span className="text-fg-subtle">Unavailable</span>;
                  }
                  return <span className="text-fg-subtle">—</span>;
                },
              },
              {
                key: "trade",
                header: "",
                align: "right",
                render: (row) => (
                  <Link
                    href={`/markets/${row.symbol}?asset=${row.assetType}`}
                    onClick={(event) => event.stopPropagation()}
                    className="inline-flex h-7 items-center rounded-[6px] border border-line bg-surface-2 px-2 text-[10.5px] font-medium text-fg-muted transition-colors hover:border-brand/40 hover:text-brand"
                  >
                    Trade
                  </Link>
                ),
              },
            ]}
          />
        </Card>

        <div className="space-y-4 xl:col-span-4">
          <Card>
            <CardHeader>
              <CardHeading>
                <CardTitle className="flex items-center gap-2">
                  Market pulse
                  <span className="live-dot size-1.5 rounded-full bg-up" />
                </CardTitle>
                <p className="text-[11.5px] text-fg-subtle">
                  Crypto trades 24/7
                </p>
              </CardHeading>
              <CardAction>
                <Badge tone={overviewError ? "warn" : "up"} dot>
                  {overviewError ? "Offline" : "Live"}
                </Badge>
              </CardAction>
            </CardHeader>
            <CardContent>
              {overviewLoading && !overview ? (
                <div className="space-y-2">
                  <Skeleton className="h-10" />
                  <Skeleton className="h-10" />
                  <Skeleton className="h-10" />
                </div>
              ) : overviewError ? (
                <ErrorState
                  compact
                  code={overviewError.code}
                  title="Market overview unavailable"
                  description={overviewError.message}
                />
              ) : (
                <>
                  <div className="mb-3 grid grid-cols-2 gap-2">
                    <div className="rounded-[8px] border border-line bg-surface-2/60 px-2.5 py-2">
                      <p className="text-[9px] uppercase tracking-[0.08em] text-fg-subtle">
                        Session
                      </p>
                      <p className="mt-0.5 text-[11.5px] text-fg">
                        {overview?.marketStatus?.session || "—"}
                      </p>
                    </div>
                    <div className="rounded-[8px] border border-line bg-surface-2/60 px-2.5 py-2">
                      <p className="text-[9px] uppercase tracking-[0.08em] text-fg-subtle">
                        Source
                      </p>
                      <p className="mt-0.5 truncate text-[11.5px] text-fg">
                        {overview?.source || "—"}
                      </p>
                    </div>
                  </div>

                  <p className="eyebrow mb-2">Top movers</p>
                  <ul className="space-y-0.5">
                    {(movers || []).slice(0, 5).map((mover) => {
                      const change = Number(mover.changePercent);
                      return (
                        <li key={mover.symbol}>
                          <Link
                            href={`/markets/${mover.symbol}?asset=CRYPTO`}
                            className="flex items-center justify-between gap-3 rounded-[6px] px-1.5 py-1.5 transition-colors hover:bg-surface-2"
                          >
                            <span className="font-mono text-[11px] text-fg-muted">
                              {tickerOf(mover.symbol)}
                            </span>
                            <span className="tnum text-[11px] text-fg">
                              {formatPrice(mover.price)}
                            </span>
                            <span
                              className={cn(
                                "tnum w-14 text-right text-[10.5px]",
                                change >= 0 ? "text-up" : "text-down",
                              )}
                            >
                              {formatPercent(change)}
                            </span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardHeading>
                <CardTitle>Your active alerts</CardTitle>
                <p className="text-[11.5px] text-fg-subtle">
                  Watching {alerts.length} symbol{alerts.length === 1 ? "" : "s"}
                </p>
              </CardHeading>
              <CardAction>
                <Link
                  href="/alerts"
                  className="text-[11px] font-medium text-brand hover:text-brand-strong"
                >
                  Manage
                </Link>
              </CardAction>
            </CardHeader>
            <CardContent>
              {alertsLoading && !alerts.length ? (
                <Skeleton className="h-24" />
              ) : alerts.length ? (
                <ul className="space-y-1.5">
                  {alerts.map((alert) => (
                    <li
                      key={alert.id}
                      className="flex items-center justify-between gap-3 rounded-[7px] border border-line bg-surface-2/40 px-2.5 py-2"
                    >
                      <div className="min-w-0">
                        <p className="font-mono text-[11px] text-fg">
                          {alert.symbol}
                        </p>
                        <p className="text-[9.5px] text-fg-subtle">
                          {alert.condition.replaceAll("_", " ").toLowerCase()}
                        </p>
                      </div>
                      <span className="tnum text-[11px] text-fg-muted">
                        {alert.condition.startsWith("PERCENT")
                          ? `${formatPrice(alert.targetPrice)}%`
                          : formatPrice(alert.targetPrice)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState
                  compact
                  icon={Bell}
                  title="No active alerts"
                  description="Create an alert to watch a price level without staring at the chart."
                  action={
                    <AlertDialog
                      defaultSymbol="BTCUSDT"
                      defaultAssetType="CRYPTO"
                      trigger={
                        <Button variant="secondary" size="sm">
                          Create alert
                        </Button>
                      }
                    />
                  }
                />
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function MarketsFallback() {
  return (
    <div className="space-y-5">
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-28 w-full" />
      <div className="grid gap-4 xl:grid-cols-12">
        <Skeleton className="h-[420px] xl:col-span-8" />
        <Skeleton className="h-[420px] xl:col-span-4" />
      </div>
    </div>
  );
}

export default function MarketsPage() {
  return (
    <Suspense fallback={<MarketsFallback />}>
      <MarketsContent />
    </Suspense>
  );
}
