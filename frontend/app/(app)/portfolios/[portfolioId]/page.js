"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowUpRight,
  BarChart3,
  CircleDollarSign,
  Gauge,
  ListOrdered,
  Pencil,
  Plus,
  RefreshCw,
  ShieldAlert,
  Target,
  TrendingDown,
  Wallet,
} from "lucide-react";

import { AreaChart } from "@/components/charts/area-chart";
import { MonthlyBarChart } from "@/components/charts/bar-chart";
import { AllocationLegend, DonutChart } from "@/components/charts/donut-chart";
import { LineChart } from "@/components/charts/line-chart";
import { PnlHeatmap } from "@/components/charts/pnl-heatmap";
import { DeactivatePortfolioDialog } from "@/components/portfolios/deactivate-portfolio-dialog";
import { PortfolioDialog } from "@/components/portfolios/portfolio-dialog";
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
import { SegmentedControl } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { Stat } from "@/components/ui/stat";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useApi, useHoldings, useQuotes } from "@/lib/hooks";
import { ORDER_STATUS } from "@/lib/constants";
import {
  formatCurrency,
  formatDate,
  formatNumber,
  formatPercent,
  formatPrice,
  formatQuantity,
  formatRelative,
  pnlTone,
  tickerOf,
} from "@/lib/format";
import { cn } from "@/lib/utils";

const analyticsPeriods = [
  { value: "1M", label: "1M" },
  { value: "3M", label: "3M" },
  { value: "6M", label: "6M" },
  { value: "1Y", label: "1Y" },
];

/** Index both return series from 100 so they share one axis. */
function buildIndexedComparison(rows = []) {
  let portfolioIndex = 100;
  let benchmarkIndex = 100;

  return rows.map((row) => {
    if (row.portfolioReturn != null) {
      portfolioIndex *= 1 + Number(row.portfolioReturn);
    }
    if (row.benchmarkReturn != null) {
      benchmarkIndex *= 1 + Number(row.benchmarkReturn);
    }
    return {
      date: row.date,
      portfolio: Number(portfolioIndex.toFixed(2)),
      benchmark: Number(benchmarkIndex.toFixed(2)),
    };
  });
}

function RiskCard({ icon: Icon, label, value, hint, tone }) {
  return (
    <div className="rounded-[10px] border border-line bg-surface-2/50 p-3.5">
      <div className="flex items-center justify-between">
        <p className="text-[9px] uppercase tracking-[0.08em] text-fg-subtle">
          {label}
        </p>
        <Icon className="size-3.5 text-fg-subtle" aria-hidden="true" />
      </div>
      <p
        className={cn(
          "tnum mt-2 text-[20px] font-semibold tracking-[-0.03em]",
          tone || "text-fg",
        )}
      >
        {value}
      </p>
      {hint ? <p className="mt-1 text-[9.5px] text-fg-subtle">{hint}</p> : null}
    </div>
  );
}

