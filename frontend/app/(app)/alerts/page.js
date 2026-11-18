"use client";

import { useState } from "react";
import {
  Bell,
  BellRing,
  Mail,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Smartphone,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { mutate as globalMutate } from "swr";

import { AlertDialog } from "@/components/alerts/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown";
import { EmptyState, ErrorState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { SegmentedControl } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { Stat } from "@/components/ui/stat";
import { useApi } from "@/lib/hooks";
import { alertsApi } from "@/lib/endpoints";
import { ALERT_CONDITIONS, ALERT_STATUS } from "@/lib/constants";
import {
  formatDateTime,
  formatPrice,
  formatRelative,
  tickerOf,
} from "@/lib/format";

const filters = [
  { value: "ALL", label: "All" },
  { value: "ACTIVE", label: "Active" },
  { value: "TRIGGERED", label: "Triggered" },
  { value: "EXPIRED", label: "Expired" },
  { value: "CANCELLED", label: "Cancelled" },
];

function DeleteAlertDialog({ alert, trigger, onDeleted }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const remove = async () => {
    try {
      setLoading(true);
      await alertsApi.remove(alert.id);
      toast.success("Alert deleted", { description: alert.symbol });
      await globalMutate(
        (key) => typeof key === "string" && key.startsWith("/alerts"),
      );
      setOpen(false);
      onDeleted?.();
    } catch (error) {
      toast.error("Could not delete alert", {
        description: error?.message,
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <AlertDialog
            alert={alert}
            trigger={
              <DropdownMenuItem onSelect={(event) => event.preventDefault()}>
                <Pencil className="size-3.5" aria-hidden="true" />
                Edit alert
              </DropdownMenuItem>
            }
          />
          <DropdownMenuSeparator />
          <DropdownMenuItem
            danger
            onSelect={(event) => {
              event.preventDefault();
              setOpen(true);
            }}
          >
            <Trash2 className="size-3.5" aria-hidden="true" />
            Delete alert
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Delete alert for {alert.symbol}?</DialogTitle>
          <DialogDescription>
            This removes the alert permanently. Triggered history is not kept.
          </DialogDescription>
        </DialogHeader>
        <DialogBody />
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Keep alert
          </Button>
          <Button variant="danger" loading={loading} onClick={remove}>
            Delete alert
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function AlertsPage() {
  const [status, setStatus] = useState("ALL");
  const [page, setPage] = useState(1);

  const { data, loading, error, mutate } = useApi("/alerts", {
    query: {
      page,
      limit: 12,
      status: status === "ALL" ? undefined : status,
    },
    refreshInterval: 120000,
  });
  const { data: activeData } = useApi("/alerts", {
    query: { status: "ACTIVE", limit: 1 },
    refreshInterval: 180000,
  });
  const { data: triggeredData } = useApi("/alerts", {
    query: { status: "TRIGGERED", limit: 1 },
    refreshInterval: 180000,
  });

  const alerts = data?.alerts ?? [];
  const pagination = data?.pagination;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Automation"
        title="Price alerts"
        description="Watch a level without watching the chart. Alerts trigger on live quotes and can notify you by email or push."
        actions={
          <AlertDialog
            trigger={
              <Button variant="primary" size="md">
                <Plus className="size-4" aria-hidden="true" />
                New alert
              </Button>
            }
          />
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat
          label="Active alerts"
          value={(activeData?.pagination?.total ?? 0).toLocaleString()}
          deltaLabel="watching live quotes"
          icon={BellRing}
        />
        <Stat
          label="Triggered"
          value={(triggeredData?.pagination?.total ?? 0).toLocaleString()}
          deltaLabel="all time"
          tone="flat"
          icon={Bell}
        />
        <Stat
          label="Channels"
          value="Email · Push"
          deltaLabel="per alert"
          tone="flat"
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl
          options={filters}
          value={status}
          onChange={(value) => {
            setStatus(value);
            setPage(1);
          }}
          ariaLabel="Alert status"
        />
        <Button variant="ghost" size="sm" onClick={() => mutate()}>
          <RefreshCw className="size-3.5" aria-hidden="true" />
          Refresh
        </Button>
      </div>

      {error ? (
        <ErrorState
          code={error.code}
          title="Could not load alerts"
          description={error.message}
          action={
            <Button variant="secondary" size="sm" onClick={() => mutate()}>
              Retry
            </Button>
          }
        />
      ) : loading && !alerts.length ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((key) => (
            <Skeleton key={key} className="h-[190px] rounded-[12px]" />
          ))}
        </div>
      ) : alerts.length === 0 ? (
        <EmptyState
          icon={Bell}
          title={status === "ALL" ? "No alerts yet" : `No ${status.toLowerCase()} alerts`}
          description="Create a price or percentage alert and let the engine watch the market for you."
          action={
            <AlertDialog
              trigger={
                <Button variant="primary" size="md">
                  <Plus className="size-4" aria-hidden="true" />
                  Create alert
                </Button>
              }
            />
          }
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {alerts.map((alert) => {
            const statusConfig = ALERT_STATUS[alert.status] || ALERT_STATUS.ACTIVE;
            const condition =
              ALERT_CONDITIONS.find((item) => item.value === alert.condition) ||
              ALERT_CONDITIONS[0];
            const isPercent = alert.condition.startsWith("PERCENT");

            return (
              <Card key={alert.id} className="overflow-hidden">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      <span className="flex size-8 items-center justify-center rounded-full bg-surface-2 text-[9px] font-semibold text-fg-muted">
                        {tickerOf(alert.symbol || "??").slice(0, 2)}
                      </span>
                      <div>
                        <p className="font-mono text-[13px] font-semibold text-fg">
                          {alert.symbol}
                        </p>
                        <p className="text-[10px] text-fg-subtle">
                          {alert.assetType || "STOCK"}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <Badge tone={statusConfig.tone} dot>
                        {statusConfig.label}
                      </Badge>
                      <DeleteAlertDialog
                        alert={alert}
                        onDeleted={mutate}
                        trigger={
                          <IconButton label="Alert actions" size="icon-xs">
                            <MoreHorizontal className="size-4" />
                          </IconButton>
                        }
                      />
                    </div>
                  </div>

                  <div className="mt-4 flex items-baseline justify-between gap-3">
                    <div>
                      <p className="text-[10px] uppercase tracking-[0.08em] text-fg-subtle">
                        {condition.label}
                      </p>
                      <p className="tnum mt-0.5 text-[22px] font-semibold tracking-[-0.03em] text-fg">
                        {isPercent
                          ? `${formatPrice(alert.targetPrice)}%`
                          : formatPrice(alert.targetPrice)}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] uppercase tracking-[0.08em] text-fg-subtle">
                        Baseline
                      </p>
                      <p className="tnum mt-0.5 text-[11.5px] text-fg-muted">
                        {alert.baselinePrice
                          ? formatPrice(alert.baselinePrice)
                          : "—"}
                      </p>
                    </div>
                  </div>

                  {alert.baselineAt ? (
                    <p className="mt-1 text-[9.5px] text-fg-subtle">
                      Baseline captured {formatDateTime(alert.baselineAt)}
                    </p>
                  ) : null}

                  <div className="mt-4 flex items-center justify-between border-t border-line pt-3">
                    <div className="flex items-center gap-3 text-[10px] text-fg-subtle">
                      <span className="inline-flex items-center gap-1">
                        <Mail
                          className={alert.sendEmail ? "text-brand" : "text-fg-subtle/50"}
                          aria-hidden="true"
                        />
                        Email
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Smartphone
                          className={alert.sendPush ? "text-brand" : "text-fg-subtle/50"}
                          aria-hidden="true"
                        />
                        Push
                      </span>
                    </div>
                    <button
                      type="button"
                      className="text-[10px] text-fg-subtle"
                      title={formatDateTime(alert.createdAt)}
                    >
                      {formatRelative(alert.createdAt)}
                    </button>
                  </div>

                  {alert.status === "TRIGGERED" && alert.triggeredAt ? (
                    <p className="mt-2 rounded-[6px] bg-warn-soft px-2 py-1 text-[10px] text-warn">
                      Triggered {formatRelative(alert.triggeredAt)}
                    </p>
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {alerts.length ? (
        <Pagination
          page={pagination?.page || page}
          totalPages={pagination?.totalPages || 1}
          total={pagination?.total}
          limit={pagination?.limit || 12}
          onPageChange={setPage}
        />
      ) : null}
    </div>
  );
}
