"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Ban,
  ChevronRight,
  Clock3,
  Filter,
  ListOrdered,
  Plus,
  RotateCcw,
  Search,
} from "lucide-react";
import { toast } from "sonner";
import { mutate as globalMutate } from "swr";

import { OrderTicket } from "@/components/market/order-ticket";
import { Alert } from "@/components/ui/alert";
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
import { SegmentedControl } from "@/components/ui/segmented";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useActivePortfolio,
  useApi,
  useDebouncedValue,
  usePortfolios,
} from "@/lib/hooks";
import { ordersApi } from "@/lib/endpoints";
import {
  ORDER_EVENT_TYPES,
  ORDER_STATUS,
  ORDER_TYPES,
} from "@/lib/constants";
import {
  formatCurrency,
  formatDateTime,
  formatPrice,
  formatQuantity,
  formatRelative,
  isCrypto,
} from "@/lib/format";
import { cn, humanizeEnum } from "@/lib/utils";

const statusTabs = [
  { value: "ALL", label: "All" },
  { value: "PENDING", label: "Pending" },
  { value: "EXECUTED", label: "Executed" },
  { value: "CANCELLED", label: "Cancelled" },
  { value: "REJECTED", label: "Rejected" },
];

function OrderEvents({ orderId }) {
  const { data, loading, error } = useApi(
    orderId ? `/orders/${orderId}/events` : null,
    { enabled: Boolean(orderId) },
  );
  const events = data?.events ?? [];

  if (loading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-12" />
        <Skeleton className="h-12" />
        <Skeleton className="h-12" />
      </div>
    );
  }

  if (error) {
    return (
      <Alert tone="danger" title="Could not load events">
        {error.message}
      </Alert>
    );
  }

  if (!events.length) {
    return (
      <p className="text-[12px] text-fg-subtle">No lifecycle events recorded.</p>
    );
  }

  return (
    <ol className="relative space-y-0 pl-5">
      <span
        className="absolute bottom-2 left-[5px] top-2 w-px bg-line"
        aria-hidden="true"
      />
      {events.map((event) => {
        const config = ORDER_EVENT_TYPES[event.eventType] || ORDER_EVENT_TYPES.CREATED;
        const tone =
          config.tone === "up"
            ? "bg-up"
            : config.tone === "down"
              ? "bg-down"
              : config.tone === "info"
                ? "bg-info"
                : "bg-fg-subtle";
        const metadata = event.metadata && typeof event.metadata === "object"
          ? Object.entries(event.metadata).filter(
              ([key]) =>
                !["symbol", "assetType", "side", "type", "source"].includes(key) &&
                event.metadata[key] !== null &&
                event.metadata[key] !== undefined,
            )
          : [];

        return (
          <li key={event.id} className="relative pb-4 last:pb-0">
            <span
              className={cn(
                "absolute -left-5 top-1.5 size-[9px] rounded-full ring-4 ring-surface",
                tone,
              )}
              aria-hidden="true"
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="text-[12px] font-medium text-fg">
                  {config.label}
                </span>
                <span className="text-[10px] text-fg-subtle">
                  {event.previousStatus
                    ? `${humanizeEnum(event.previousStatus)} → ${humanizeEnum(event.newStatus)}`
                    : humanizeEnum(event.newStatus)}
                </span>
              </div>
              <span className="text-[10px] text-fg-subtle">
                {formatDateTime(event.createdAt)}
              </span>
            </div>
            {metadata.length ? (
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                {metadata.slice(0, 5).map(([key, value]) => (
                  <span key={key} className="text-[9.5px] text-fg-subtle">
                    {key}:{" "}
                    <span className="font-mono text-fg-muted">
                      {typeof value === "object"
                        ? JSON.stringify(value)
                        : String(value)}
                    </span>
                  </span>
                ))}
              </div>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

function OrderDetailDialog({ order, open, onOpenChange, onCancelled }) {
  const [confirming, setConfirming] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  if (!order) return null;
  const status = ORDER_STATUS[order.status] || ORDER_STATUS.PENDING;
  const price =
    order.executedPrice || order.limitPrice || order.stopPrice || null;
  const value = Number(order.quantity) * Number(price || 0);

  const cancel = async () => {
    try {
      setCancelling(true);
      await ordersApi.cancel(order.id);
      toast.success("Order cancelled", {
        description: `${order.side} ${order.quantity} ${order.symbol}`,
      });
      await globalMutate(
        (key) =>
          typeof key === "string" &&
          (key.startsWith("/orders") || key.startsWith("/portfolios")),
      );
      onCancelled?.();
      onOpenChange(false);
    } catch (error) {
      toast.error("Could not cancel order", { description: error?.message });
    } finally {
      setCancelling(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setConfirming(false);
        onOpenChange(next);
      }}
    >
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            <Badge tone={order.side === "BUY" ? "up" : "down"}>
              {order.side}
            </Badge>
            <span className="font-mono">{order.symbol}</span>
            <Badge tone={status.tone} dot>
              {status.label}
            </Badge>
            {order.source === "COPY_TRADE" ? (
              <Badge tone="info">Copy</Badge>
            ) : null}
          </DialogTitle>
          <DialogDescription>
            {order.type.replace("_", " ")} order · placed{" "}
            {formatDateTime(order.createdAt)}
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-5">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              ["Quantity", formatQuantity(order.quantity)],
              ["Order price", price ? formatPrice(price) : "Market"],
              ["Est. value", value ? formatCurrency(value) : "—"],
              ["Reserved cash", formatCurrency(order.reservedCash)],
              ["Asset class", humanizeEnum(order.assetType)],
              ["Source", humanizeEnum(order.source)],
              ["Expires", order.expiresAt ? formatDateTime(order.expiresAt) : "Never"],
              [
                "Executed",
                order.executedAt ? formatDateTime(order.executedAt) : "—",
              ],
            ].map(([label, value]) => (
              <div
                key={label}
                className="rounded-[8px] border border-line bg-surface-2/50 px-2.5 py-2"
              >
                <p className="text-[9px] uppercase tracking-[0.07em] text-fg-subtle">
                  {label}
                </p>
                <p className="tnum mt-0.5 truncate text-[11.5px] text-fg">
                  {value}
                </p>
              </div>
            ))}
          </div>

          <div>
            <h3 className="mb-3 text-[12px] font-semibold text-fg">
              Lifecycle
            </h3>
            <OrderEvents orderId={order.id} />
          </div>

          {confirming ? (
            <Alert
              tone="warning"
              title="Cancel this order?"
              action={
                <div className="flex gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setConfirming(false)}
                  >
                    Keep
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    loading={cancelling}
                    onClick={cancel}
                  >
                    Cancel order
                  </Button>
                </div>
              }
            >
              Reserved cash will be released if the order is still pending.
            </Alert>
          ) : null}
        </DialogBody>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          {order.status === "PENDING" && !confirming ? (
            <Button
              variant="danger-ghost"
              onClick={() => setConfirming(true)}
            >
              <Ban className="size-3.5" aria-hidden="true" />
              Cancel order
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function OrdersContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { portfolioId: activePortfolioId, portfolio } = useActivePortfolio();
  const { portfolios } = usePortfolios();
  const requestedPortfolioId =
    searchParams.get("portfolioId") || activePortfolioId;
  const requestedPortfolio =
    portfolios.find((item) => item.id === requestedPortfolioId) || portfolio;
  const [newOpen, setNewOpen] = useState(searchParams.get("new") === "1");
  const [selectedId, setSelectedId] = useState(searchParams.get("focus"));
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("ALL");
  const [symbolInput, setSymbolInput] = useState("");
  const [side, setSide] = useState("ALL");
  const [type, setType] = useState("ALL");
  const [portfolioFilter, setPortfolioFilter] = useState("ALL");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const symbol = useDebouncedValue(symbolInput, 350);

  // Sync URL intent (?new=1 / ?focus=id) into local dialog state. This is an
  // external-system subscription, not a render-time derivation.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (searchParams.get("new") === "1") setNewOpen(true);
    if (searchParams.get("focus")) setSelectedId(searchParams.get("focus"));
  }, [searchParams]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const queryPortfolio =
    portfolioFilter === "ALL"
      ? undefined
      : portfolioFilter === "ACTIVE"
        ? activePortfolioId
        : portfolioFilter;

  const {
    data,
    loading,
    error,
    mutate,
  } = useApi("/orders", {
    query: {
      page,
      limit: 20,
      status: status === "ALL" ? undefined : status,
      symbol: symbol || undefined,
      side: side === "ALL" ? undefined : side,
      type: type === "ALL" ? undefined : type,
      portfolioId: queryPortfolio,
      from: from || undefined,
      to: to || undefined,
    },
    refreshInterval: 120000,
  });

  const orders = useMemo(() => data?.orders ?? [], [data]);
  const pagination = data?.pagination;
  const selected = useMemo(
    () => orders.find((order) => order.id === selectedId) || null,
    [orders, selectedId],
  );
  const { data: selectedOrderData } = useApi(
    selectedId && !selected ? `/orders/${selectedId}` : null,
    { enabled: Boolean(selectedId) && !selected },
  );
  const selectedOrder = selected || selectedOrderData?.order || null;

  useEffect(() => {
    // A filter change starts a new result set. Keeping this in one effect
    // avoids repeating setPage(1) in seven handlers.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPage(1);
  }, [status, symbol, side, type, portfolioFilter, from, to]);

  const reset = () => {
    setStatus("ALL");
    setSymbolInput("");
    setSide("ALL");
    setType("ALL");
    setPortfolioFilter("ALL");
    setFrom("");
    setTo("");
  };

  const hasFilters =
    status !== "ALL" ||
    symbol ||
    side !== "ALL" ||
    type !== "ALL" ||
    portfolioFilter !== "ALL" ||
    from ||
    to;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Execution"
        title="Orders"
        description="Every market, limit, stop-loss and take-profit order with its full lifecycle audit trail."
        actions={
          <Button
            variant="primary"
            size="md"
            onClick={() => setNewOpen(true)}
          >
            <Plus className="size-4" aria-hidden="true" />
            New order
          </Button>
        }
      />

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <SegmentedControl
            options={statusTabs}
            value={status}
            onChange={(value) => setStatus(value)}
            ariaLabel="Order status"
          />
          <div className="ml-auto flex items-center gap-2">
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
        </div>

        {showFilters ? (
          <Card className="p-3">
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
              <Field label="Portfolio" htmlFor="filter-portfolio">
                {({ id }) => (
                  <Select
                    value={portfolioFilter}
                    onValueChange={setPortfolioFilter}
                  >
                    <SelectTrigger id={id} className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ALL">All portfolios</SelectItem>
                      <SelectItem value="ACTIVE">
                        {portfolio?.name || "Active portfolio"}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                )}
              </Field>
              <Field label="Side" htmlFor="filter-side">
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
              <Field label="Type" htmlFor="filter-type">
                {({ id }) => (
                  <Select value={type} onValueChange={setType}>
                    <SelectTrigger id={id} className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ALL">Any type</SelectItem>
                      {ORDER_TYPES.map((orderType) => (
                        <SelectItem key={orderType.value} value={orderType.value}>
                          {orderType.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </Field>
              <Field label="From" htmlFor="filter-from">
                {({ id }) => (
                  <Input
                    id={id}
                    type="date"
                    value={from}
                    onChange={(event) => setFrom(event.target.value)}
                    inputSize="sm"
                  />
                )}
              </Field>
              <Field label="To" htmlFor="filter-to">
                {({ id }) => (
                  <Input
                    id={id}
                    type="date"
                    value={to}
                    onChange={(event) => setTo(event.target.value)}
                    inputSize="sm"
                  />
                )}
              </Field>
            </div>
          </Card>
        ) : null}
      </div>

      <Card>
        <CardHeader>
          <CardHeading>
            <CardTitle>Order book</CardTitle>
            <p className="text-[11.5px] text-fg-subtle">
              {pagination?.total
                ? `${pagination.total.toLocaleString()} orders`
                : "Newest first"}
            </p>
          </CardHeading>
          <div className="flex items-center gap-2 text-[10.5px] text-fg-subtle">
            <Clock3 className="size-3" aria-hidden="true" />
            Updates every 30s
          </div>
        </CardHeader>
        <DataTable
          caption="Orders"
          loading={loading && !orders.length}
          rows={orders}
          onRowClick={(row) => setSelectedId(row.id)}
          empty={
            error ? (
              <ErrorState
                compact
                code={error.code}
                title="Could not load orders"
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
                icon={ListOrdered}
                title={hasFilters ? "No orders match" : "No orders yet"}
                description={
                  hasFilters
                    ? "Adjust the filters or reset them to see more."
                    : "Place your first order to start building the audit trail."
                }
                action={
                  hasFilters ? (
                    <Button variant="secondary" size="sm" onClick={reset}>
                      Reset filters
                    </Button>
                  ) : (
                    <Button variant="primary" size="sm" onClick={() => setNewOpen(true)}>
                      Place an order
                    </Button>
                  )
                }
              />
            )
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
                  <div>
                    <p className="font-mono text-[11.5px] font-medium text-fg">
                      {row.symbol}
                    </p>
                    <p className="text-[9.5px] text-fg-subtle">
                      {row.type.replace("_", " ")}
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
              key: "value",
              header: "Value",
              align: "right",
              render: (row) => {
                const price = row.executedPrice || row.limitPrice || row.stopPrice;
                return price
                  ? formatCurrency(Number(row.quantity) * Number(price))
                  : "—";
              },
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
              key: "expiresAt",
              header: "Expiry",
              render: (row) =>
                row.expiresAt ? (
                  <span className="text-[10.5px] text-fg-subtle">
                    {formatRelative(row.expiresAt)}
                  </span>
                ) : (
                  <span className="text-[10.5px] text-fg-subtle">Never</span>
                ),
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

      <Dialog
        open={newOpen}
        onOpenChange={(next) => {
          setNewOpen(next);
          if (!next && searchParams.get("new") === "1") {
            router.replace("/orders", { scroll: false });
          }
        }}
      >
        <DialogContent size="lg">
          <DialogHeader>
            <DialogTitle>Place an order</DialogTitle>
            <DialogDescription>
              {portfolio?.name || "Active portfolio"} · market, limit, stop-loss
              and take-profit orders.
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            <OrderTicket
              portfolioId={requestedPortfolioId}
              portfolio={requestedPortfolio}
              defaultSymbol={searchParams.get("symbol") || "BTCUSDT"}
              defaultAssetType={
                searchParams.get("asset") ||
                (isCrypto(searchParams.get("symbol") || "BTCUSDT")
                  ? "CRYPTO"
                  : "STOCK")
              }
              showHeader={false}
              className="border-0 bg-transparent p-0 shadow-none"
              onSuccess={() => {
                setNewOpen(false);
                mutate();
              }}
            />
          </DialogBody>
        </DialogContent>
      </Dialog>

      <OrderDetailDialog
        order={selectedOrder}
        open={Boolean(selectedId && selectedOrder)}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedId(null);
            if (searchParams.get("focus")) {
              router.replace("/orders", { scroll: false });
            }
          }
        }}
        onCancelled={mutate}
      />
    </div>
  );
}

export default function OrdersPage() {
  return (
    <Suspense
      fallback={
        <div className="space-y-4">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-[460px]" />
        </div>
      }
    >
      <OrdersContent />
    </Suspense>
  );
}