export default function PortfolioDetailPage() {
  const params = useParams();
  const router = useRouter();
  const portfolioId = params.portfolioId;
  const [tab, setTab] = useState("overview");
  const [period, setPeriod] = useState("1M");

  const {
    data: portfolioData,
    loading: portfolioLoading,
    error: portfolioError,
    mutate: mutatePortfolio,
  } = useApi(`/portfolios/${portfolioId}`);
  const { data: summaryData, loading: summaryLoading } = useApi(
    `/portfolios/${portfolioId}/summary`,
    { refreshInterval: 120000 },
  );
  const { data: holdingsData, loading: holdingsLoading } = useHoldings(portfolioId);
  const { data: ordersData, loading: ordersLoading } = useApi("/orders", {
    query: { portfolioId, limit: 8 },
    refreshInterval: 120000,
  });
  const { data: tradesData, loading: tradesLoading } = useApi("/trades", {
    query: { portfolioId, limit: 20 },
    refreshInterval: 120000,
  });

  const analyticsEnabled = tab === "analytics";

  const { data: heatmapData, loading: heatmapLoading, error: heatmapError } =
    useApi(`/portfolios/${portfolioId}/pnl-heatmap`, {
      query: { period },
      enabled: analyticsEnabled,
    });
  const { data: riskData, loading: riskLoading, error: riskError } = useApi(
    `/portfolios/${portfolioId}/risk-metrics`,
    { query: { period }, enabled: analyticsEnabled },
  );
  const {
    data: monthlyData,
    loading: monthlyLoading,
    error: monthlyError,
  } = useApi(`/portfolios/${portfolioId}/monthly-performance`, {
    enabled: analyticsEnabled,
  });
  const {
    data: benchmarkData,
    loading: benchmarkLoading,
    error: benchmarkError,
  } = useApi(`/portfolios/${portfolioId}/benchmark-comparison`, {
    query: { period, symbol: "SPY" },
    enabled: analyticsEnabled,
  });

  const benchmarkHistoryUnavailable =
    benchmarkError?.code === "MARKET_DATA_INVALID_CREDENTIALS" ||
    benchmarkError?.code === "MARKET_DATA_PROVIDER_UNAVAILABLE";

  const portfolio = portfolioData?.portfolio;
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

  const enriched = useMemo(
    () =>
      holdings.map((holding) => {
        const price = Number(quotes[holding.symbol]?.price || 0);
        const invested = Number(holding.totalInvested);
        const value = price > 0 ? price * Number(holding.quantity) : invested;
        const pnl = value - invested;
        return {
          ...holding,
          price,
          value,
          pnl,
          pnlPct: invested > 0 ? (pnl / invested) * 100 : 0,
        };
      }),
    [holdings, quotes],
  );

  const liveValue = enriched.reduce((sum, holding) => sum + holding.value, 0);
  const cash = Number(summary?.cashBalance ?? portfolio?.cashBalance ?? 0);
  const availableCash = Number(
    summary?.availableCash ?? portfolio?.availableCash ?? cash,
  );
  const starting = Number(summary?.startingBalance ?? portfolio?.startingBalance ?? 10000);
  const totalValue = cash + liveValue;
  const totalPnl = totalValue - starting;
  const totalPnlPct = starting ? (totalPnl / starting) * 100 : 0;

  const heatmap = heatmapData?.heatmap ?? [];
  const valueChart = heatmap.map((day) => ({
    date: day.date,
    value: Number(day.totalValue),
  }));
  const periodReturn =
    valueChart.length > 1
      ? ((valueChart.at(-1).value - valueChart[0].value) / valueChart[0].value) * 100
      : null;

  const allocation = [{ name: "Cash", value: cash }, ...enriched.map((holding) => ({ name: holding.symbol, value: holding.value }))];

  const metrics = riskData?.metrics;
  const benchmarkSummary = benchmarkData?.summary;
  const benchmarkChart = useMemo(
    () => buildIndexedComparison(benchmarkData?.comparison),
    [benchmarkData],
  );

  const monthly = monthlyData?.months ?? [];
  const monthlyChart = monthly
    .filter((month) => month.netPnl !== null)
    .map((month) => ({ month: month.month, netPnl: Number(month.netPnl) }));
  const orders = ordersData?.orders ?? [];
  const trades = tradesData?.trades ?? [];

  if (portfolioLoading && !portfolio) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-16 w-72" />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((key) => (
            <Skeleton key={key} className="h-[120px]" />
          ))}
        </div>
        <Skeleton className="h-[420px]" />
      </div>
    );
  }

  if (portfolioError) {
    return (
      <ErrorState
        code={portfolioError.code}
        title="Portfolio not found"
        description={portfolioError.message}
        action={
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => mutatePortfolio()}>
              <RefreshCw className="size-3.5" aria-hidden="true" />
              Retry
            </Button>
            <Button asChild variant="primary" size="sm">
              <Link href="/portfolios">Back to portfolios</Link>
            </Button>
          </div>
        }
      />
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2 text-[11.5px] text-fg-subtle">
        <Link
          href="/portfolios"
          className="inline-flex items-center gap-1 transition-colors hover:text-fg"
        >
          <ArrowLeft className="size-3.5" aria-hidden="true" />
          Portfolios
        </Link>
        <span aria-hidden="true">/</span>
        <span className="text-fg-muted">{portfolio?.name}</span>
      </div>

      <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-[27px] font-semibold leading-tight tracking-[-0.035em] text-fg">
              {portfolio?.name}
            </h1>
            {portfolio?.isDefault ? <Badge tone="brand">Default</Badge> : null}
            {portfolio?.isActive === false ? (
              <Badge tone="neutral">Inactive</Badge>
            ) : null}
          </div>
          <p className="mt-1 max-w-[62ch] text-[12.5px] leading-relaxed text-fg-muted">
            {portfolio?.description || "No description for this portfolio."}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <PortfolioDialog
            portfolio={portfolio}
            trigger={
              <Button variant="secondary" size="md">
                <Pencil className="size-3.5" aria-hidden="true" />
                Edit
              </Button>
            }
          />
          {portfolio?.isDefault ? null : (
            <DeactivatePortfolioDialog portfolio={portfolio} />
          )}
          <Button asChild variant="primary" size="md">
            <Link href={`/orders?new=1&portfolioId=${portfolioId}`}>
              <Plus className="size-4" aria-hidden="true" />
              New order
            </Link>
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {summaryLoading && !summary ? (
          [0, 1, 2, 3].map((key) => <Skeleton key={key} className="h-[120px]" />)
        ) : (
          <>
            <Stat
              label="Total value"
              value={formatCurrency(totalValue)}
              delta={formatPercent(totalPnlPct)}
              deltaLabel="all time"
              icon={CircleDollarSign}
            />
            <Stat
              label="Available cash"
              value={formatCurrency(availableCash)}
              deltaLabel={`${formatCurrency(cash)} balance`}
              icon={Wallet}
            />
            <Stat
              label="Invested"
              value={formatCurrency(liveValue)}
              deltaLabel={`${holdings.length} positions`}
              icon={BarChart3}
            />
            <Stat
              label="Total P&L"
              value={formatCurrency(totalPnl, { signed: true })}
              delta={formatPercent(totalPnlPct)}
              deltaLabel="vs. starting balance"
              tone={totalPnl >= 0 ? "up" : "down"}
              icon={ArrowUpRight}
            />
          </>
        )}
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <div className="grid gap-4 xl:grid-cols-12">
            <Card className="xl:col-span-8">
              <CardHeader>
                <CardHeading>
                  <CardTitle>Portfolio value</CardTitle>
                  {periodReturn !== null ? (
                    <span
                      className={cn(
                        "tnum text-[11.5px]",
                        periodReturn >= 0 ? "text-up" : "text-down",
                      )}
                    >
                      {formatPercent(periodReturn)} · {period}
                    </span>
                  ) : (
                    <p className="text-[11.5px] text-fg-subtle">
                      Daily snapshots
                    </p>
                  )}
                </CardHeading>
                <CardAction>
                  <button
                    type="button"
                    onClick={() => setTab("analytics")}
                    className="text-[11px] font-medium text-brand hover:text-brand-strong"
                  >
                    Analytics →
                  </button>
                </CardAction>
              </CardHeader>
              <CardContent>
                {valueChart.length > 1 ? (
                  <AreaChart
                    data={valueChart}
                    height={260}
                    tone={periodReturn !== null && periodReturn < 0 ? "down" : "brand"}
                    ariaLabel="Portfolio value over time"
                  />
                ) : (
                  <EmptyState
                    compact
                    icon={BarChart3}
                    title="No snapshot history yet"
                    description="Value snapshots are written daily. Check back after your first trading day."
                  />
                )}
              </CardContent>
            </Card>

            <Card className="xl:col-span-4">
              <CardHeader>
                <CardHeading>
                  <CardTitle>Allocation</CardTitle>
                  <p className="text-[11.5px] text-fg-subtle">By market value</p>
                </CardHeading>
              </CardHeader>
              <CardContent>
                {allocation.length > 1 ? (
                  <>
                    <DonutChart
                      data={allocation.slice(0, 6)}
                      centerLabel="Total"
                      centerValue={formatCurrency(totalValue, { compact: true })}
                      height={190}
                      ariaLabel="Portfolio allocation"
                    />
                    <AllocationLegend data={allocation.slice(0, 5)} className="mt-4" />
                  </>
                ) : (
                  <EmptyState
                    compact
                    icon={Wallet}
                    title="All cash"
                    description="Positions will split this allocation as you trade."
                  />
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardHeading>
                <CardTitle>Holdings</CardTitle>
                <p className="text-[11.5px] text-fg-subtle">
                  Live value and P&L for open positions
                </p>
              </CardHeading>
              <CardAction>
                <Button asChild variant="secondary" size="sm">
                  <Link href={`/markets?asset=STOCK`}>Trade</Link>
                </Button>
              </CardAction>
            </CardHeader>
            <DataTable
              caption="Portfolio holdings"
              loading={holdingsLoading && !holdings.length}
              rows={enriched}
              onRowClick={(row) => {
                router.push(`/markets/${row.symbol}?asset=${row.assetType}`);
              }}
              empty={
                <EmptyState
                  compact
                  icon={BarChart3}
                  title="No open positions"
                  description="Place an order to start building this portfolio."
                />
              }
              columns={[
                {
                  key: "symbol",
                  header: "Asset",
                  render: (row) => (
                    <div className="flex items-center gap-2.5">
                      <span className="flex size-7 items-center justify-center rounded-full bg-surface-2 text-[9px] font-semibold text-fg-muted">
                        {tickerOf(row.symbol).slice(0, 2)}
                      </span>
                      <div>
                        <p className="font-mono text-[11.5px] font-medium text-fg">
                          {row.symbol}
                        </p>
                        <p className="text-[10px] text-fg-subtle">
                          {formatQuantity(row.quantity)} units
                        </p>
                      </div>
                    </div>
                  ),
                },
                {
                  key: "averageBuyPrice",
                  header: "Avg price",
                  align: "right",
                  render: (row) => formatPrice(row.averageBuyPrice),
                },
                {
                  key: "price",
                  header: "Price",
                  align: "right",
                  render: (row) => (row.price ? formatPrice(row.price) : "—"),
                },
                {
                  key: "value",
                  header: "Value",
                  align: "right",
                  render: (row) => formatCurrency(row.value),
                },
                {
                  key: "pnl",
                  header: "P&L",
                  align: "right",
                  render: (row) => (
                    <div>
                      <p className={cn("tnum", pnlTone(row.pnl))}>
                        {formatCurrency(row.pnl, { signed: true })}
                      </p>
                      <p className={cn("tnum text-[10px]", pnlTone(row.pnl))}>
                        {formatPercent(row.pnlPct)}
                      </p>
                    </div>
                  ),
                },
              ]}
            />
          </Card>

          <Card>
            <CardHeader>
              <CardHeading>
                <CardTitle>Recent orders</CardTitle>
                <p className="text-[11.5px] text-fg-subtle">
                  Latest orders in this portfolio
                </p>
              </CardHeading>
              <CardAction>
                <Link
                  href="/orders"
                  className="text-[11px] font-medium text-brand hover:text-brand-strong"
                >
                  All orders
                </Link>
              </CardAction>
            </CardHeader>
            <DataTable
              caption="Recent portfolio orders"
              loading={ordersLoading && !orders.length}
              rows={orders.slice(0, 6)}
              empty={
                <EmptyState
                  compact
                  icon={ListOrdered}
                  title="No orders yet"
                  description="Orders placed in this portfolio will appear here."
                />
              }
              columns={[
                {
                  key: "symbol",
                  header: "Order",
                  render: (row) => (
                    <div className="flex items-center gap-2">
                      <Badge tone={row.side === "BUY" ? "up" : "down"}>
                        {row.side}
                      </Badge>
                      <span className="font-mono text-[11.5px] text-fg">
                        {row.symbol}
                      </span>
                    </div>
                  ),
                },
                {
                  key: "type",
                  header: "Type",
                  render: (row) => (
                    <span className="text-[11px]">{row.type.replace("_", " ")}</span>
                  ),
                },
                {
                  key: "quantity",
                  header: "Qty",
                  align: "right",
                  render: (row) => formatQuantity(row.quantity),
                },
                {
                  key: "price",
                  header: "Price",
                  align: "right",
                  render: (row) =>
                    row.executedPrice
                      ? formatPrice(row.executedPrice)
                      : row.limitPrice
                        ? formatPrice(row.limitPrice)
                        : row.stopPrice
                          ? formatPrice(row.stopPrice)
                          : "Market",
                },
                {
                  key: "status",
                  header: "Status",
                  render: (row) => {
                    const config = ORDER_STATUS[row.status] || ORDER_STATUS.PENDING;
                    return <Badge tone={config.tone} dot>{config.label}</Badge>;
                  },
                },
                {
                  key: "createdAt",
                  header: "Placed",
                  align: "right",
                  render: (row) => (
                    <span className="text-[10.5px] text-fg-subtle">
                      {formatRelative(row.createdAt)}
                    </span>
                  ),
                },
              ]}
            />
          </Card>
        </TabsContent>

        <TabsContent value="analytics" className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-[12px] text-fg-muted">
              Risk and benchmark analytics use daily portfolio snapshots.
            </p>
            <SegmentedControl
              options={analyticsPeriods}
              value={period}
              onChange={setPeriod}
              size="sm"
              ariaLabel="Analytics period"
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {riskLoading && !metrics ? (
              [0, 1, 2, 3].map((key) => <Skeleton key={key} className="h-[112px]" />)
            ) : riskError ? (
              <div className="sm:col-span-2 xl:col-span-4">
                <ErrorState
                  compact
                  code={riskError.code}
                  title="Risk metrics unavailable"
                  description={riskError.message}
                />
              </div>
            ) : (
              <>
                <RiskCard
                  icon={Gauge}
                  label="Annualized volatility"
                  value={
                    metrics?.annualizedVolatility != null
                      ? formatPercent(Number(metrics.annualizedVolatility) * 100, { signed: false })
                      : "—"
                  }
                  hint={`${metrics?.observationCount ?? 0} observations`}
                />
                <RiskCard
                  icon={ShieldAlert}
                  label="Max drawdown"
                  value={
                    metrics?.maxDrawdown != null
                      ? formatPercent(Number(metrics.maxDrawdown) * 100)
                      : "—"
                  }
                  hint={
                    metrics?.peakDate
                      ? `Peak ${formatDate(metrics.peakDate)}`
                      : "Peak unavailable"
                  }
                  tone="text-down"
                />
                <RiskCard
                  icon={TrendingDown}
                  label="Current drawdown"
                  value={
                    metrics?.currentDrawdown != null
                      ? formatPercent(Number(metrics.currentDrawdown) * 100)
                      : "—"
                  }
                  hint={
                    metrics?.peakValue
                      ? `Peak value ${formatCurrency(metrics.peakValue, { compact: true })}`
                      : "No peak yet"
                  }
                />
                <RiskCard
                  icon={Target}
                  label="Sharpe ratio"
                  value={metrics?.sharpeRatio ?? "—"}
                  hint="Annualized, 2% risk-free"
                  tone={Number(metrics?.sharpeRatio) >= 1 ? "text-up" : undefined}
                />
              </>
            )}
          </div>

          <Card>
            <CardHeader>
              <CardHeading>
                <CardTitle>Daily P&L heatmap</CardTitle>
                <p className="text-[11.5px] text-fg-subtle">
                  {heatmapData?.summary
                    ? `${formatCurrency(heatmapData.summary.totalPnl, { signed: true })} total · ${heatmapData.summary.winDays} up / ${heatmapData.summary.lossDays} down`
                    : "Daily performance across the selected period"}
                </p>
              </CardHeading>
            </CardHeader>
            <CardContent>
              {heatmapLoading && !heatmap.length ? (
                <Skeleton className="h-[170px]" />
              ) : heatmapError ? (
                <ErrorState
                  compact
                  code={heatmapError.code}
                  title="Heatmap unavailable"
                  description={heatmapError.message}
                />
              ) : (
                <PnlHeatmap data={heatmap} />
              )}
            </CardContent>
          </Card>

          <div className="grid gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader>
                <CardHeading>
                  <CardTitle>Monthly performance</CardTitle>
                  <p className="text-[11.5px] text-fg-subtle">Net P&L by month</p>
                </CardHeading>
              </CardHeader>
              <CardContent>
                {monthlyLoading && !monthly.length ? (
                  <Skeleton className="h-[220px]" />
                ) : monthlyError ? (
                  <ErrorState
                    compact
                    code={monthlyError.code}
                    title="Monthly performance unavailable"
                    description={monthlyError.message}
                  />
                ) : monthlyChart.length ? (
                  <MonthlyBarChart data={monthlyChart} height={220} />
                ) : (
                  <EmptyState
                    compact
                    icon={BarChart3}
                    title="No monthly performance"
                    description="Monthly aggregation appears after snapshots accumulate."
                  />
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardHeading>
                  <CardTitle>Benchmark vs. SPY</CardTitle>
                  <p className="text-[11.5px] text-fg-subtle">
                    Cumulative indexed return
                  </p>
                </CardHeading>
              </CardHeader>
              <CardContent>
                {benchmarkLoading && !benchmarkData ? (
                  <Skeleton className="h-[220px]" />
                ) : benchmarkError ? (
                  <ErrorState
                    compact
                    code={benchmarkHistoryUnavailable ? null : benchmarkError.code}
                    title={
                      benchmarkHistoryUnavailable
                        ? "Benchmark needs historical data"
                        : "Benchmark unavailable"
                    }
                    description={
                      benchmarkHistoryUnavailable
                        ? "SPY comparison requires historical stock candles, which the current market-data plan does not include."
                        : benchmarkError.message
                    }
                  />
                ) : benchmarkChart.length > 1 ? (
                  <>
                    <LineChart
                      data={benchmarkChart}
                      height={190}
                      series={[
                        {
                          key: "portfolio",
                          label: "Portfolio",
                          color: "var(--brand)",
                        },
                        {
                          key: "benchmark",
                          label: "SPY",
                          color: "var(--chart-4)",
                        },
                      ]}
                      yFormatter={(value) => formatNumber(value, { maximumFractionDigits: 1 })}
                      ariaLabel="Portfolio vs SPY cumulative return"
                    />
                    <div className="mt-2 flex items-center gap-4 text-[10px] text-fg-subtle">
                      <span className="flex items-center gap-1.5">
                        <span className="size-1.5 rounded-full bg-brand" />
                        Portfolio
                      </span>
                      <span className="flex items-center gap-1.5">
                        <span className="size-1.5 rounded-full bg-chart-4" />
                        SPY
                      </span>
                    </div>
                  </>
                ) : (
                  <EmptyState
                    compact
                    icon={Gauge}
                    title="Not enough overlap"
                    description="Benchmark comparison needs snapshot history and a benchmark quote."
                  />
                )}
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {[
              {
                label: "Portfolio return",
                value:
                  benchmarkSummary?.portfolioReturn != null
                    ? formatPercent(Number(benchmarkSummary.portfolioReturn) * 100)
                    : "—",
                tone:
                  Number(benchmarkSummary?.portfolioReturn) >= 0
                    ? "text-up"
                    : "text-down",
              },
              {
                label: "SPY return",
                value:
                  benchmarkSummary?.benchmarkReturn != null
                    ? formatPercent(Number(benchmarkSummary.benchmarkReturn) * 100)
                    : "—",
                tone:
                  Number(benchmarkSummary?.benchmarkReturn) >= 0
                    ? "text-up"
                    : "text-down",
              },
              {
                label: "Alpha",
                value:
                  benchmarkSummary?.alpha != null
                    ? formatPercent(Number(benchmarkSummary.alpha) * 100)
                    : "—",
                tone: "text-fg",
              },
              {
                label: "Beta",
                value: benchmarkSummary?.beta ?? "—",
                tone: "text-fg",
              },
              {
                label: "Correlation",
                value: benchmarkSummary?.correlation ?? "—",
                tone: "text-fg",
              },
            ].map((item) => (
              <div
                key={item.label}
                className="rounded-[10px] border border-line bg-surface-2/50 px-3 py-2.5"
              >
                <p className="text-[9px] uppercase tracking-[0.08em] text-fg-subtle">
                  {item.label}
                </p>
                <p className={cn("tnum mt-1 text-[15px] font-semibold", item.tone)}>
                  {item.value}
                </p>
              </div>
            ))}
          </div>

          <Card>
            <CardHeader>
              <CardHeading>
                <CardTitle>Monthly breakdown</CardTitle>
                <p className="text-[11.5px] text-fg-subtle">
                  Valuation, realized and unrealized P&L
                </p>
              </CardHeading>
            </CardHeader>
            <DataTable
              caption="Monthly performance breakdown"
              loading={monthlyLoading && !monthly.length}
              rows={monthly}
              getRowKey={(row) => row.month}
              empty={
                <EmptyState
                  compact
                  icon={BarChart3}
                  title="No months with data"
                  description="Monthly rows appear once trades or snapshots exist."
                />
              }
              columns={[
                {
                  key: "month",
                  header: "Month",
                  render: (row) => (
                    <span className="text-[12px] text-fg">{row.month}</span>
                  ),
                },
                {
                  key: "startValue",
                  header: "Start",
                  align: "right",
                  render: (row) =>
                    row.startValue ? formatCurrency(row.startValue) : "—",
                },
                {
                  key: "endValue",
                  header: "End",
                  align: "right",
                  render: (row) =>
                    row.endValue ? formatCurrency(row.endValue) : "—",
                },
                {
                  key: "returnPct",
                  header: "Return",
                  align: "right",
                  render: (row) =>
                    row.returnPct != null ? (
                      <span className={pnlTone(row.returnPct)}>
                        {formatPercent(row.returnPct)}
                      </span>
                    ) : (
                      "—"
                    ),
                },
                {
                  key: "netPnl",
                  header: "Net P&L",
                  align: "right",
                  render: (row) =>
                    row.netPnl != null ? (
                      <span className={pnlTone(row.netPnl)}>
                        {formatCurrency(row.netPnl, { signed: true })}
                      </span>
                    ) : (
                      "—"
                    ),
                },
                {
                  key: "realizedPnl",
                  header: "Realized",
                  align: "right",
                  render: (row) =>
                    row.realizedPnl != null
                      ? formatCurrency(row.realizedPnl, { signed: true })
                      : "—",
                },
                {
                  key: "snapshotCount",
                  header: "Snapshots",
                  align: "right",
                  render: (row) => row.snapshotCount ?? 0,
                },
              ]}
            />
          </Card>
        </TabsContent>

        <TabsContent value="activity" className="space-y-4">
          <Card>
            <CardHeader>
              <CardHeading>
                <CardTitle>Order history</CardTitle>
                <p className="text-[11.5px] text-fg-subtle">
                  Latest 8 orders in this portfolio
                </p>
              </CardHeading>
              <CardAction>
                <Link
                  href="/orders"
                  className="text-[11px] font-medium text-brand hover:text-brand-strong"
                >
                  Full history
                </Link>
              </CardAction>
            </CardHeader>
            <DataTable
              caption="Portfolio order history"
              loading={ordersLoading && !orders.length}
              rows={orders}
              empty={
                <EmptyState
                  compact
                  icon={ListOrdered}
                  title="No orders"
                  description="Orders in this portfolio will appear here."
                />
              }
              columns={[
                {
                  key: "createdAt",
                  header: "Time",
                  render: (row) => (
                    <span className="text-[10.5px] text-fg-subtle">
                      {formatRelative(row.createdAt)}
                    </span>
                  ),
                },
                {
                  key: "symbol",
                  header: "Order",
                  render: (row) => (
                    <div className="flex items-center gap-2">
                      <Badge tone={row.side === "BUY" ? "up" : "down"}>
                        {row.side}
                      </Badge>
                      <span className="font-mono text-[11.5px]">{row.symbol}</span>
                    </div>
                  ),
                },
                {
                  key: "type",
                  header: "Type",
                  render: (row) => row.type.replace("_", " "),
                },
                {
                  key: "quantity",
                  header: "Qty",
                  align: "right",
                  render: (row) => formatQuantity(row.quantity),
                },
                {
                  key: "status",
                  header: "Status",
                  render: (row) => {
                    const config = ORDER_STATUS[row.status] || ORDER_STATUS.PENDING;
                    return <Badge tone={config.tone} dot>{config.label}</Badge>;
                  },
                },
              ]}
            />
          </Card>

          <Card>
            <CardHeader>
              <CardHeading>
                <CardTitle>Trade history</CardTitle>
                <p className="text-[11.5px] text-fg-subtle">
                  Every fill in this portfolio
                </p>
              </CardHeading>
              <CardAction>
                <Link
                  href="/trades"
                  className="text-[11px] font-medium text-brand hover:text-brand-strong"
                >
                  All trades
                </Link>
              </CardAction>
            </CardHeader>
            <DataTable
              caption="Portfolio trade history"
              loading={tradesLoading && !trades.length}
              rows={trades}
              empty={
                <EmptyState
                  compact
                  icon={CircleDollarSign}
                  title="No trades"
                  description="Executed fills will appear here."
                />
              }
              columns={[
                {
                  key: "executedAt",
                  header: "Time",
                  render: (row) => (
                    <span className="text-[10.5px] text-fg-subtle">
                      {formatRelative(row.executedAt)}
                    </span>
                  ),
                },
                {
                  key: "symbol",
                  header: "Trade",
                  render: (row) => (
                    <div className="flex items-center gap-2">
                      <Badge tone={row.side === "BUY" ? "up" : "down"}>
                        {row.side}
                      </Badge>
                      <span className="font-mono text-[11.5px]">{row.symbol}</span>
                    </div>
                  ),
                },
                {
                  key: "quantity",
                  header: "Qty",
                  align: "right",
                  render: (row) => formatQuantity(row.quantity),
                },
                {
                  key: "price",
                  header: "Price",
                  align: "right",
                  render: (row) => formatPrice(row.price),
                },
                {
                  key: "totalValue",
                  header: "Value",
                  align: "right",
                  render: (row) => formatCurrency(row.totalValue),
                },
                {
                  key: "realizedPnl",
                  header: "Realized",
                  align: "right",
                  render: (row) =>
                    row.realizedPnl != null ? (
                      <span className={pnlTone(row.realizedPnl)}>
                        {formatCurrency(row.realizedPnl, { signed: true })}
                      </span>
                    ) : (
                      "—"
                    ),
                },
              ]}
            />
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
