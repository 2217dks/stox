"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  Copy,
  MessageSquare,
  Settings,
  Trophy,
  UserCheck,
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
  CardContent,
  CardHeader,
  CardHeading,
  CardTitle,
} from "@/components/ui/card";
import { EmptyState, ErrorState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Stat } from "@/components/ui/stat";
import { useApi } from "@/lib/hooks";
import { socialApi } from "@/lib/endpoints";
import { formatPercent } from "@/lib/format";
import { useSession } from "@/store/use-session";
import { cn } from "@/lib/utils";

export default function PublicProfilePage() {
  const params = useParams();
  const currentUser = useSession((state) => state.user);
  const requestedId = params.userId;
  const userId = requestedId === "me" ? currentUser?.id : requestedId;
  const isOwn = userId === currentUser?.id;

  const { data, loading, error, mutate } = useApi(
    userId ? `/users/${userId}` : null,
    { enabled: Boolean(userId) },
  );
  const { data: statsData } = useApi(
    userId && isOwn ? "/users/me/statistics" : null,
    { enabled: Boolean(isOwn) },
  );
  const { data: followingData, mutate: mutateFollowing } = useApi(
    userId && !isOwn ? "/social/following" : null,
    { enabled: Boolean(userId) && !isOwn },
  );
  const { data: leaderboardData } = useApi("/leaderboard", {
    query: { period: "ALL_TIME", limit: 100 },
  });

  const profile = data?.user;
  const followingIds = useMemo(
    () => new Set((followingData?.following ?? []).map((item) => item.id)),
    [followingData],
  );
  const isFollowing = profile?.isFollowing ?? followingIds.has(userId);
  const stats = statsData?.statistics;
  const leaderboardEntry = (leaderboardData?.leaderboard ?? []).find(
    (entry) => entry.userId === userId,
  );

  const toggleFollow = async () => {
    try {
      if (isFollowing) {
        await socialApi.unfollow(userId);
        toast.success(`Unfollowed ${profile?.name}`);
      } else {
        await socialApi.follow(userId);
        toast.success(`Following ${profile?.name}`);
      }
      await Promise.all([mutate(), mutateFollowing()]);
    } catch (error) {
      toast.error("Could not update follow", { description: error?.message });
    }
  };

  if (loading && !profile) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-48 w-full rounded-[16px]" />
        <div className="grid gap-3 sm:grid-cols-3">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
      </div>
    );
  }

  if (error || !profile) {
    return (
      <ErrorState
        code={error?.code}
        title="Profile not found"
        description={
          error?.message ||
          "This trader may have been suspended or the profile is unavailable."
        }
        action={
          <Button asChild variant="secondary" size="sm">
            <Link href="/social">Back to social</Link>
          </Button>
        }
      />
    );
  }

  return (
    <div className="space-y-5">
      <Link
        href="/social"
        className="inline-flex items-center gap-1 text-[11.5px] text-fg-subtle transition-colors hover:text-fg"
      >
        <ArrowLeft className="size-3.5" aria-hidden="true" />
        Social
      </Link>

      <div className="panel relative overflow-hidden">
        <div
          className="h-28 w-full sm:h-32"
          style={{
            background:
              "radial-gradient(120% 140% at 20% 0%, rgba(108,151,255,.3), transparent 55%), radial-gradient(90% 120% at 90% 10%, rgba(94,234,212,.16), transparent 60%), var(--surface-2)",
          }}
          aria-hidden="true"
        />
        <div className="grid-lines pointer-events-none absolute inset-x-0 top-0 h-28 opacity-40 sm:h-32" />
        <div className="relative px-4 pb-5 sm:px-6">
          <div className="-mt-9 flex flex-col gap-4 sm:-mt-10 sm:flex-row sm:items-end sm:justify-between">
            <div className="flex items-end gap-4">
              <Avatar
                src={profile.avatarUrl}
                name={profile.name}
                size={76}
                className="border-4 border-surface shadow-[var(--shadow-pop)]"
              />
              <div className="pb-0.5">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-[24px] font-semibold leading-tight tracking-[-0.03em] text-fg">
                    {profile.name}
                  </h1>
                  {isOwn ? <Badge tone="brand">You</Badge> : null}
                  {leaderboardEntry ? (
                    <Badge tone="warn" dot>
                      Rank #{leaderboardEntry.rank}
                    </Badge>
                  ) : null}
                </div>
                <p className="mt-1 text-[11.5px] text-fg-subtle">
                  Stox paper trader · virtual funds
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {isOwn ? (
                <>
                  <Button asChild variant="secondary" size="md">
                    <Link href="/settings">
                      <Settings className="size-4" aria-hidden="true" />
                      Edit profile
                    </Link>
                  </Button>
                  <Button asChild variant="primary" size="md">
                    <Link href="/portfolios">Portfolios</Link>
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    variant={isFollowing ? "secondary" : "primary"}
                    size="md"
                    onClick={toggleFollow}
                  >
                    {isFollowing ? (
                      <UserCheck className="size-4" aria-hidden="true" />
                    ) : (
                      <UserPlus className="size-4" aria-hidden="true" />
                    )}
                    {isFollowing ? "Following" : "Follow"}
                  </Button>
                  <CopyTradeDialog
                    trader={profile}
                    trigger={
                      <Button variant="secondary" size="md">
                        <Copy className="size-4" aria-hidden="true" />
                        Copy trader
                      </Button>
                    }
                  />
                </>
              )}
            </div>
          </div>

          <div className="mt-5 flex flex-wrap gap-x-6 gap-y-2 text-[12px]">
            <span>
              <span className="tnum font-semibold text-fg">
                {profile.counts?.followers ?? 0}
              </span>{" "}
              <span className="text-fg-subtle">followers</span>
            </span>
            <span>
              <span className="tnum font-semibold text-fg">
                {profile.counts?.following ?? 0}
              </span>{" "}
              <span className="text-fg-subtle">following</span>
            </span>
            <span>
              <span className="tnum font-semibold text-fg">
                {profile.counts?.posts ?? 0}
              </span>{" "}
              <span className="text-fg-subtle">posts</span>
            </span>
            {leaderboardEntry ? (
              <span>
                <span
                  className={cn(
                    "tnum font-semibold",
                    Number(leaderboardEntry.returnPct) >= 0
                      ? "text-up"
                      : "text-down",
                  )}
                >
                  {formatPercent(Number(leaderboardEntry.returnPct))}
                </span>{" "}
                <span className="text-fg-subtle">all-time return</span>
              </span>
            ) : null}
          </div>
        </div>
      </div>

      {isOwn ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Stat
              label="Trades"
              value={(stats?.totalTrades ?? 0).toLocaleString()}
              deltaLabel="executed"
              icon={MessageSquare}
            />
            <Stat
              label="Win rate"
              value={
                stats?.winRate != null
                  ? formatPercent(Number(stats.winRate) * 100, { signed: false })
                  : "—"
              }
              deltaLabel={`${stats?.winningTrades ?? 0} wins`}
              tone="flat"
            />
            <Stat
              label="Volume"
              value={
                stats?.totalVolume
                  ? `$${Number(stats.totalVolume).toLocaleString("en-US", {
                      maximumFractionDigits: 0,
                    })}`
                  : "$0"
              }
              deltaLabel="traded notional"
              tone="flat"
            />
            <Stat
              label="Leaderboard"
              value={leaderboardEntry ? `#${leaderboardEntry.rank}` : "—"}
              deltaLabel={
                leaderboardEntry
                  ? `${formatPercent(Number(leaderboardEntry.returnPct))} return`
                  : "Not ranked yet"
              }
              tone="flat"
              icon={Trophy}
            />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardHeading>
                  <CardTitle>Your public identity</CardTitle>
                  <p className="text-[11.5px] text-fg-subtle">
                    What other traders can see
                  </p>
                </CardHeading>
              </CardHeader>
              <CardContent className="space-y-2 text-[11.5px]">
                <div className="flex items-center justify-between">
                  <span className="text-fg-subtle">Name</span>
                  <span className="text-fg">{profile.name}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-fg-subtle">Avatar</span>
                  <span className="text-fg">
                    {profile.avatarUrl ? "Custom" : "Generated"}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-fg-subtle">Email</span>
                  <span className="text-fg-subtle">Never public</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-fg-subtle">Portfolio values</span>
                  <span className="text-fg-subtle">Private</span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardHeading>
                  <CardTitle>Grow your network</CardTitle>
                  <p className="text-[11.5px] text-fg-subtle">
                    Follow traders from the leaderboard
                  </p>
                </CardHeading>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-2.5 rounded-[8px] border border-line bg-surface-2/50 px-3 py-2.5">
                  <span className="flex size-8 items-center justify-center rounded-[8px] bg-brand-soft text-brand">
                    <Users className="size-4" aria-hidden="true" />
                  </span>
                  <div className="flex-1">
                    <p className="text-[11.5px] font-medium text-fg">
                      {profile.counts?.followers ?? 0} followers
                    </p>
                    <p className="text-[10px] text-fg-subtle">
                      Your ideas are visible in the community feed
                    </p>
                  </div>
                </div>
                <div className="mt-3 flex gap-2">
                  <Button asChild variant="secondary" size="sm" className="flex-1">
                    <Link href="/social">Go to feed</Link>
                  </Button>
                  <Button asChild variant="primary" size="sm" className="flex-1">
                    <Link href="/leaderboard">Leaderboard</Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardHeading>
                <CardTitle>Trading style</CardTitle>
                <p className="text-[11.5px] text-fg-subtle">
                  Position data is private
                </p>
              </CardHeading>
            </CardHeader>
            <CardContent>
              <EmptyState
                compact
                icon={Trophy}
                title="Performance speaks through the leaderboard"
                description="You can see their all-time rank and return here, and mirror their market orders with your own limits."
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardHeading>
                <CardTitle>Copy with limits</CardTitle>
                <p className="text-[11.5px] text-fg-subtle">
                  Your portfolio, your controls
                </p>
              </CardHeading>
            </CardHeader>
            <CardContent className="space-y-3 text-[11.5px] leading-relaxed text-fg-muted">
              <p>
                Copying mirrors market orders into a portfolio you choose. Set
                an allocation percentage and an optional notional cap per trade.
              </p>
              <p className="text-fg-subtle">
                Copied orders fill at the market, so the final notional can
                differ from the source. Copied trades are never copied again.
              </p>
              <CopyTradeDialog
                trader={profile}
                trigger={
                  <Button variant="primary" size="sm" className="w-full">
                    <Copy className="size-3.5" aria-hidden="true" />
                    Set up copy trading
                  </Button>
                }
              />
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
