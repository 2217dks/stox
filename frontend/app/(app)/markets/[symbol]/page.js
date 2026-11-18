"use client";

import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import useSWR from "swr";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Bell,
  ChartCandlestick,
  CircleDollarSign,
  Radio,
  RefreshCw,
} from "lucide-react";

import { CandleChart } from "@/components/charts/candle-chart";
import { AlertDialog } from "@/components/alerts/alert-dialog";
import { OrderTicket } from "@/components/market/order-ticket";
import { SentimentCard } from "@/components/market/sentiment-card";
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
import { useApi, useActivePortfolio, useHoldings, useMarketStream, useQuote } from "@/lib/hooks";
import { marketApi } from "@/lib/endpoints";
import { CHART_INTERVALS, CURATED_MARKET_META } from "@/lib/constants";
import {
  formatCurrency,
  formatPercent,
  formatPrice,
  formatQuantity,
  formatRelative,
  isCrypto,
  pnlTone,
  tickerOf,
} from "@/lib/format";
import { cn, normalizeMarketSymbol } from "@/lib/utils";

const intervalOptions = CHART_INTERVALS.map((interval) => ({
  value: interval.value,
  label: interval.label,
}));

function Stat({ label, value, hint }) {
  return (
    <div className="min-w-0 px-3 py-2.5">
      <p className="text-[9px] uppercase tracking-[0.08em] text-fg-subtle">
        {label}
      </p>
      <p className="tnum mt-0.5 truncate text-[12px] text-fg">{value}</p>
      {hint ? <p className="text-[9px] text-fg-subtle">{hint}</p> : null}
    </div>
  );
}

