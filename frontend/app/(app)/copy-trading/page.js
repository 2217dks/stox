"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  CircleDollarSign,
  Copy,
  Pause,
  Pencil,
  Play,
  Plus,
  StopCircle,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";
import { mutate as globalMutate } from "swr";

import { CopyTradeDialog } from "@/components/copy-trading/copy-trade-dialog";
import { EditCopyTradeDialog } from "@/components/copy-trading/edit-copy-trade-dialog";
import { TraderPickerDialog } from "@/components/copy-trading/trader-picker";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { EmptyState, ErrorState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { SegmentedControl } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { Stat } from "@/components/ui/stat";
import { useApi } from "@/lib/hooks";
import { copyTradingApi } from "@/lib/endpoints";
import { formatCurrency, formatPrice, formatRelative } from "@/lib/format";

const filters = [
  { value: "ALL", label: "All" },
  { value: "ACTIVE", label: "Active" },
  { value: "PAUSED", label: "Paused" },
];

function StopCopyDialog({ relationship, trigger, onStopped }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const stop = async () => {
    try {
      setLoading(true);
      await copyTradingApi.remove(relationship.id);
      toast.success("Stopped copying", {
        description: `${relationship.trader?.name || "Trader"} · history preserved`,
      });
      await globalMutate(
        (key) => typeof key === "string" && key.startsWith("/copy-trading"),
      );
      setOpen(false);
      onStopped?.();
    } catch (error) {
      toast.error("Could not stop copying", { description: error?.message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Stop copying {relationship.trader?.name}?</DialogTitle>
          <DialogDescription>
            The relationship becomes inactive. Existing trades and copied
            orders are preserved, and you can resume later.
          </DialogDescription>
        </DialogHeader>
        <DialogBody />
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Keep copying
          </Button>
          <Button variant="danger" loading={loading} onClick={stop}>
            Stop copying
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function CopyTradingPage() {
  const [filter, setFilter] = useState("ALL");
  const [page, setPage] = useState(1);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selectedTrader, setSelectedTrader] = useState(null);
  const [editing, setEditing] = useState(null);
  const [togglingId, setTogglingId] = useState(null);

  const { data, loading, error, mutate } = useApi("/copy-trading", {
    query: {
      page,
      limit: 12,
      isActive:
        filter === "ACTIVE" ? true : filter === "PAUSED" ? false : undefined,
    },
    refreshInterval: 180000,
  });
  const { data: activeData } = useApi("/copy-trading", {
    query: { isActive: true, limit: 1 },
    refreshInterval: 180000,
  });
  const { data: pausedData } = useApi("/copy-trading", {
    query: { isActive: false, limit: 1 },
    refreshInterval: 180000,
  });

  const relationships = data?.copyTraders ?? [];
  const pagination = data?.pagination;
  const activeCount = activeData?.pagination?.total ?? 0;
  const pausedCount = pausedData?.pagination?.total ?? 0;

  const toggle = async (relationship) => {
    try {
      setTogglingId(relationship.id);
      await copyTradingApi.update(relationship.id, {
        isActive: !relationship.isActive,
      });
      toast.success(
        relationship.isActive ? "Copying paused" : "Copying resumed",
        { description: relationship.trader?.name },
      );
      await globalMutate(
        (key) => typeof key === "string" && key.startsWith("/copy-trading"),
      );
    } catch (error) {
      toast.error("Could not update relationship", {
        description: error?.message,
      });
    } finally {
      setTogglingId(null);
    }
  };

  const invalidate = () =>
    globalMutate(
      (key) => typeof key === "string" && key.startsWith("/copy-trading"),
    );

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Mirror trading"
        title="Copy trading"
        description="Mirror another trader's market orders into a portfolio you control. Each relationship has its own allocation and optional notional cap."
        actions={
          <Button
            variant="primary"
            size="md"
            onClick={() => setPickerOpen(true)}
          >
            <Plus className="size-4" aria-hidden="true" />
            Copy a trader
          </Button>
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat
          label="Copying"
          value={activeCount.toLocaleString()}
          deltaLabel="active relationships"
          icon={Copy}
        />
        <Stat
          label="Paused"
          value={pausedCount.toLocaleString()}
          deltaLabel="resume any time"
          icon={Pause}
          tone="flat"
        />
        <Stat
          label="Execution"
          value="Market"
          deltaLabel="copied orders use market fills"
          icon={CircleDollarSign}
          tone="flat"
        />
      </div>

      <div className="flex items-center justify-between gap-3">
        <SegmentedControl
          options={filters}
          value={filter}
          onChange={(value) => {
            setFilter(value);
            setPage(1);
          }}
          ariaLabel="Copy trading filter"
        />
        <span className="text-[10.5px] text-fg-subtle">
          Source trades fan out once; copied trades are not copied again.
        </span>
      </div>

      {error ? (
        <ErrorState
          code={error.code}
          title="Could not load copy relationships"
          description={error.message}
          action={
            <Button variant="secondary" size="sm" onClick={() => mutate()}>
              Retry
            </Button>
          }
        />
      ) : loading && !relationships.length ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((key) => (
            <Skeleton key={key} className="h-[220px] rounded-[12px]" />
          ))}
        </div>
      ) : relationships.length === 0 ? (
        <EmptyState
          icon={UserRound}
          title={filter === "ALL" ? "You are not copying anyone" : `No ${filter.toLowerCase()} relationships`}
          description="Pick a trader from the leaderboard and mirror their market orders with your own risk limits."
          action={
            <Button
              variant="primary"
              size="md"
              onClick={() => setPickerOpen(true)}
            >
              <Plus className="size-4" aria-hidden="true" />
              Find a trader
            </Button>
          }
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {relationships.map((relationship) => (
            <Card key={relationship.id} className="overflow-hidden">
              <div
                className="h-1 w-full"
                style={{
                  background: relationship.isActive
                    ? "var(--up)"
                    : "var(--line-strong)",
                }}
                aria-hidden="true"
              />
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <Link href={`/u/${relationship.traderId}`}>
                      <Avatar
                        src={relationship.trader?.avatarUrl}
                        name={relationship.trader?.name || "Trader"}
                        size={38}
                      />
                    </Link>
                    <div className="min-w-0">
                      <Link
                        href={`/u/${relationship.traderId}`}
                        className="block truncate text-[13px] font-semibold text-fg hover:text-brand"
                      >
                        {relationship.trader?.name || "Unknown trader"}
                      </Link>
                      <p className="text-[10px] text-fg-subtle">
                        Since {formatRelative(relationship.createdAt)}
                      </p>
                    </div>
                  </div>
                  <Badge
                    tone={relationship.isActive ? "up" : "neutral"}
                    dot
                  >
                    {relationship.isActive ? "Active" : "Paused"}
                  </Badge>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-2">
                  <div className="rounded-[8px] border border-line bg-surface-2/50 px-2.5 py-2">
                    <p className="text-[9px] uppercase tracking-[0.07em] text-fg-subtle">
                      Allocation
                    </p>
                    <p className="tnum mt-0.5 text-[15px] font-semibold text-fg">
                      {formatPrice(relationship.allocationPct)}%
                    </p>
                  </div>
                  <div className="rounded-[8px] border border-line bg-surface-2/50 px-2.5 py-2">
                    <p className="text-[9px] uppercase tracking-[0.07em] text-fg-subtle">
                      Max trade
                    </p>
                    <p className="tnum mt-0.5 text-[15px] font-semibold text-fg">
                      {relationship.maxTradeSize
                        ? formatCurrency(relationship.maxTradeSize, { compact: true })
                        : "No cap"}
                    </p>
                  </div>
                </div>

                <div className="mt-2 flex items-center justify-between gap-2 rounded-[8px] border border-line bg-surface-2/30 px-2.5 py-2">
                  <span className="text-[10px] text-fg-subtle">Destination</span>
                  <Link
                    href={
                      relationship.copyPortfolioId
                        ? `/portfolios/${relationship.copyPortfolioId}`
                        : "/portfolios"
                    }
                    className="truncate text-[11px] font-medium text-fg-muted hover:text-brand"
                  >
                    {relationship.copyPortfolio?.name || "Default portfolio"}
                    <ArrowRight className="ml-1 inline size-3" aria-hidden="true" />
                  </Link>
                </div>

                <div className="mt-3 flex items-center gap-1.5">
                  <Button
                    variant="secondary"
                    size="sm"
                    className="flex-1"
                    loading={togglingId === relationship.id}
                    onClick={() => toggle(relationship)}
                  >
                    {relationship.isActive ? (
                      <>
                        <Pause className="size-3.5" aria-hidden="true" />
                        Pause
                      </>
                    ) : (
                      <>
                        <Play className="size-3.5" aria-hidden="true" />
                        Resume
                      </>
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Edit copy settings"
                    onClick={() => setEditing(relationship)}
                  >
                    <Pencil className="size-3.5" aria-hidden="true" />
                  </Button>
                  <StopCopyDialog
                    relationship={relationship}
                    onStopped={invalidate}
                    trigger={
                      <Button
                        variant="danger-ghost"
                        size="icon-sm"
                        aria-label="Stop copying"
                      >
                        <StopCircle className="size-3.5" aria-hidden="true" />
                      </Button>
                    }
                  />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {relationships.length ? (
        <Pagination
          page={pagination?.page || page}
          totalPages={pagination?.totalPages || 1}
          total={pagination?.total}
          limit={pagination?.limit || 12}
          onPageChange={setPage}
        />
      ) : null}

      <TraderPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onPick={setSelectedTrader}
      />
      <CopyTradeDialog
        trader={selectedTrader}
        open={Boolean(selectedTrader)}
        onOpenChange={(open) => {
          if (!open) setSelectedTrader(null);
        }}
        onCreated={invalidate}
      />
      <EditCopyTradeDialog
        relationship={editing}
        open={Boolean(editing)}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
      />
    </div>
  );
}
