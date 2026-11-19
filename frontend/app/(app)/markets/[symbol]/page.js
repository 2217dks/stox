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
import {
  useApi,
  useActivePortfolio,
  useMarketStream,
  usePosition,
  useQuote,
} from "@/lib/hooks";
import { marketApi } from "@/lib/endpoints";
import {
  CHART_TIMEFRAMES,
  chartRequestWindow,
  CURATED_MARKET_META,
} from "@/lib/constants";
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

const timeframeOptions = CHART_TIMEFRAMES.map((timeframe) => ({
  value: timeframe.value,
  label: timeframe.label,
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

  const [timeframe, setTimeframe] = useState(
    assetType === "CRYPTO" ? "1W" : "3M",
  );
  const [mode, setMode] = useState("candles");
  const timeframeConfig =
    CHART_TIMEFRAMES.find((item) => item.value === timeframe) ??
    CHART_TIMEFRAMES[0];

  const { portfolio, portfolioId } = useActivePortfolio();
  const { quote, loading: quoteLoading, error: quoteError, mutate: mutateQuote } =
    useQuote(rawSymbol, assetType, { refreshInterval: 60000 });
  const tick = useMarketStream(rawSymbol, assetType);
  const { data: searchData } = useApi("/market/search", {
    query: { query: rawSymbol, assetClass: assetType, limit: 1 },
    enabled: rawSymbol.length >= 2,
  });
  const position = usePosition(portfolioId, rawSymbol, assetType);
  const { data: alertsData, loading: alertsLoading } = useApi("/alerts", {
    query: { symbol: rawSymbol, status: "ACTIVE", limit: 5 },
    refreshInterval: 180000,
  });
  const { data: tradesData, loading: tradesLoading } = useApi("/trades", {
    query: { symbol: rawSymbol, portfolioId, limit: 6 },
    refreshInterval: 120000,
  });

  const {
    data: history,
    isLoading: historyLoading,
    error: historyError,
    mutate: mutateHistory,
  } = useSWR(
    `history:${assetType}:${rawSymbol}:${timeframeConfig.value}`,
    () => {
      const window = chartRequestWindow(timeframeConfig.value);
      return marketApi.history(rawSymbol, {
        interval: timeframeConfig.interval,
        from: window.from,
        to: window.to,
        limit: window.limit,
        assetClass: assetType,
      });
    },
    {
      refreshInterval: 180000,
      shouldRetryOnError: false,
      keepPreviousData: true,
    },
  );

  const price = tick?.price || quote?.price;
  const livePositionPrice = Number(price || 0);
  const holdingValue =
    position.hasPosition && livePositionPrice > 0
      ? position.quantity * livePositionPrice
      : 0;
  const holdingPnl = holdingValue > 0 ? holdingValue - position.totalInvested : 0;
  const holdingPnlPct =
    position.totalInvested > 0 && holdingValue > 0
      ? (holdingPnl / position.totalInvested) * 100
      : 0;

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
    ).toFixed(2)} percent over the selected ${timeframeConfig.label}.`;
  }, [prices, rawSymbol, timeframeConfig.label]);

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
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
            {position.loading ? (
              <span className="text-fg-subtle">Checking position…</span>
            ) : position.error ? (
              <span className="text-fg-subtle">Position unavailable</span>
            ) : position.hasPosition ? (
              <>
                <span className="rounded-full border border-line bg-surface-2/70 px-2 py-0.5 text-fg-muted">
                  You own{" "}
                  <span className="tnum font-medium text-fg">
                    {formatQuantity(position.quantity)}{" "}
                    {assetType === "CRYPTO" ? tickerOf(rawSymbol) : "shares"}
                  </span>
                </span>
                <span className="tnum text-fg-subtle">
                  {formatPrice(position.averageBuyPrice)} avg
                </span>
                {position.reservedQuantity > 0 ? (
                  <span className="tnum text-fg-subtle">
                    {formatQuantity(position.reservedQuantity)} in pending sells
                  </span>
                ) : null}
              </>
            ) : (
              <span className="rounded-full border border-line bg-surface-2/70 px-2 py-0.5 text-fg-subtle">
                No open position
              </span>
            )}
          </div>
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
          code={quoteError.code === "MARKET_DATA_NOT_FOUND" ? null : quoteError.code}
          title={
            quoteError.code === "MARKET_DATA_NOT_FOUND"
              ? "No live quote for this symbol"
              : "Quote unavailable"
          }
          description={
            quoteError.code === "MARKET_DATA_NOT_FOUND"
              ? "The provider does not publish a quote for this ticker. It may be an international or OTC listing without live coverage."
              : quoteError.message
          }
          action={
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => mutateQuote()}
              >
                <RefreshCw className="size-3.5" aria-hidden="true" />
                Retry
              </Button>
              <Button asChild variant="ghost" size="sm">
                <Link href="/markets">Back to markets</Link>
              </Button>
            </div>
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
            <CardHeader className="flex-col gap-2 sm:flex-row sm:items-center">
              <div className="flex w-full flex-wrap items-center gap-2">
                <span className="text-[10.5px] text-fg-subtle">Range</span>
                <SegmentedControl
                  options={timeframeOptions}
                  value={timeframe}
                  onChange={setTimeframe}
                  size="sm"
                  ariaLabel="Chart time range"
                  className="overflow-x-auto no-scrollbar"
                />
                <span className="text-[10px] text-fg-subtle">
                  {timeframeConfig.interval} candles
                </span>
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
                      ? "Live quotes and trading still work. Historical stock candles are temporarily unavailable from the data providers."
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
                    interval={timeframeConfig.interval}
                    mode={mode}
                    height={380}
                    currentPrice={Number(price) || undefined}
                  />
                  <p className="sr-only">{chartSummary}</p>
                </>
              ) : (
                <EmptyState
                  compact
                  icon={ChartCandlestick}
                  title="No candles in this window"
                  description="The provider returned no candles. Try another range, or the pair may be halted."
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
              {position.loading ? (
                <Skeleton className="h-28" />
              ) : position.error ? (
                <ErrorState
                  compact
                  code={position.error.code}
                  title="Position unavailable"
                  description={position.error.message}
                  action={
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => position.mutateHoldings()}
                    >
                      Retry
                    </Button>
                  }
                />
              ) : position.hasPosition ? (
                <div className="space-y-3">
                  <div className="flex items-end justify-between">
                    <div>
                      <p className="tnum text-[22px] font-semibold tracking-[-0.03em] text-fg">
                        {holdingValue > 0 ? formatCurrency(holdingValue) : "—"}
                      </p>
                      <p className="tnum text-[10.5px] text-fg-subtle">
                        {formatQuantity(position.quantity)} {assetType === "CRYPTO" ? tickerOf(rawSymbol) : "shares"} @{" "}
                        {formatPrice(position.averageBuyPrice)} avg
                      </p>
                    </div>
                    <div className="text-right">
                      <p className={cn("tnum text-[12.5px]", pnlTone(holdingPnl))}>
                        {holdingValue > 0
                          ? formatCurrency(holdingPnl, { signed: true })
                          : "—"}
                      </p>
                      <p className={cn("tnum text-[10.5px]", pnlTone(holdingPnl))}>
                        {holdingValue > 0
                          ? formatPercent(holdingPnlPct)
                          : "Live value unavailable"}
                      </p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-[7px] border border-line bg-surface-2/50 px-2.5 py-2">
                      <p className="text-[9px] uppercase tracking-[0.07em] text-fg-subtle">
                        Invested
                      </p>
                      <p className="tnum text-[11.5px] text-fg">
                        {formatCurrency(position.totalInvested)}
                      </p>
                    </div>
                    <div className="rounded-[7px] border border-line bg-surface-2/50 px-2.5 py-2">
                      <p className="text-[9px] uppercase tracking-[0.07em] text-fg-subtle">
                        Free to sell
                      </p>
                      <p className="tnum text-[11.5px] text-fg">
                        {formatQuantity(position.availableQuantity)}{" "}
                        {assetType === "CRYPTO" ? tickerOf(rawSymbol) : "shares"}
                      </p>
                    </div>
                  </div>
                  {position.reservedQuantity > 0 ? (
                    <p className="text-[10.5px] leading-snug text-fg-subtle">
                      {formatQuantity(position.reservedQuantity)}{" "}
                      {assetType === "CRYPTO" ? tickerOf(rawSymbol) : "shares"} are
                      tied up in pending sell orders and excluded from Max.
                    </p>
                  ) : null}
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
