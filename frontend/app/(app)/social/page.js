"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  ClipboardList,
  MessageSquare,
  Sparkles,
  Users,
} from "lucide-react";
import { toast } from "sonner";

import { PostCard } from "@/components/social/post-card";
import { PostComposer } from "@/components/social/post-composer";
import { Avatar } from "@/components/ui/avatar";
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
import { EmptyState, ErrorState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { SegmentedControl } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { useApi } from "@/lib/hooks";
import { socialApi } from "@/lib/endpoints";
import { formatPercent } from "@/lib/format";
import { useSession } from "@/store/use-session";
import { cn } from "@/lib/utils";

const sorts = [
  { value: "latest", label: "Latest" },
  { value: "trending", label: "Trending" },
];

export default function SocialPage() {
  const user = useSession((state) => state.user);
  const [sort, setSort] = useState("latest");
  const [page, setPage] = useState(1);

  const { data, loading, error, mutate } = useApi("/social/feed", {
    query: { page, limit: 12, sort },
    refreshInterval: 180000,
  });
  const { data: followingData, mutate: mutateFollowing } = useApi(
    "/social/following",
  );
  const { data: followersData } = useApi("/social/followers");
  const { data: leaderboardData, loading: leaderboardLoading } = useApi(
    "/leaderboard",
    { query: { period: "ALL_TIME", limit: 8 } },
  );

  const posts = data?.posts ?? [];
  const pagination = data?.pagination;
  const following = useMemo(
    () => followingData?.following ?? [],
    [followingData],
  );
  const followers = followersData?.followers ?? [];
  const followingIds = useMemo(
    () => new Set(following.map((item) => item.id)),
    [following],
  );
  const topTraders = (leaderboardData?.leaderboard ?? []).filter(
    (entry) => entry.user && entry.user.id !== user?.id,
  );

  const toggleFollow = async (trader) => {
    const isFollowing = followingIds.has(trader.id);

    try {
      if (isFollowing) {
        await socialApi.unfollow(trader.id);
        toast.success(`Unfollowed ${trader.name}`);
      } else {
        await socialApi.follow(trader.id);
        toast.success(`Following ${trader.name}`);
      }
      await mutateFollowing();
    } catch (error) {
      toast.error("Could not update follow", { description: error?.message });
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Community"
        title="Social"
        description="Ideas, theses and the traders behind them. Follow people whose process you can learn from."
        actions={
          <Button asChild variant="secondary" size="md">
            <Link href="/leaderboard">
              <Users className="size-4" aria-hidden="true" />
              Find traders
            </Link>
          </Button>
        }
      />

      <div className="grid gap-4 xl:grid-cols-12">
        <div className="space-y-4 xl:col-span-8">
          <PostComposer onPosted={() => mutate()} />

          <div className="flex items-center justify-between gap-3">
            <SegmentedControl
              options={sorts}
              value={sort}
              onChange={(value) => {
                setSort(value);
                setPage(1);
              }}
              ariaLabel="Feed sort"
            />
            <span className="text-[10.5px] text-fg-subtle">
              {pagination?.total
                ? `${pagination.total.toLocaleString()} posts`
                : "Community feed"}
            </span>
          </div>

          {error ? (
            <ErrorState
              code={error.code}
              title="Could not load the feed"
              description={error.message}
              action={
                <Button variant="secondary" size="sm" onClick={() => mutate()}>
                  Retry
                </Button>
              }
            />
          ) : loading && !posts.length ? (
            <div className="panel space-y-4 p-4">
              {[0, 1, 2].map((key) => (
                <div key={key} className="flex gap-3">
                  <Skeleton className="size-9 rounded-full" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-3 w-32" />
                    <Skeleton className="h-3 w-full" />
                    <Skeleton className="h-3 w-2/3" />
                  </div>
                </div>
              ))}
            </div>
          ) : posts.length === 0 ? (
            <EmptyState
              icon={MessageSquare}
              title="The feed is quiet"
              description="Be the first to share an idea, a thesis, or a symbol you are watching."
            />
          ) : (
            <div className="panel overflow-hidden">
              {posts.map((post) => (
                <PostCard
                  key={post.id}
                  post={post}
                  currentUser={user}
                  onDeleted={() => mutate()}
                />
              ))}
            </div>
          )}

          {posts.length ? (
            <Pagination
              page={pagination?.page || page}
              totalPages={pagination?.totalPages || 1}
              total={pagination?.total}
              limit={pagination?.limit || 20}
              onPageChange={setPage}
            />
          ) : null}
        </div>

        <div className="space-y-4 xl:col-span-4">
          <Card>
            <CardHeader>
              <CardHeading>
                <CardTitle className="flex items-center gap-2">
                  <Sparkles className="size-3.5 text-brand" aria-hidden="true" />
                  Traders to watch
                </CardTitle>
                <p className="text-[11.5px] text-fg-subtle">
                  Top all-time leaderboard
                </p>
              </CardHeading>
              <CardAction>
                <Link
                  href="/leaderboard"
                  className="text-[11px] font-medium text-brand hover:text-brand-strong"
                >
                  All
                </Link>
              </CardAction>
            </CardHeader>
            <CardContent>
              {leaderboardLoading && !topTraders.length ? (
                <div className="space-y-2">
                  {[0, 1, 2].map((key) => (
                    <Skeleton key={key} className="h-10" />
                  ))}
                </div>
              ) : topTraders.length ? (
                <ul className="space-y-1">
                  {topTraders.slice(0, 6).map((entry) => (
                    <li
                      key={entry.userId}
                      className="flex items-center gap-2.5 rounded-[7px] px-1 py-1.5"
                    >
                      <Link href={`/u/${entry.user.id}`} className="shrink-0">
                        <Avatar
                          src={entry.user.avatarUrl}
                          name={entry.user.name}
                          size={30}
                        />
                      </Link>
                      <Link
                        href={`/u/${entry.user.id}`}
                        className="min-w-0 flex-1"
                      >
                        <p className="truncate text-[11.5px] font-medium text-fg">
                          {entry.user.name}
                        </p>
                        <p
                          className={cn(
                            "tnum text-[10px]",
                            Number(entry.returnPct) >= 0
                              ? "text-up"
                              : "text-down",
                          )}
                        >
                          {formatPercent(Number(entry.returnPct))} · rank #
                          {entry.rank}
                        </p>
                      </Link>
                      <button
                        type="button"
                        onClick={() => toggleFollow(entry.user)}
                        className={cn(
                          "flex h-6 items-center rounded-[5px] border px-1.5 text-[9.5px] font-medium transition-colors",
                          followingIds.has(entry.user.id)
                            ? "border-line bg-surface-2 text-fg-muted hover:text-down"
                            : "border-brand/30 bg-brand-soft text-brand hover:bg-brand-soft-strong",
                        )}
                      >
                        {followingIds.has(entry.user.id) ? "Following" : "Follow"}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState
                  compact
                  icon={Users}
                  title="No ranked traders yet"
                  description="Leaderboard entries appear after snapshots are generated."
                />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardHeading>
                <CardTitle>Your network</CardTitle>
                <p className="text-[11.5px] text-fg-subtle">
                  {following.length} following · {followers.length} followers
                </p>
              </CardHeading>
              <CardAction>
                <Link
                  href="/u/me"
                  className="text-[11px] font-medium text-brand hover:text-brand-strong"
                >
                  Profile
                </Link>
              </CardAction>
            </CardHeader>
            <CardContent>
              {following.length ? (
                <ul className="space-y-1">
                  {following.slice(0, 6).map((trader) => (
                    <li key={trader.id}>
                      <Link
                        href={`/u/${trader.id}`}
                        className="flex items-center gap-2.5 rounded-[7px] px-1 py-1.5 transition-colors hover:bg-surface-2"
                      >
                        <Avatar src={trader.avatarUrl} name={trader.name} size={26} />
                        <span className="min-w-0 flex-1 truncate text-[11.5px] text-fg-muted">
                          {trader.name}
                        </span>
                        <ArrowRight className="size-3 text-fg-subtle" aria-hidden="true" />
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="py-3">
                  <p className="text-[11.5px] leading-relaxed text-fg-subtle">
                    Follow a trader to see their ideas and keep their profile
                    one tap away.
                  </p>
                  <Link
                    href="/leaderboard"
                    className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-brand hover:text-brand-strong"
                  >
                    Browse leaderboard
                    <ArrowRight className="size-3" aria-hidden="true" />
                  </Link>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2.5">
                <span className="flex size-8 items-center justify-center rounded-[8px] bg-violet-soft text-violet">
                  <ClipboardList className="size-4" aria-hidden="true" />
                </span>
                <div>
                  <p className="text-[12px] font-medium text-fg">
                    Community guidelines
                  </p>
                  <p className="text-[10.5px] text-fg-subtle">
                    Ideas, not financial advice
                  </p>
                </div>
              </div>
              <p className="mt-2.5 text-[10.5px] leading-relaxed text-fg-subtle">
                Everyone here is practising. Share reasoning, disclose when you
                hold a position, and keep critique about the trade — not the
                trader.
              </p>
              <Badge tone="outline" className="mt-3">
                Virtual funds only
              </Badge>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
