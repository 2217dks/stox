"use client";

import { useState } from "react";
import Link from "next/link";
import { Copy, Heart, MoreHorizontal, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { mutate as globalMutate } from "swr";

import { CopyTradeDialog } from "@/components/copy-trading/copy-trade-dialog";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
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
import { useApi } from "@/lib/hooks";
import { socialApi } from "@/lib/endpoints";
import { formatDateTime, formatRelative, isCrypto, tickerOf } from "@/lib/format";
import { cn } from "@/lib/utils";

export function PostCard({ post, currentUser, onDeleted }) {
  const [deleting, setDeleting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [liking, setLiking] = useState(false);

  const { data: engagementData, mutate: mutateEngagement } = useApi(
    `/social/posts/${post.id}/engagement`,
  );
  const engagement = engagementData?.engagement;
  const liked = engagement?.likedByViewer ?? false;
  const likes = engagement?.likesCount ?? 0;
  const author = post.author;
  const isOwner = currentUser?.id === post.authorId;

  const toggleLike = async () => {
    if (liking) return;

    const previous = engagementData;
    try {
      setLiking(true);
      await mutateEngagement(
        {
          engagement: {
            postId: post.id,
            likesCount: Math.max(0, likes + (liked ? -1 : 1)),
            likedByViewer: !liked,
          },
        },
        { revalidate: false },
      );

      if (liked) await socialApi.unlike(post.id);
      else await socialApi.like(post.id);

      await mutateEngagement();
    } catch (error) {
      await mutateEngagement(previous, { revalidate: false });
      toast.error("Could not update like", { description: error?.message });
    } finally {
      setLiking(false);
    }
  };

  const remove = async () => {
    try {
      setDeleting(true);
      await socialApi.deletePost(post.id);
      toast.success("Post deleted");
      await globalMutate(
        (key) => typeof key === "string" && key.startsWith("/social/feed"),
      );
      setConfirmOpen(false);
      onDeleted?.(post);
    } catch (error) {
      toast.error("Could not delete post", { description: error?.message });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <article className="border-b border-line px-4 py-4 last:border-0 sm:px-5">
      <div className="flex gap-3">
        <Link href={`/u/${post.authorId}`} aria-label={`View ${author?.name || "trader"}`}>
          <Avatar src={author?.avatarUrl} name={author?.name || "?"} size={34} />
        </Link>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                <Link
                  href={`/u/${post.authorId}`}
                  className="truncate text-[12.5px] font-semibold text-fg transition-colors hover:text-brand"
                >
                  {author?.name || "Unknown trader"}
                </Link>
                <span className="text-[10px] text-fg-subtle">·</span>
                <span
                  className="text-[10.5px] text-fg-subtle"
                  title={formatDateTime(post.createdAt)}
                >
                  {formatRelative(post.createdAt)}
                </span>
                {post.symbol ? (
                  <Link
                    href={`/markets/${post.symbol}?asset=${isCrypto(post.symbol) ? "CRYPTO" : "STOCK"}`}
                    className="ml-1 inline-flex h-[18px] items-center rounded-full bg-brand-soft px-1.5 font-mono text-[9.5px] font-medium text-brand transition-colors hover:bg-brand-soft-strong"
                  >
                    ${tickerOf(post.symbol)}
                  </Link>
                ) : null}
              </div>
            </div>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton label="Post actions" size="icon-xs">
                  <MoreHorizontal className="size-4" />
                </IconButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {!isOwner && author ? (
                  <>
                    <CopyTradeDialog
                      trader={author}
                      trigger={
                        <DropdownMenuItem onSelect={(event) => event.preventDefault()}>
                          <Copy className="size-3.5" aria-hidden="true" />
                          Copy trader
                        </DropdownMenuItem>
                      }
                    />
                    <DropdownMenuSeparator />
                  </>
                ) : null}
                {isOwner ? (
                  <DropdownMenuItem
                    danger
                    onSelect={(event) => {
                      event.preventDefault();
                      setConfirmOpen(true);
                    }}
                  >
                    <Trash2 className="size-3.5" aria-hidden="true" />
                    Delete post
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem disabled>No actions</DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <p className="mt-1.5 whitespace-pre-wrap text-[12.5px] leading-relaxed text-fg-muted">
            {post.content}
          </p>

          <div className="mt-3 flex items-center gap-1">
            <button
              type="button"
              onClick={toggleLike}
              aria-pressed={liked}
              className={cn(
                "inline-flex h-7 items-center gap-1.5 rounded-[6px] px-2 text-[10.5px] font-medium transition-colors",
                liked
                  ? "bg-down-soft text-down"
                  : "text-fg-subtle hover:bg-surface-2 hover:text-fg-muted",
              )}
              aria-label={liked ? "Unlike post" : "Like post"}
            >
              <Heart
                className="size-3.5"
                fill={liked ? "currentColor" : "none"}
                aria-hidden="true"
              />
              <span className="tnum">{likes}</span>
            </button>
            {post.metadata?.tradeId ? (
              <Badge tone="outline" className="h-[18px] text-[8px]">
                Trade shared
              </Badge>
            ) : null}
          </div>
        </div>
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Delete this post?</DialogTitle>
            <DialogDescription>
              This removes the post and its likes from the public feed.
            </DialogDescription>
          </DialogHeader>
          <DialogBody />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmOpen(false)}>
              Keep post
            </Button>
            <Button variant="danger" loading={deleting} onClick={remove}>
              Delete post
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </article>
  );
}
