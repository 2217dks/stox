"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  CalendarDays,
  Copy,
  Crown,
  Medal,
  Trophy,
  UserPlus,
  Users,
} from "lucide-react";
import { toast } from "sonner";

import { CopyTradeDialog } from "@/components/copy-trading/copy-trade-dialog";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardHeader,
  CardHeading,
  CardTitle,
} from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { EmptyState, ErrorState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { SegmentedControl } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { Stat } from "@/components/ui/stat";
import { useApi } from "@/lib/hooks";
import { socialApi } from "@/lib/endpoints";
import { LEADERBOARD_PERIODS } from "@/lib/constants";
import { formatCurrency, formatPercent, formatRelative } from "@/lib/format";
import { useSession } from "@/store/use-session";
import { cn } from "@/lib/utils";

const scopes = [
  { value: "GLOBAL", label: "Global" },
  { value: "FRIENDS", label: "Friends" },
];

const medalTone = ["text-[#F5C451]", "text-[#C7D2E5]", "text-[#D79A6C]"];

export default function LeaderboardPage() {
  const user = useSession((state) => state.user);
  const [period, setPeriod] = useState("ALL_TIME");
  const [scope, setScope] = useState("GLOBAL");
  const [page, setPage] = useState(1);
  const [mode, setMode] = useState("latest");
  const [date, setDate] = useState("");
  const [loadingAction, setLoadingAction] = useState(null);

  const endpoint =
    scope === "FRIENDS" ? "/leaderboard/friends" : "/leaderboard";
  const query =
    mode === "history"
      ? { period, page, limit: 20, date: date || undefined }
      : { period, page, limit: 20 };

  const { data, loading, error, mutate } = useApi(
    mode === "history" ? "/leaderboard/history" : endpoint,
    { query, refreshInterval: 180000 },
  );
  const { data: followingData, mutate: mutateFollowing } = useApi(
    "/social/following",
  );

  const entries = data?.leaderboard ?? [];
  const pagination = data?.pagination;
  const followingIds = useMemo(
    () => new Set((followingData?.following ?? []).map((item) => item.id)),
    [followingData],
  );

  const topThree = entries.slice(0, 3);
  const topReturn = entries.length
    ? Math.max(...entries.map((entry) => Number(entry.returnPct)))
    : null;

  const toggleFollow = async (entry) => {
    if (!entry.user) return;
    const isFollowing = followingIds.has(entry.user.id);

    try {
      setLoadingAction(entry.user.id);
      if (isFollowing) await socialApi.unfollow(entry.user.id);
      else await socialApi.follow(entry.user.id);
      await mutateFollowing();
      toast.success(
        isFollowing
          ? `Unfollowed ${entry.user.name}`
          : `Following ${entry.user.name}`,
      );
    } catch (error) {
      toast.error("Could not update follow", { description: error?.message });
    } finally {
      setLoadingAction(null);
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Rankings"
        title="Leaderboard"
        description="Compare virtual performance across daily, weekly, monthly and all-time windows. Follow the process, not the noise."
        actions={
          <Badge tone="brand" dot>
            {mode === "history"
              ? "Historical snapshot"
              : scope === "GLOBAL"
                ? "Global scope"
                : "Friends scope"}
          </Badge>
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat
          label="Ranked traders"
          value={(pagination?.total ?? 0).toLocaleString()}
          deltaLabel={mode === "history" ? (date || "Latest snapshot") : "current period"}
          icon={Users}
          tone="flat"
        />
        <Stat
          label="Top return"
          value={
            topReturn !== null ? formatPercent(topReturn) : "—"
          }
          deltaLabel={period.replace("_", " ").toLowerCase()}
          tone={topReturn !== null && topReturn >= 0 ? "up" : "down"}
          icon={Trophy}
        />
        <Stat
          label="Your position"
          value={
            entries.find((entry) => entry.userId === user?.id)
              ? `#${entries.find((entry) => entry.userId === user?.id).rank}`
              : "—"
          }
          deltaLabel="on this page"
          tone="flat"
          icon={Crown}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {mode !== "history" ? (
            <SegmentedControl
              options={scopes}
              value={scope}
              onChange={(value) => {
                setScope(value);
                setPage(1);
              }}
              ariaLabel="Leaderboard scope"
            />
          ) : null}
          <SegmentedControl
            options={LEADERBOARD_PERIODS}
            value={period}
            onChange={(value) => {
              setPeriod(value);
              setPage(1);
            }}
            ariaLabel="Leaderboard period"
          />
        </div>
        <div className="flex items-center gap-2">
          <SegmentedControl
            options={[
              { value: "latest", label: "Live" },
              { value: "history", label: "History" },
            ]}
            value={mode}
            onChange={(value) => {
              setMode(value);
              setScope("GLOBAL");
              setPage(1);
            }}
            size="sm"
            ariaLabel="Leaderboard mode"
          />
          {mode === "history" ? (
            <Input
              type="date"
              value={date}
              onChange={(event) => {
                setDate(event.target.value);
                setPage(1);
              }}
              inputSize="sm"
              className="w-[150px]"
              aria-label="Leaderboard date"
              leftIcon={<CalendarDays className="size-3.5" />}
            />
          ) : null}
        </div>
      </div>

      {error ? (
        <ErrorState
          code={error.code}
          title="Could not load the leaderboard"
          description={error.message}
          action={
            <Button variant="secondary" size="sm" onClick={() => mutate()}>
              Retry
            </Button>
          }
        />
      ) : loading && !entries.length ? (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            {[0, 1, 2].map((key) => (
              <Skeleton key={key} className="h-[132px] rounded-[12px]" />
            ))}
          </div>
          <Skeleton className="h-[420px] rounded-[12px]" />
        </div>
      ) : entries.length === 0 ? (
        <EmptyState
          icon={Trophy}
          title={
            mode === "history"
              ? "No snapshot for this date"
              : scope === "FRIENDS"
                ? "No friends ranked yet"
                : "No leaderboard entries yet"
          }
          description={
            scope === "FRIENDS"
              ? "Follow traders to build a friends leaderboard."
              : "Rankings appear after portfolio snapshots are generated."
          }
          action={
            scope === "FRIENDS" ? (
              <Button asChild variant="secondary" size="sm">
                <Link href="/social">Find traders</Link>
              </Button>
            ) : null
          }
        />
      ) : (
        <>
          {page === 1 && topThree.length === 3 ? (
            <div className="grid gap-3 sm:grid-cols-3">
              {topThree.map((entry, index) => (
                <div
                  key={entry.userId}
                  className={cn(
                    "panel relative overflow-hidden p-4",
                    index === 0 && "border-[#F5C451]/25",
                  )}
                >
                  {index === 0 ? (
                    <div
                      className="pointer-events-none absolute -right-10 -top-10 size-32 rounded-full opacity-30 blur-2xl"
                      style={{
                        background:
                          "radial-gradient(circle, #F5C451, transparent 65%)",
                      }}
                    />
                  ) : null}
                  <div className="flex items-center justify-between">
                    <span
                      className={cn(
                        "flex items-center gap-1.5 text-[11px] font-semibold",
                        medalTone[index],
                      )}
                    >
                      {index === 0 ? (
                        <Crown className="size-3.5" aria-hidden="true" />
                      ) : (
                        <Medal className="size-3.5" aria-hidden="true" />
                      )}
                      Rank #{entry.rank}
                    </span>
                    <Badge tone={index === 0 ? "warn" : "outline"}>
                      {period.replace("_", " ")}
                    </Badge>
                  </div>
                  <div className="mt-4 flex items-center gap-3">
                    <Link href={`/u/${entry.userId}`}>
                      <Avatar
                        src={entry.user?.avatarUrl}
                        name={entry.user?.name || "Trader"}
                        size={44}
                        className={index === 0 ? "ring-2 ring-[#F5C451]/40" : ""}
                      />
                    </Link>
                    <div className="min-w-0">
                      <Link
                        href={`/u/${entry.userId}`}
                        className="truncate text-[13px] font-semibold text-fg hover:text-brand"
                      >
                        {entry.user?.name || "Unknown trader"}
                      </Link>
                      <p className="tnum text-[10.5px] text-fg-subtle">
                        {formatCurrency(entry.totalValue, { compact: true })}{" "}
                        portfolio
                      </p>
                    </div>
                  </div>
                  <p
                    className={cn(
                      "tnum mt-4 text-[24px] font-semibold tracking-[-0.03em]",
                      Number(entry.returnPct) >= 0 ? "text-up" : "text-down",
                    )}
                  >
                    {formatPercent(Number(entry.returnPct))}
                  </p>
                  <div className="mt-3 flex gap-1.5">
                    {entry.user ? (
                      <>
                        <Button
                          variant={
                            followingIds.has(entry.user.id)
                              ? "secondary"
                              : "primary"
                          }
                          size="sm"
                          className="flex-1"
                          loading={loadingAction === entry.user.id}
                          onClick={() => toggleFollow(entry)}
                        >
                          {followingIds.has(entry.user.id) ? (
                            "Following"
                          ) : (
                            <>
                              <UserPlus className="size-3.5" aria-hidden="true" />
                              Follow
                            </>
                          )}
                        </Button>
                        <CopyTradeDialog
                          trader={entry.user}
                          trigger={
                            <Button
                              variant="secondary"
                              size="icon-sm"
                              aria-label={`Copy ${entry.user.name}`}
                            >
                              <Copy className="size-3.5" aria-hidden="true" />
                            </Button>
                          }
                        />
                      </>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          <Card>
            <CardHeader>
              <CardHeading>
                <CardTitle>
                  {mode === "history" ? "Historical snapshot" : "Ranking table"}
                </CardTitle>
                <p className="text-[11.5px] text-fg-subtle">
                  {scope === "FRIENDS"
                    ? "Traders you follow, re-ranked by return"
                    : "All ranked traders"}
                  {date && mode === "history" ? ` · ${date}` : ""}
                </p>
              </CardHeading>
              <CardAction>
                <span className="text-[10.5px] text-fg-subtle">
                  Updated {entries[0]?.createdAt ? formatRelative(entries[0].createdAt) : "—"}
                </span>
              </CardAction>
            </CardHeader>
            <DataTable
              caption="Leaderboard rankings"
              rows={entries}
              getRowKey={(row) => `${row.userId}-${row.rank}`}
              empty={
                <EmptyState
                  compact
                  icon={Trophy}
                  title="No rankings"
                  description="Try another period or scope."
                />
              }
              columns={[
                {
                  key: "rank",
                  header: "Rank",
                  render: (row) => (
                    <span
                      className={cn(
                        "tnum inline-flex size-7 items-center justify-center rounded-full text-[11px] font-semibold",
                        row.rank === 1
                          ? "bg-warn-soft text-warn"
                          : row.rank === 2
                            ? "bg-surface-3 text-fg"
                            : row.rank === 3
                              ? "bg-[rgba(215,154,108,.12)] text-[#D79A6C]"
                              : "text-fg-subtle",
                      )}
                    >
                      {row.rank}
                    </span>
                  ),
                },
                {
                  key: "user",
                  header: "Trader",
                  render: (row) => (
                    <Link
                      href={`/u/${row.userId}`}
                      className="flex items-center gap-2.5 hover:text-brand"
                    >
                      <Avatar
                        src={row.user?.avatarUrl}
                        name={row.user?.name || "Trader"}
                        size={28}
                      />
                      <div className="min-w-0">
                        <p className="truncate text-[12px] font-medium text-fg">
                          {row.user?.name || "Unknown trader"}
                          {row.userId === user?.id ? (
                            <span className="ml-1.5 text-[9px] text-brand">
                              you
                            </span>
                          ) : null}
                        </p>
                        <p className="text-[9.5px] text-fg-subtle">
                          {formatCurrency(row.totalValue, { compact: true })}{" "}
                          portfolio
                        </p>
                      </div>
                    </Link>
                  ),
                },
                {
                  key: "returnPct",
                  header: "Return",
                  align: "right",
                  render: (row) => (
                    <span
                      className={cn(
                        "tnum text-[12.5px] font-medium",
                        Number(row.returnPct) >= 0 ? "text-up" : "text-down",
                      )}
                    >
                      {formatPercent(Number(row.returnPct))}
                    </span>
                  ),
                },
                {
                  key: "totalValue",
                  header: "Value",
                  align: "right",
                  render: (row) => formatCurrency(row.totalValue),
                },
                {
                  key: "snapshotDate",
                  header: "Snapshot",
                  align: "right",
                  render: (row) => (
                    <span className="text-[10.5px] text-fg-subtle">
                      {row.snapshotDate
                        ? new Date(row.snapshotDate).toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                          })
                        : "—"}
                    </span>
                  ),
                },
                {
                  key: "actions",
                  header: "",
                  align: "right",
                  render: (row) =>
                    row.user ? (
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => toggleFollow(row)}
                          disabled={loadingAction === row.user.id}
                          className="flex h-6 items-center rounded-[5px] border border-line bg-surface-2 px-1.5 text-[9.5px] font-medium text-fg-muted transition-colors hover:border-line-strong hover:text-fg"
                        >
                          {followingIds.has(row.user.id) ? "Following" : "Follow"}
                        </button>
                        <CopyTradeDialog
                          trader={row.user}
                          trigger={
                            <button
                              type="button"
                              className="flex size-6 items-center justify-center rounded-[5px] text-fg-subtle transition-colors hover:bg-surface-2 hover:text-fg"
                              aria-label={`Copy ${row.user.name}`}
                            >
                              <Copy className="size-3" aria-hidden="true" />
                            </button>
                          }
                        />
                      </div>
                    ) : null,
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
        </>
      )}
    </div>
  );
}
