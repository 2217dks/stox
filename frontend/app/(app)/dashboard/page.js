"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  ChartCandlestick,
  CircleDollarSign,
  ListOrdered,
  Plus,
  Wallet,
} from "lucide-react";

import { AreaChart } from "@/components/charts/area-chart";
import { AllocationLegend, DonutChart } from "@/components/charts/donut-chart";
import { OrderTicket } from "@/components/market/order-ticket";
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
import { Skeleton, SkeletonStat } from "@/components/ui/skeleton";
import { Stat } from "@/components/ui/stat";
import {
  useActivePortfolio,
  useApi,
  useHoldings,
  useMarketOverview,
  useMounted,
  usePortfolioSummary,
  useQuotes,
} from "@/lib/hooks";
import {
  formatCurrency,
  formatPercent,
  formatPrice,
  formatQuantity,
  formatRelative,
  pnlTone,
  tickerOf,
} from "@/lib/format";
import { ORDER_STATUS } from "@/lib/constants";
import { useSession } from "@/store/use-session";
import { cn } from "@/lib/utils";

const periods = [
  { value: "1W", label: "1W" },
  { value: "1M", label: "1M" },
  { value: "3M", label: "3M" },
  { value: "6M", label: "6M" },
  { value: "1Y", label: "1Y" },
];

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export default function DashboardPage() {
  const router = useRouter();
  const user = useSession((state) => state.user);
  const mounted = useMounted();
  const { portfolio, portfolioId, loading: portfolioLoading } =
    useActivePortfolio();
  const { data: summaryData, loading: summaryLoading, error: summaryError, mutate: mutateSummary } =
    usePortfolioSummary(portfolioId);
  const { data: holdingsData, loading: holdingsLoading } = useHoldings(portfolioId);
  const [period, setPeriod] = useState("1M");

  const { data: heatmapData, loading: heatmapLoading, error: heatmapError, mutate: mutateHeatmap } =
    useApi(portfolioId ? `/portfolios/${portfolioId}/pnl-heatmap` : null, {
      query: { period },
      refreshInterval: 180000,
    });

  const { data: ordersData, loading: ordersLoading } = useApi("/orders", {
    query: { portfolioId, limit: 5 },
    enabled: Boolean(portfolioId),
    refreshInterval: 120000,
  });

  const { movers, overview, loading: moversLoading, error: moversError, mutate: mutateMovers } =
    useMarketOverview("CRYPTO", 5);

  const summary = summaryData?.portfolio ?? portfolio;
  const holdings = (holdingsData?.holdings ?? []).filter(
    (holding) => Number(holding.quantity) !== 0,
  );
  const symbols = holdings.map((holding) => holding.symbol);
  const assetTypes = Object.fromEntries(
    holdings.map((holding) => [holding.symbol, holding.assetType]),
  );
  const { quotes } = useQuotes(symbols, assetTypes);

  const enriched = useMemo(
    () =>
      holdings.map((holding) => {
        const quote = quotes[holding.symbol];
        const quantity = Number(holding.quantity);
        const invested = Number(holding.totalInvested);
        const price = Number(quote?.price || 0);
        const value = price > 0 ? price * quantity : invested;
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

  const liveHoldingsValue = enriched.reduce((sum, holding) => sum + holding.value, 0);
  const cash = Number(summary?.cashBalance ?? 0);
  const startingBalance = Number(summary?.startingBalance ?? 10000);
  const totalValue = cash + liveHoldingsValue;
  const totalPnl = totalValue - startingBalance;
  const totalPnlPct = startingBalance ? (totalPnl / startingBalance) * 100 : 0;
  const availableCash = Number(summary?.availableCash ?? summary?.cashBalance ?? 0);
  const reservedCash = Number(summary?.reservedCash ?? 0);

  const heatmap = heatmapData?.heatmap ?? [];
  const chartData = heatmap.map((day) => ({
    date: day.date,
    value: Number(day.totalValue),
  }));
  const periodReturn =
    chartData.length > 1
      ? ((chartData.at(-1).value - chartData[0].value) / chartData[0].value) * 100
      : null;

  const allocation = useMemo(() => {
    const rows = enriched
      .slice()
      .sort((a, b) => b.value - a.value)
      .map((holding) => ({
        name: holding.symbol,
        value: holding.value,
      }));

    return [{ name: "Cash", value: cash }, ...rows];
  }, [enriched, cash]);

  const orders = ordersData?.orders ?? [];
  const isNew = !portfolioLoading && summary && Number(summary.startingBalance) > 0 && orders.length === 0 && holdings.length === 0;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={`Overview · ${mounted ? new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "Terminal"}`}
        title={
          mounted
            ? `${greeting()}, ${user?.name?.split(" ")[0] || "trader"}`
            : "Welcome back"
        }
        description="Your paper portfolio, live positions and the next decision — in one place."
        actions={
          <>
            <Button asChild variant="secondary" size="md">
              <Link href="/portfolios">
                <Wallet className="size-4" aria-hidden="true" />
                Portfolios
              </Link>
            </Button>
            <Button asChild variant="primary" size="md">
              <Link href="/orders?new=1">
                <Plus className="size-4" aria-hidden="true" />
                New order
              </Link>
            </Button>
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {portfolioLoading || summaryLoading ? (
          <>
            <SkeletonStat />
            <SkeletonStat />
            <SkeletonStat />
            <SkeletonStat />
          </>
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
              deltaLabel={
                reservedCash > 0
                  ? `${formatCurrency(reservedCash)} reserved in orders`
                  : "No cash reserved"
              }
              icon={Wallet}
            />
            <Stat
              label="Invested"
              value={formatCurrency(liveHoldingsValue)}
              deltaLabel={`${holdings.length} ${holdings.length === 1 ? "position" : "positions"}`}
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

      {summaryError ? (
        <ErrorState
          compact
          code={summaryError.code}
          title="Could not load your portfolio"
          description={summaryError.message}
          action={
            <Button variant="secondary" size="sm" onClick={() => mutateSummary()}>
              Try again
            </Button>
          }
        />
      ) : null}

      {isNew ? (
        <div className="flex flex-col items-start justify-between gap-4 rounded-[12px] border border-brand/25 bg-brand-soft px-4 py-3.5 sm:flex-row sm:items-center">
          <div>
            <p className="text-[13px] font-semibold text-fg">
              Your paper account is ready
            </p>
            <p className="mt-0.5 text-[11.5px] text-fg-muted">
              You have {formatCurrency(availableCash)} in virtual cash. Place
              your first order to start tracking performance.
            </p>
          </div>
          <Button asChild variant="primary" size="sm" className="shrink-0">
            <Link href="/markets">Browse markets</Link>
          </Button>
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-12">
        <Card className="xl:col-span-8">
          <CardHeader>
            <CardHeading>
              <CardTitle>Portfolio value</CardTitle>
              <div className="flex items-center gap-2">
                {periodReturn !== null ? (
                  <span
                    className={cn(
                      "tnum text-[11.5px] font-medium",
                      periodReturn >= 0 ? "text-up" : "text-down",
                    )}
                  >
                    {formatPercent(periodReturn)} {period}
                  </span>
                ) : (
                  <span className="text-[11.5px] text-fg-subtle">
                    Snapshot history
                  </span>
                )}
              </div>
            </CardHeading>
            <CardAction>
              <SegmentedControl
                options={periods}
                value={period}
                onChange={setPeriod}
                size="sm"
                ariaLabel="Chart period"
              />
            </CardAction>
          </CardHeader>
          <CardContent>
            {heatmapLoading && chartData.length === 0 ? (
              <Skeleton className="h-[248px] w-full rounded-[10px]" />
            ) : heatmapError ? (
              <ErrorState
                compact
                code={heatmapError.code}
                title="Performance unavailable"
                description={heatmapError.message}
                action={
                  <Button variant="secondary" size="sm" onClick={() => mutateHeatmap()}>
                    Retry
                  </Button>
                }
              />
            ) : chartData.length > 1 ? (
              <AreaChart
                data={chartData}
                height={248}
                tone={periodReturn !== null && periodReturn < 0 ? "down" : "brand"}
                ariaLabel={`Portfolio value over the last ${period}`}
                tooltipLabelFormatter={(value) =>
                  new Date(`${value}T00:00:00Z`).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })
                }
              />
            ) : (
              <EmptyState
                compact
                icon={BarChart3}
                title="Your performance curve starts here"
                description="Daily snapshots build after your first trading day. Place an order to get started."
                action={
                  <Button asChild variant="secondary" size="sm">
                    <Link href="/markets">Explore markets</Link>
                  </Button>
                }
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
            <CardAction>
              <Link
                href="/portfolios"
                className="text-[11px] font-medium text-brand hover:text-brand-strong"
              >
                Details
              </Link>
            </CardAction>
          </CardHeader>
          <CardContent>
            {holdingsLoading && !holdings.length ? (
              <Skeleton className="h-[200px] rounded-full" />
            ) : allocation.length > 1 ? (
              <>
                <DonutChart
                  data={allocation.slice(0, 6)}
                  centerLabel="Total"
                  centerValue={formatCurrency(totalValue, { compact: true })}
                  height={190}
                  ariaLabel="Portfolio allocation by market value"
                />
                <AllocationLegend data={allocation.slice(0, 5)} className="mt-4" />
                {allocation.length > 5 ? (
                  <p className="mt-2 text-[10.5px] text-fg-subtle">
                    +{allocation.length - 5} more positions
                  </p>
                ) : null}
              </>
            ) : (
              <EmptyState
                compact
                icon={Wallet}
                title="No positions yet"
                description="Your cash allocation will split into holdings as you trade."
              />
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-12">
        <Card className="xl:col-span-8">
          <CardHeader>
            <CardHeading>
              <CardTitle>Holdings</CardTitle>
              <p className="text-[11.5px] text-fg-subtle">
                Live market value where a quote is available
              </p>
            </CardHeading>
            <CardAction>
              <Link
                href="/portfolios"
                className="inline-flex items-center gap-1 text-[11px] font-medium text-brand hover:text-brand-strong"
              >
                All holdings
                <ArrowRight className="size-3" aria-hidden="true" />
              </Link>
            </CardAction>
          </CardHeader>
          <DataTable
            caption="Portfolio holdings"
            loading={holdingsLoading && !holdings.length}
            rows={enriched.slice(0, 5)}
            onRowClick={(row) =>
              router.push(`/markets/${row.symbol}?asset=${row.assetType}`)
            }
            empty={
              <EmptyState
                compact
                icon={ChartCandlestick}
                title="No open positions"
                description="Buy a stock or crypto pair to see it here with live P&L."
                action={
                  <Button asChild variant="secondary" size="sm">
                    <Link href="/markets">Find a market</Link>
                  </Button>
                }
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
                key: "price",
                header: "Price",
                align: "right",
                render: (row) =>
                  row.price ? formatPrice(row.price) : "—",
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
                    <p className={cn("tnum text-[12px]", pnlTone(row.pnl))}>
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

        <div className="xl:col-span-4">
          <OrderTicket
            portfolioId={portfolioId}
            portfolio={portfolio}
            defaultSymbol="BTCUSDT"
            defaultAssetType="CRYPTO"
            compact
          />
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-12">
        <Card className="xl:col-span-8">
          <CardHeader>
            <CardHeading>
              <CardTitle>Recent orders</CardTitle>
              <p className="text-[11.5px] text-fg-subtle">
                Latest activity across this portfolio
              </p>
            </CardHeading>
            <CardAction>
              <Link
                href="/orders"
                className="inline-flex items-center gap-1 text-[11px] font-medium text-brand hover:text-brand-strong"
              >
                All orders
                <ArrowRight className="size-3" aria-hidden="true" />
              </Link>
            </CardAction>
          </CardHeader>
          <DataTable
            caption="Recent orders"
            loading={ordersLoading && !orders.length}
            rows={orders}
            getRowKey={(row) => row.id}
            onRowClick={(row) => {
              router.push(`/orders?focus=${row.id}`);
            }}
            empty={
              <EmptyState
                compact
                icon={ListOrdered}
                title="No orders yet"
                description="Your order history and lifecycle events will appear here."
                action={
                  <Button asChild variant="secondary" size="sm">
                    <Link href="/orders?new=1">Place an order</Link>
                  </Button>
                }
              />
            }
            columns={[
              {
                key: "symbol",
                header: "Order",
                render: (row) => (
                  <div className="flex items-center gap-2">
                    <Badge
                      tone={row.side === "BUY" ? "up" : "down"}
                      className="h-[18px] px-1.5 text-[9px]"
                    >
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
                  <span className="text-[11px] text-fg-muted">
                    {row.type.replace("_", " ")}
                  </span>
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
                  return (
                    <Badge tone={config.tone} dot>
                      {config.label}
                    </Badge>
                  );
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

        <Card className="xl:col-span-4">
          <CardHeader>
            <CardHeading>
              <CardTitle className="flex items-center gap-2">
                Market movers
                <span className="live-dot size-1.5 rounded-full bg-up" />
              </CardTitle>
              <p className="text-[11.5px] text-fg-subtle">
                Crypto · {overview?.marketStatus?.session || "24/7"}
              </p>
            </CardHeading>
            <CardAction>
              <Link
                href="/markets?asset=CRYPTO"
                className="text-[11px] font-medium text-brand hover:text-brand-strong"
              >
                Markets
              </Link>
            </CardAction>
          </CardHeader>
          <CardContent>
            {moversLoading && !movers.length ? (
              <div className="space-y-2">
                {[0, 1, 2, 3, 4].map((key) => (
                  <Skeleton key={key} className="h-10 w-full" />
                ))}
              </div>
            ) : moversError ? (
              <ErrorState
                compact
                code={moversError.code}
                title="Market data unavailable"
                description={moversError.message}
                action={
                  <Button variant="secondary" size="sm" onClick={() => mutateMovers()}>
                    Retry
                  </Button>
                }
              />
            ) : movers.length ? (
              <ul className="space-y-1">
                {movers.map((mover) => {
                  const change = Number(mover.changePercent);
                  return (
                    <li key={mover.symbol}>
                      <Link
                        href={`/markets/${mover.symbol}?asset=CRYPTO`}
                        className="flex items-center gap-3 rounded-[7px] px-2 py-2 transition-colors hover:bg-surface-2"
                      >
                        <span className="flex size-7 items-center justify-center rounded-full bg-surface-2 text-[9px] font-semibold text-fg-muted">
                          {tickerOf(mover.symbol).slice(0, 2)}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block font-mono text-[11.5px] font-medium text-fg">
                            {tickerOf(mover.symbol)}
                          </span>
                          <span className="tnum block text-[10px] text-fg-subtle">
                            {formatPrice(mover.price)}
                          </span>
                        </span>
                        <span
                          className={cn(
                            "tnum text-[11px] font-medium",
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
            ) : (
              <EmptyState
                compact
                icon={ChartCandlestick}
                title="No movers right now"
                description="Provider data will appear here as the market moves."
              />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
