"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeftRight,
  ChevronRight,
  Download,
  Filter,
  RotateCcw,
  Search,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardHeader,
  CardHeading,
  CardTitle,
} from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState, ErrorState } from "@/components/ui/empty-state";
import { Field, Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Stat } from "@/components/ui/stat";
import { useActivePortfolio, useApi, useDebouncedValue } from "@/lib/hooks";
import {
  formatCurrency,
  formatDateTime,
  formatPercent,
  formatPrice,
  formatQuantity,
  formatRelative,
  pnlTone,
} from "@/lib/format";
import { cn, humanizeEnum } from "@/lib/utils";

function TradeDetailDialog({ trade, open, onOpenChange }) {
  if (!trade) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Badge tone={trade.side === "BUY" ? "up" : "down"}>
              {trade.side}
            </Badge>
            <span className="font-mono">{trade.symbol}</span>
          </DialogTitle>
          <DialogDescription>
            Executed {formatDateTime(trade.executedAt)} ·{" "}
            {humanizeEnum(trade.assetType)}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            {[
              ["Quantity", formatQuantity(trade.quantity)],
              ["Price", formatPrice(trade.price)],
              ["Total value", formatCurrency(trade.totalValue)],
              ["Fees", formatCurrency(trade.fees)],
              [
                "Realized P&L",
                trade.realizedPnl != null
                  ? formatCurrency(trade.realizedPnl, { signed: true })
                  : "—",
              ],
              [
                "Realized %",
                trade.realizedPnlPct != null
                  ? formatPercent(Number(trade.realizedPnlPct))
                  : "—",
              ],
            ].map(([label, value]) => (
              <div
                key={label}
                className="rounded-[8px] border border-line bg-surface-2/50 px-3 py-2"
              >
                <p className="text-[9px] uppercase tracking-[0.07em] text-fg-subtle">
                  {label}
                </p>
                <p
                  className={cn(
                    "tnum mt-0.5 text-[12px] font-medium text-fg",
                    label === "Realized P&L" && trade.realizedPnl != null
                      ? pnlTone(trade.realizedPnl)
                      : null,
                  )}
                >
                  {value}
                </p>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between rounded-[8px] border border-line bg-surface-2/40 px-3 py-2">
            <span className="text-[11px] text-fg-subtle">Source order</span>
            <Link
              href={`/orders?focus=${trade.orderId}`}
              className="font-mono text-[10.5px] text-brand hover:text-brand-strong"
            >
              {trade.orderId.slice(0, 8)}…
            </Link>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function TradesPage() {
  const { portfolioId: activePortfolioId, portfolio } = useActivePortfolio();
  const [page, setPage] = useState(1);
  const [symbolInput, setSymbolInput] = useState("");
  const [side, setSide] = useState("ALL");
  const [portfolioFilter, setPortfolioFilter] = useState("ACTIVE");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [sort, setSort] = useState("executedAt");
  const [order, setOrder] = useState("desc");
  const [showFilters, setShowFilters] = useState(false);
  const [selected, setSelected] = useState(null);
  const symbol = useDebouncedValue(symbolInput, 350);

  const queryPortfolio =
    portfolioFilter === "ALL"
      ? undefined
      : portfolioFilter === "ACTIVE"
        ? activePortfolioId
        : portfolioFilter;

  const query = {
    page,
    limit: 20,
    symbol: symbol || undefined,
    side: side === "ALL" ? undefined : side,
    portfolioId: queryPortfolio,
    from: from || undefined,
    to: to || undefined,
    sort,
    order,
  };

  const { data, loading, error, mutate } = useApi("/trades", {
    query,
    refreshInterval: 120000,
  });
  const { data: statsData } = useApi("/users/me/statistics", {
    query: {
      portfolioId: queryPortfolio,
      symbol: symbol || undefined,
      side: side === "ALL" ? undefined : side,
      from: from || undefined,
      to: to || undefined,
    },
    refreshInterval: 180000,
  });

  const trades = useMemo(() => data?.trades ?? [], [data]);
  const pagination = data?.pagination;
  const stats = statsData?.statistics;

  const volume = useMemo(
    () => trades.reduce((sum, trade) => sum + Number(trade.totalValue), 0),
    [trades],
  );

  const onSort = (key) => {
    if (sort === key) setOrder((value) => (value === "asc" ? "desc" : "asc"));
    else {
      setSort(key);
      setOrder("desc");
    }
    setPage(1);
  };

  const reset = () => {
    setSymbolInput("");
    setSide("ALL");
    setPortfolioFilter("ACTIVE");
    setFrom("");
    setTo("");
    setSort("executedAt");
    setOrder("desc");
    setPage(1);
  };

  const hasFilters =
    symbol ||
    side !== "ALL" ||
    portfolioFilter !== "ACTIVE" ||
    from ||
    to;

  const exportCsv = () => {
    if (!trades.length) return;

    const header = [
      "executedAt",
      "symbol",
      "assetType",
      "side",
      "quantity",
      "price",
      "totalValue",
      "fees",
      "realizedPnl",
      "realizedPnlPct",
      "orderId",
    ];
    const rows = trades.map((trade) =>
      header.map((key) => `"${String(trade[key] ?? "")}"`).join(","),
    );
    const blob = new Blob([[header.join(","), ...rows].join("\n")], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `stox-trades-page-${page}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Execution history"
        title="Trades"
        description="Every executed fill across your portfolios, with realized P&L and source orders."
        actions={
          <Button
            variant="secondary"
            size="md"
            onClick={exportCsv}
            disabled={!trades.length}
          >
            <Download className="size-4" aria-hidden="true" />
            Export page
          </Button>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Trades"
          value={(stats?.totalTrades ?? 0).toLocaleString()}
          deltaLabel="matching filters"
          icon={ArrowLeftRight}
        />
        <Stat
          label="Win rate"
          value={stats?.winRate != null ? formatPercent(Number(stats.winRate) * 100, { signed: false }) : "—"}
          deltaLabel={`${stats?.winningTrades ?? 0} wins · ${stats?.losingTrades ?? 0} losses`}
          tone="flat"
        />
        <Stat
          label="Volume"
          value={formatCurrency(stats?.totalVolume ?? 0, { compact: true })}
          deltaLabel="executed notional"
        />
        <Stat
          label="Page volume"
          value={formatCurrency(volume, { compact: true })}
          deltaLabel={`${trades.length} fills on this page`}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-[190px]">
          <Input
            value={symbolInput}
            onChange={(event) => setSymbolInput(event.target.value.toUpperCase())}
            placeholder="Filter symbol"
            inputSize="sm"
            leftIcon={<Search className="size-3.5" />}
            className="font-mono uppercase"
          />
        </div>
        <Button
          variant={showFilters ? "secondary" : "ghost"}
          size="sm"
          onClick={() => setShowFilters((value) => !value)}
          aria-expanded={showFilters}
        >
          <Filter className="size-3.5" aria-hidden="true" />
          Filters
          {hasFilters ? (
            <span className="size-1.5 rounded-full bg-brand" aria-hidden="true" />
          ) : null}
        </Button>
        {hasFilters ? (
          <Button variant="ghost" size="sm" onClick={reset}>
            <RotateCcw className="size-3.5" aria-hidden="true" />
            Reset
          </Button>
        ) : null}
      </div>

      {showFilters ? (
        <Card className="p-3">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Portfolio" htmlFor="trades-portfolio">
              {({ id }) => (
                <Select value={portfolioFilter} onValueChange={setPortfolioFilter}>
                  <SelectTrigger id={id} className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ACTIVE">
                      {portfolio?.name || "Active portfolio"}
                    </SelectItem>
                    <SelectItem value="ALL">All portfolios</SelectItem>
                  </SelectContent>
                </Select>
              )}
            </Field>
            <Field label="Side" htmlFor="trades-side">
              {({ id }) => (
                <Select value={side} onValueChange={setSide}>
                  <SelectTrigger id={id} className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">Any side</SelectItem>
                    <SelectItem value="BUY">Buy</SelectItem>
                    <SelectItem value="SELL">Sell</SelectItem>
                  </SelectContent>
                </Select>
              )}
            </Field>
            <Field label="From" htmlFor="trades-from">
              {({ id }) => (
                <Input
                  id={id}
                  type="date"
                  value={from}
                  onChange={(event) => {
                    setFrom(event.target.value);
                    setPage(1);
                  }}
                  inputSize="sm"
                />
              )}
            </Field>
            <Field label="To" htmlFor="trades-to">
              {({ id }) => (
                <Input
                  id={id}
                  type="date"
                  value={to}
                  onChange={(event) => {
                    setTo(event.target.value);
                    setPage(1);
                  }}
                  inputSize="sm"
                />
              )}
            </Field>
          </div>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardHeading>
            <CardTitle>Executed trades</CardTitle>
            <p className="text-[11.5px] text-fg-subtle">
              {pagination?.total
                ? `${pagination.total.toLocaleString()} fills`
                : "No fills for these filters"}
            </p>
          </CardHeading>
          <span className="text-[10.5px] text-fg-subtle">
            Sorted by {sort === "totalValue" ? "value" : "execution time"}
          </span>
        </CardHeader>
        <DataTable
          caption="Executed trades"
          loading={loading && !trades.length}
          rows={trades}
          onRowClick={(row) => setSelected(row)}
          empty={
            error ? (
              <ErrorState
                compact
                code={error.code}
                title="Could not load trades"
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
                icon={ArrowLeftRight}
                title="No trades yet"
                description="Executed orders appear here with their realized P&L."
              />
            )
          }
          columns={[
            {
              key: "executedAt",
              header: "Time",
              sortKey: "executedAt",
              activeSortKey: sort,
              sortDirection: order,
              onSort,
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
                  <div>
                    <p className="font-mono text-[11.5px] font-medium text-fg">
                      {row.symbol}
                    </p>
                    <p className="text-[9.5px] text-fg-subtle">
                      {humanizeEnum(row.assetType)}
                    </p>
                  </div>
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
              sortKey: "totalValue",
              activeSortKey: sort,
              sortDirection: order,
              onSort,
              render: (row) => formatCurrency(row.totalValue),
            },
            {
              key: "realizedPnl",
              header: "Realized",
              align: "right",
              render: (row) =>
                row.realizedPnl != null ? (
                  <div>
                    <p className={cn("tnum", pnlTone(row.realizedPnl))}>
                      {formatCurrency(row.realizedPnl, { signed: true })}
                    </p>
                    <p className={cn("tnum text-[10px]", pnlTone(row.realizedPnl))}>
                      {row.realizedPnlPct != null
                        ? formatPercent(Number(row.realizedPnlPct))
                        : "—"}
                    </p>
                  </div>
                ) : (
                  <span className="text-fg-subtle">—</span>
                ),
            },
            {
              key: "fees",
              header: "Fees",
              align: "right",
              render: (row) => formatCurrency(row.fees),
            },
            {
              key: "arrow",
              header: "",
              align: "right",
              render: () => (
                <ChevronRight className="ml-auto size-3.5 text-fg-subtle" aria-hidden="true" />
              ),
            },
          ]}
          footer={
            <Pagination
              page={pagination?.page || page}
              totalPages={pagination?.totalPages || 1}
              total={pagination?.total}
              limit={pagination?.limit || 20}
              onPageChange={setPage}
            />
          }
        />
      </Card>

      <TradeDetailDialog
        trade={selected}
        open={Boolean(selected)}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      />
    </div>
  );
}
