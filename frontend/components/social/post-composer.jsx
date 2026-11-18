"use client";

import { useState } from "react";
import { Hash, Send, X } from "lucide-react";
import { toast } from "sonner";
import { mutate as globalMutate } from "swr";

import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { socialApi } from "@/lib/endpoints";
import { useSession } from "@/store/use-session";
import { cn } from "@/lib/utils";

const LIMIT = 2000;

export function PostComposer({ onPosted }) {
  const user = useSession((state) => state.user);
  const [content, setContent] = useState("");
  const [symbol, setSymbol] = useState("");
  const [tagOpen, setTagOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    if (!content.trim()) return;

    try {
      setLoading(true);
      await socialApi.createPost({
        content: content.trim(),
        ...(symbol.trim() ? { symbol: symbol.trim().toUpperCase() } : {}),
      });
      setContent("");
      setSymbol("");
      setTagOpen(false);
      toast.success("Posted to the feed");
      await globalMutate(
        (key) => typeof key === "string" && key.startsWith("/social/feed"),
      );
      onPosted?.();
    } catch (error) {
      toast.error("Could not post", { description: error?.message });
    } finally {
      setLoading(false);
    }
  };

  const remaining = LIMIT - content.length;

  return (
    <form
      onSubmit={submit}
      className="panel overflow-hidden focus-within:border-line-strong"
    >
      <div className="flex gap-3 p-4">
        <Avatar src={user?.avatarUrl} name={user?.name} size={34} />
        <div className="min-w-0 flex-1">
          <Textarea
            value={content}
            onChange={(event) => setContent(event.target.value.slice(0, LIMIT))}
            placeholder="Share a trade idea, a thesis, or what you are watching…"
            className="min-h-[74px] resize-none border-0 bg-transparent p-0 text-[13px] shadow-none focus:bg-transparent focus:ring-0"
            aria-label="Post content"
          />

          {tagOpen || symbol ? (
            <div className="mt-2 flex items-center gap-2 rounded-[7px] border border-line bg-surface-2 px-2 py-1.5">
              <Hash className="size-3.5 text-fg-subtle" aria-hidden="true" />
              <input
                value={symbol}
                onChange={(event) =>
                  setSymbol(event.target.value.toUpperCase().slice(0, 20))
                }
                placeholder="SYMBOL"
                className="w-28 bg-transparent font-mono text-[11px] uppercase text-fg outline-none placeholder:text-fg-subtle"
                aria-label="Tag a symbol"
              />
              <button
                type="button"
                onClick={() => {
                  setSymbol("");
                  setTagOpen(false);
                }}
                className="ml-auto flex size-5 items-center justify-center rounded-[4px] text-fg-subtle hover:bg-surface-3 hover:text-fg"
                aria-label="Remove symbol tag"
              >
                <X className="size-3" />
              </button>
            </div>
          ) : null}
        </div>
      </div>

      <div className="flex items-center justify-between border-t border-line px-3 py-2.5">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setTagOpen(true)}
            className="inline-flex h-7 items-center gap-1.5 rounded-[6px] px-2 text-[11px] font-medium text-fg-subtle transition-colors hover:bg-surface-2 hover:text-fg"
          >
            <Hash className="size-3.5" aria-hidden="true" />
            Symbol
          </button>
          <span
            className={cn(
              "tnum ml-1 text-[10px]",
              remaining < 100 ? "text-warn" : "text-fg-subtle",
            )}
          >
            {remaining}
          </span>
        </div>
        <Button
          type="submit"
          variant="primary"
          size="sm"
          loading={loading}
          disabled={!content.trim()}
          rightIcon={<Send className="size-3.5" aria-hidden="true" />}
        >
          Post
        </Button>
      </div>
    </form>
  );
}
