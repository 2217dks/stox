"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  LogIn,
  Trophy,
  Users,
} from "lucide-react";
import { toast } from "sonner";

import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardHeading,
  CardTitle,
} from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { EmptyState, ErrorState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { useApi } from "@/lib/hooks";
import { leaguesApi } from "@/lib/endpoints";
import { LEAGUE_STATUS } from "@/lib/constants";
import { formatCurrency, formatDate, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";

export default function LeagueDetailPage() {
  const params = useParams();
  const leagueId = params.leagueId;
  const [joining, setJoining] = useState(false);
  const [joinedPortfolio, setJoinedPortfolio] = useState(null);

  const {
    data: leagueData,
    loading: leagueLoading,
    error: leagueError,
    mutate: mutateLeague,
  } = useApi(`/leagues/${leagueId}`);
  const {
    data: boardData,
    loading: boardLoading,
    error: boardError,
    mutate: mutateBoard,
  } = useApi(`/leagues/${leagueId}/leaderboard`, { refreshInterval: 180000 });

  const league = leagueData?.league;
  const leaderboard = boardData?.leaderboard ?? [];
  const status = league ? LEAGUE_STATUS[league.status] || LEAGUE_STATUS.UPCOMING : null;

  const join = async () => {
    try {
      setJoining(true);
      const data = await leaguesApi.join(leagueId, {});
      const member = data?.member ?? data;
      toast.success("Joined league", {
        description: member?.portfolio?.name
          ? `League portfolio: ${member.portfolio.name}`
          : "Your league portfolio is ready.",
      });
      setJoinedPortfolio(member?.portfolio || null);
      await Promise.all([mutateLeague(), mutateBoard()]);
    } catch (error) {
      toast.error("Could not join league", {
        description: error?.message || "You may already be a participant.",
      });
    } finally {
      setJoining(false);
    }
  };

  if (leagueLoading && !league) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-40 w-full rounded-[16px]" />
        <Skeleton className="h-[360px] rounded-[12px]" />
      </div>
    );
  }

  if (leagueError || !league) {
    return (
      <ErrorState
        code={leagueError?.code}
        title="League not found"
        description={leagueError?.message || "This league may have been removed."}
        action={
          <Button asChild variant="secondary" size="sm">
            <Link href="/leagues">Back to leagues</Link>
          </Button>
        }
      />
    );
  }

  const start = new Date(league.startDate);
  const end = new Date(league.endDate);
  const canJoin = league.status === "ACTIVE" || league.status === "UPCOMING";

  return (
    <div className="space-y-5">
      <Link
        href="/leagues"
        className="inline-flex items-center gap-1 text-[11.5px] text-fg-subtle transition-colors hover:text-fg"
      >
        <ArrowLeft className="size-3.5" aria-hidden="true" />
        Leagues
      </Link>

      <div className="panel relative overflow-hidden p-5 sm:p-6">
        <div
          className="pointer-events-none absolute -right-20 -top-24 size-72 rounded-full opacity-30 blur-3xl"
          style={{
            background:
              "radial-gradient(circle, rgba(245,184,75,.35), transparent 65%)",
          }}
        />
        <div className="relative flex flex-col justify-between gap-5 lg:flex-row lg:items-start">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-[25px] font-semibold tracking-[-0.03em] text-fg">
                {league.name}
              </h1>
              {status ? (
                <Badge tone={status.tone} dot>
                  {status.label}
                </Badge>
              ) : null}
            </div>
            <p className="mt-1.5 max-w-[60ch] text-[12.5px] leading-relaxed text-fg-muted">
              {league.description || "No description for this league."}
            </p>

            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-[11.5px] text-fg-muted">
              <span className="flex items-center gap-1.5">
                <CalendarDays className="size-3.5 text-fg-subtle" aria-hidden="true" />
                {formatDate(start)} → {formatDate(end)}
              </span>
              <span className="flex items-center gap-1.5">
                <Users className="size-3.5 text-fg-subtle" aria-hidden="true" />
                {league.memberCount ?? 0}
                {league.maxParticipants ? ` / ${league.maxParticipants}` : ""} participants
              </span>
              <span className="flex items-center gap-1.5">
                <Trophy className="size-3.5 text-fg-subtle" aria-hidden="true" />
                {formatCurrency(league.startingBalance)} starting balance
              </span>
            </div>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {joinedPortfolio ? (
              <Button asChild variant="primary" size="md">
                <Link href={`/portfolios/${joinedPortfolio.id}`}>
                  Open league portfolio
                  <ArrowRight className="size-4" aria-hidden="true" />
                </Link>
              </Button>
            ) : canJoin ? (
              <Button
                variant="primary"
                size="md"
                loading={joining}
                onClick={join}
              >
                <LogIn className="size-4" aria-hidden="true" />
                Join league
              </Button>
            ) : null}
            <Button asChild variant="secondary" size="md">
              <Link href="/leaderboard">Global rankings</Link>
            </Button>
          </div>
        </div>

        <div className="relative mt-5 flex items-center gap-3 rounded-[9px] border border-line bg-surface-2/40 px-3 py-2 text-[10.5px] text-fg-subtle">
          <CalendarDays className="size-3.5" aria-hidden="true" />
          <span>{formatDate(start)}</span>
          <span className="text-line-strong">→</span>
          <span>{formatDate(end)}</span>
          <span className="ml-auto font-medium text-fg-muted">
            {status?.label}
          </span>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <CardContent className="p-4">
            <p className="eyebrow">Participants</p>
            <p className="tnum mt-2 text-[26px] font-semibold text-fg">
              {league.memberCount ?? 0}
            </p>
            <p className="mt-1 text-[10.5px] text-fg-subtle">
              Each gets a league portfolio
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="eyebrow">Starting balance</p>
            <p className="tnum mt-2 text-[26px] font-semibold text-fg">
              {formatCurrency(league.startingBalance, { compact: true })}
            </p>
            <p className="mt-1 text-[10.5px] text-fg-subtle">
              Identical for every player
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="eyebrow">Ends</p>
            <p className="mt-2 text-[18px] font-semibold text-fg">
              {formatDate(end)}
            </p>
            <p className="mt-1 text-[10.5px] text-fg-subtle">
              Final standings are preserved
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardHeading>
            <CardTitle>League leaderboard</CardTitle>
            <p className="text-[11.5px] text-fg-subtle">
              Ranked by return on the league portfolio
            </p>
          </CardHeading>
        </CardHeader>
        <DataTable
          caption="League leaderboard"
          loading={boardLoading && !leaderboard.length}
          rows={leaderboard}
          getRowKey={(row) => row.userId}
          empty={
            boardError ? (
              <ErrorState
                compact
                code={boardError.code}
                title="Leaderboard unavailable"
                description={boardError.message}
              />
            ) : (
              <EmptyState
                compact
                icon={Trophy}
                title="No participants ranked yet"
                description="Join the league to put your portfolio on the board."
              />
            )
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
                      : "text-fg-subtle",
                  )}
                >
                  {row.rank ?? "—"}
                </span>
              ),
            },
            {
              key: "userName",
              header: "Trader",
              render: (row) => (
                <Link
                  href={`/u/${row.userId}`}
                  className="flex items-center gap-2.5 hover:text-brand"
                >
                  <Avatar
                    src={row.userAvatar}
                    name={row.userName || "Trader"}
                    size={28}
                  />
                  <span className="truncate text-[12px] font-medium text-fg">
                    {row.userName}
                  </span>
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
              render: (row) =>
                row.totalValue != null ? formatCurrency(row.totalValue) : "—",
            },
            {
              key: "tradeCount",
              header: "Trades",
              align: "right",
              render: (row) => row.tradeCount ?? "—",
            },
            {
              key: "joinedAt",
              header: "Joined",
              align: "right",
              render: (row) => (
                <span className="text-[10.5px] text-fg-subtle">
                  {row.joinedAt ? formatDate(row.joinedAt) : "—"}
                </span>
              ),
            },
          ]}
        />
      </Card>
    </div>
  );
}
