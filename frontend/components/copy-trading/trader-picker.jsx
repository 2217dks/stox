"use client";

import { useMemo, useState } from "react";
import { Search, Users } from "lucide-react";

import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useApi } from "@/lib/hooks";
import { formatPercent } from "@/lib/format";
import { useSession } from "@/store/use-session";
import { cn } from "@/lib/utils";

export function TraderPickerDialog({ open, onOpenChange, onPick }) {
  const user = useSession((state) => state.user);
  const [query, setQuery] = useState("");

  const { data, loading } = useApi(
    open ? "/leaderboard" : null,
    {
      query: { period: "ALL_TIME", limit: 50 },
      enabled: open,
    },
  );
  const { data: copyData } = useApi(open ? "/copy-trading" : null, {
    query: { limit: 100 },
    enabled: open,
  });

  const copiedIds = useMemo(
    () => new Set((copyData?.copyTraders ?? []).map((item) => item.traderId)),
    [copyData],
  );

  const entries = (data?.leaderboard ?? [])
    .filter((entry) => entry.user && entry.user.id !== user?.id)
    .filter((entry) =>
      query.trim()
        ? entry.user.name.toLowerCase().includes(query.trim().toLowerCase())
        : true,
    );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Find a trader to copy</DialogTitle>
          <DialogDescription>
            Traders come from the all-time leaderboard. You can copy more than
            one, each with its own allocation and cap.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search traders…"
            leftIcon={<Search className="size-4" />}
            autoFocus
          />

          <div className="max-h-[min(420px,50dvh)] overflow-y-auto">
            {loading && !entries.length ? (
              <div className="space-y-2">
                {[0, 1, 2, 3].map((key) => (
                  <Skeleton key={key} className="h-12" />
                ))}
              </div>
            ) : entries.length === 0 ? (
              <EmptyState
                compact
                icon={Users}
                title="No traders found"
                description={
                  query
                    ? "Try a different name."
                    : "Leaderboard entries appear after snapshots are generated."
                }
              />
            ) : (
              <ul className="space-y-1">
                {entries.map((entry) => {
                  const already = copiedIds.has(entry.user.id);

                  return (
                    <li
                      key={entry.userId}
                      className="flex items-center gap-3 rounded-[8px] border border-line bg-surface-2/40 px-2.5 py-2"
                    >
                      <Avatar
                        src={entry.user.avatarUrl}
                        name={entry.user.name}
                        size={32}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[12px] font-medium text-fg">
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
                      </div>
                      {already ? (
                        <Badge tone="neutral">Copying</Badge>
                      ) : (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => {
                            onPick?.(entry.user);
                            onOpenChange?.(false);
                          }}
                        >
                          Select
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