function MarketDetail() {
  const params = useParams();
  const searchParams = useSearchParams();
  const rawSymbol = normalizeMarketSymbol(
    decodeURIComponent(params.symbol || ""),
  ).toUpperCase();
  const assetParam = searchParams.get("asset");
  const assetType =
    assetParam === "CRYPTO" || assetParam === "STOCK"
      ? assetParam
      : isCrypto(rawSymbol)
        ? "CRYPTO"
        : "STOCK";

  const [interval, setInterval] = useState(assetType === "CRYPTO" ? "1h" : "1d");
  const [mode, setMode] = useState("candles");

  const { portfolio, portfolioId } = useActivePortfolio();
  const { quote, loading: quoteLoading, error: quoteError, mutate: mutateQuote } =
    useQuote(rawSymbol, assetType, { refreshInterval: 60000 });
  const tick = useMarketStream(rawSymbol, assetType);
  const { data: searchData } = useApi("/market/search", {
    query: { query: rawSymbol, assetClass: assetType, limit: 1 },
    enabled: rawSymbol.length >= 2,
  });
  const { data: holdingsData } = useHoldings(portfolioId);
  const { data: alertsData, loading: alertsLoading } = useApi("/alerts", {
    query: { symbol: rawSymbol, status: "ACTIVE", limit: 5 },
    refreshInterval: 180000,
  });
  const { data: tradesData, loading: tradesLoading } = useApi("/trades", {
    query: { symbol: rawSymbol, portfolioId, limit: 6 },
    refreshInterval: 120000,
  });

  const intervalConfig =
    CHART_INTERVALS.find((item) => item.value === interval) || CHART_INTERVALS[3];

  const {
    data: history,
    isLoading: historyLoading,
    error: historyError,
    mutate: mutateHistory,
  } = useSWR(
    `history:${assetType}:${rawSymbol}:${interval}`,
    () => {
      const to = Date.now();
      const from = to - intervalConfig.duration;
      return marketApi.history(rawSymbol, {
        interval,
        from,
        to,
        limit: 800,
        assetClass: assetType,
      });
    },
    { refreshInterval: 180000, shouldRetryOnError: false, keepPreviousData: true },
  );

  const holding = (holdingsData?.holdings ?? []).find(
    (item) => item.symbol === rawSymbol && Number(item.quantity) !== 0,
  );
  const holdingValue = holding
    ? Number(holding.quantity) * Number(quote?.price || 0)
    : 0;
  const holdingPnl = holding ? holdingValue - Number(holding.totalInvested) : 0;
  const holdingPnlPct =
    holding && Number(holding.totalInvested) > 0
      ? (holdingPnl / Number(holding.totalInvested)) * 100
      : 0;

  const price = tick?.price || quote?.price;
  const change = Number(quote?.changePercent || 0);
  const isUp = change >= 0;
  const name =
    CURATED_MARKET_META[rawSymbol]?.name ||
    (Array.isArray(searchData) ? searchData[0]?.name : null) ||
    rawSymbol;

  const prices = useMemo(() => history?.prices ?? [], [history]);
  const stockHistoryUnavailable =
    assetType === "STOCK" &&
    (historyError?.code === "MARKET_DATA_INVALID_CREDENTIALS" ||
      historyError?.code === "MARKET_DATA_PROVIDER_UNAVAILABLE");
  const chartSummary = useMemo(() => {
    if (prices.length < 2) return "";
    const first = Number(prices[0].close);
    const last = Number(prices.at(-1).close);
    const change = first ? ((last - first) / first) * 100 : 0;
    return `${tickerOf(rawSymbol)} is ${change >= 0 ? "up" : "down"} ${Math.abs(
      change,
    ).toFixed(2)} percent over the selected period.`;
  }, [prices, rawSymbol]);

  const alerts = alertsData?.alerts ?? [];
  const trades = tradesData?.trades ?? [];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2 text-[11.5px] text-fg-subtle">
        <Link
          href="/markets"
          className="inline-flex items-center gap-1 transition-colors hover:text-fg"
        >
          <ArrowLeft className="size-3.5" aria-hidden="true" />
          Markets
        </Link>
        <span aria-hidden="true">/</span>
        <span className="font-mono text-fg-muted">{tickerOf(rawSymbol)}</span>
      </div>

      <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-start">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="flex size-10 items-center justify-center rounded-full bg-surface-2 text-[11px] font-semibold text-fg-muted">
              {tickerOf(rawSymbol).slice(0, 2)}
            </span>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="font-mono text-[22px] font-semibold tracking-[-0.03em] text-fg">
                  {tickerOf(rawSymbol)}
                  {assetType === "CRYPTO" ? (
                    <span className="ml-1 text-[13px] font-normal text-fg-subtle">
                      / USDT
                    </span>
                  ) : null}
                </h1>
                <Badge tone="outline">
                  {assetType === "CRYPTO" ? "Crypto" : "Stock"}
                </Badge>
                <Badge tone={tick ? "up" : "neutral"} dot pulse={Boolean(tick)}>
                  {tick ? "Streaming" : "Polling"}
                </Badge>
              </div>
              <p className="mt-0.5 truncate text-[12px] text-fg-subtle">
                {name} · {quote?.source || CURATED_MARKET_META[rawSymbol]?.exchange || "—"}
              </p>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-end gap-3">
            {quoteLoading && !quote ? (
              <Skeleton className="h-9 w-40" />
            ) : (
              <p className="tnum text-[34px] font-semibold leading-none tracking-[-0.045em] text-fg sm:text-[38px]">
                {price ? formatCurrency(price) : "—"}
              </p>
            )}
            {quote?.changePercent != null ? (
              <div className="flex items-center gap-2 pb-1">
                <span
                  className={cn(
                    "tnum inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-medium",
                    isUp ? "bg-up-soft text-up" : "bg-down-soft text-down",
                  )}
                >
                  <ArrowUpRight
                    className={cn("size-3.5", !isUp && "rotate-90")}
                    aria-hidden="true"
                  />
                  {formatPercent(change)}
                </span>
                <span className="tnum text-[11.5px] text-fg-subtle">
                  {formatPrice(quote.change)} today
                </span>
              </div>
            ) : null}
          </div>
          {quote?.timestamp ? (
            <p className="mt-1.5 text-[10.5px] text-fg-subtle">
              Quote updated {formatRelative(quote.timestamp)}
            </p>
          ) : null}
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <AlertDialog
            defaultSymbol={rawSymbol}
            defaultAssetType={assetType}
            trigger={
              <Button variant="secondary" size="md">
                <Bell className="size-4" aria-hidden="true" />
                Set alert
              </Button>
            }
          />
          <Button asChild variant="primary" size="md">
            <a href="#order-ticket">
              Trade {tickerOf(rawSymbol)}
              <ArrowRight className="size-4" aria-hidden="true" />
            </a>
          </Button>
        </div>
      </div>

      {quoteError ? (
        <ErrorState
          compact
          code={quoteError.code}
          title="Quote unavailable"
          description={quoteError.message}
          action={
            <Button variant="secondary" size="sm" onClick={() => mutateQuote()}>
              <RefreshCw className="size-3.5" aria-hidden="true" />
              Retry
            </Button>
          }
        />
      ) : null}

      <div className="panel grid grid-cols-2 divide-x divide-line border border-line sm:grid-cols-5">
        <Stat label="24h high" value={quote?.high ? formatPrice(quote.high) : "—"} />
        <Stat label="24h low" value={quote?.low ? formatPrice(quote.low) : "—"} />
        <Stat label="Open" value={quote?.open ? formatPrice(quote.open) : "—"} />
        <Stat
          label="Prev close"
          value={quote?.previousClose ? formatPrice(quote.previousClose) : "—"}
        />
        <Stat
          label="Volume"
          value={quote?.volume ? formatQuantity(quote.volume, 0) : "—"}
          hint={quote?.volume ? undefined : "Not provided by source"}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-12">
        <div className="space-y-4 xl:col-span-8">
          <Card>
            <CardHeader className="flex-col gap-3 sm:flex-row sm:items-center">
              <SegmentedControl
                options={intervalOptions}
                value={interval}
                onChange={setInterval}
                size="sm"
                ariaLabel="Chart interval"
                className="overflow-x-auto no-scrollbar"
              />
              <div className="flex items-center gap-2 sm:ml-auto">
                <SegmentedControl
                  options={[
                    { value: "candles", label: "Candles" },
                    { value: "area", label: "Line" },
                  ]}
                  value={mode}
                  onChange={setMode}
                  size="sm"
                  ariaLabel="Chart style"
                />
              </div>
            </CardHeader>
            <CardContent className="px-1.5 pb-2 sm:px-2">
              {historyLoading && !prices.length ? (
                <Skeleton className="h-[380px] w-full rounded-[10px]" />
              ) : historyError ? (
                <ErrorState
                  compact
                  code={stockHistoryUnavailable ? null : historyError.code}
                  title={
                    stockHistoryUnavailable
                      ? "Historical stock data unavailable"
                      : "Chart unavailable"
                  }
                  description={
                    stockHistoryUnavailable
                      ? "Live quotes and trading still work. The current market-data plan does not include historical stock candles."
                      : historyError.message
                  }
                  action={
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => mutateHistory()}
                    >
                      Retry
                    </Button>
                  }
                />
              ) : prices.length ? (
                <>
                  <CandleChart
                    prices={prices}
                    interval={interval}
                    mode={mode}
                    height={380}
                  />
                  <p className="sr-only">{chartSummary}</p>
                </>
              ) : (
                <EmptyState
                  compact
                  icon={ChartCandlestick}
                  title="No candles in this window"
                  description="Try a longer interval or refresh the chart."
                  action={
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => mutateHistory()}
                    >
                      Refresh
                    </Button>
                  }
                />
              )}
            </CardContent>
          </Card>

          <div className="grid gap-4 md:grid-cols-2">
            <SentimentCard symbol={rawSymbol} />

            <Card>
              <CardHeader>
                <CardHeading>
                  <CardTitle>Alerts on {tickerOf(rawSymbol)}</CardTitle>
                  <p className="text-[11.5px] text-fg-subtle">
                    Active price triggers
                  </p>
                </CardHeading>
                <CardAction>
                  <Link
                    href="/alerts"
                    className="text-[11px] font-medium text-brand hover:text-brand-strong"
                  >
                    All alerts
                  </Link>
                </CardAction>
              </CardHeader>
              <CardContent>
                {alertsLoading && !alerts.length ? (
                  <Skeleton className="h-20" />
                ) : alerts.length ? (
                  <ul className="space-y-1.5">
                    {alerts.map((alert) => (
                      <li
                        key={alert.id}
                        className="flex items-center justify-between gap-2 rounded-[7px] border border-line bg-surface-2/40 px-2.5 py-2"
                      >
                        <span className="text-[11px] text-fg-muted">
                          {alert.condition.replaceAll("_", " ").toLowerCase()}
                        </span>
                        <span className="tnum text-[11.5px] text-fg">
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
                    title="No alerts here"
                    description="Set a target price and let Stox watch the market."
                    action={
                      <AlertDialog
                        defaultSymbol={rawSymbol}
                        defaultAssetType={assetType}
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

          <Card>
            <CardHeader>
              <CardHeading>
                <CardTitle>Your recent trades</CardTitle>
                <p className="text-[11.5px] text-fg-subtle">
                  {portfolio?.name || "Active portfolio"} · {tickerOf(rawSymbol)}
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
              caption={`Recent trades in ${rawSymbol}`}
              loading={tradesLoading && !trades.length}
              rows={trades}
              empty={
                <EmptyState
                  compact
                  icon={CircleDollarSign}
                  title="No trades in this symbol"
                  description="Your fills for this market will appear here."
                />
              }
              columns={[
                {
                  key: "side",
                  header: "Side",
                  render: (row) => (
                    <Badge tone={row.side === "BUY" ? "up" : "down"}>
                      {row.side}
                    </Badge>
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
                    row.realizedPnl ? (
                      <span className={pnlTone(row.realizedPnl)}>
                        {formatCurrency(row.realizedPnl, { signed: true })}
                      </span>
                    ) : (
                      "—"
                    ),
                },
                {
                  key: "executedAt",
                  header: "Time",
                  align: "right",
                  render: (row) => (
                    <span className="text-[10.5px] text-fg-subtle">
                      {formatRelative(row.executedAt)}
                    </span>
                  ),
                },
              ]}
            />
          </Card>
        </div>

        <div className="space-y-4 xl:col-span-4">
          <div id="order-ticket" className="scroll-mt-24">
            <OrderTicket
              portfolioId={portfolioId}
              portfolio={portfolio}
              defaultSymbol={rawSymbol}
              defaultAssetType={assetType}
              availableQuantity={holding ? Number(holding.quantity) : undefined}
            />
          </div>

          <Card>
            <CardHeader>
              <CardHeading>
                <CardTitle>Your position</CardTitle>
                <p className="text-[11.5px] text-fg-subtle">
                  {portfolio?.name || "No active portfolio"}
                </p>
              </CardHeading>
              <CardAction>
                <Link
                  href="/portfolios"
                  className="text-[11px] font-medium text-brand hover:text-brand-strong"
                >
                  Portfolio
                </Link>
              </CardAction>
            </CardHeader>
            <CardContent>
              {holding ? (
                <div className="space-y-3">
                  <div className="flex items-end justify-between">
                    <div>
                      <p className="tnum text-[22px] font-semibold tracking-[-0.03em] text-fg">
                        {formatCurrency(holdingValue)}
                      </p>
                      <p className="tnum text-[10.5px] text-fg-subtle">
                        {formatQuantity(holding.quantity)} units @{" "}
                        {formatPrice(holding.averageBuyPrice)} avg
                      </p>
                    </div>
                    <div className="text-right">
                      <p className={cn("tnum text-[12.5px]", pnlTone(holdingPnl))}>
                        {formatCurrency(holdingPnl, { signed: true })}
                      </p>
                      <p className={cn("tnum text-[10.5px]", pnlTone(holdingPnl))}>
                        {formatPercent(holdingPnlPct)}
                      </p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-[7px] border border-line bg-surface-2/50 px-2.5 py-2">
                      <p className="text-[9px] uppercase tracking-[0.07em] text-fg-subtle">
                        Invested
                      </p>
                      <p className="tnum text-[11.5px] text-fg">
                        {formatCurrency(holding.totalInvested)}
                      </p>
                    </div>
                    <div className="rounded-[7px] border border-line bg-surface-2/50 px-2.5 py-2">
                      <p className="text-[9px] uppercase tracking-[0.07em] text-fg-subtle">
                        Allocation
                      </p>
                      <p className="tnum text-[11.5px] text-fg">
                        {portfolio?.cashBalance
                          ? formatPercent(
                              (holdingValue /
                                (Number(portfolio.cashBalance) + holdingValue)) *
                                100,
                              { signed: false },
                            )
                          : "—"}
                      </p>
                    </div>
                  </div>
                </div>
              ) : (
                <EmptyState
                  compact
                  icon={CircleDollarSign}
                  title="No open position"
                  description="Place a buy order to start a position in this market."
                />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardHeading>
                <CardTitle>Market details</CardTitle>
              </CardHeading>
            </CardHeader>
            <CardContent className="space-y-2 text-[11.5px]">
              {[
                ["Symbol", rawSymbol],
                ["Asset class", assetType === "CRYPTO" ? "Crypto" : "Stock"],
                ["Exchange", CURATED_MARKET_META[rawSymbol]?.exchange || "—"],
                ["Currency", quote?.currency || "USD"],
                ["Source", quote?.source || "—"],
              ].map(([label, value]) => (
                <div key={label} className="flex items-center justify-between gap-3">
                  <span className="text-fg-subtle">{label}</span>
                  <span className="truncate font-mono text-[11px] text-fg-muted">
                    {value}
                  </span>
                </div>
              ))}
              <div className="flex items-center justify-between gap-3 border-t border-line pt-2">
                <span className="text-fg-subtle">Stream</span>
                <span className="flex items-center gap-1.5 text-[10.5px] text-fg-muted">
                  <Radio
                    className={cn("size-3", tick ? "text-up" : "text-fg-subtle")}
                    aria-hidden="true"
                  />
                  {tick ? "Connected" : "Polling"}
                </span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function DetailFallback() {
  return (
    <div className="space-y-5">
      <Skeleton className="h-4 w-32" />
      <Skeleton className="h-20 w-64" />
      <Skeleton className="h-16 w-full" />
      <div className="grid gap-4 xl:grid-cols-12">
        <Skeleton className="h-[520px] xl:col-span-8" />
        <Skeleton className="h-[520px] xl:col-span-4" />
      </div>
    </div>
  );
}

export default function MarketDetailPage() {
  return (
    <Suspense fallback={<DetailFallback />}>
      <MarketDetail />
    </Suspense>
  );
}
