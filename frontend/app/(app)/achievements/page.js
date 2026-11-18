"use client";

import { useMemo } from "react";
import { Award, Check, Lock, Sparkles, Trophy } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState, ErrorState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { Stat } from "@/components/ui/stat";
import { useApi } from "@/lib/hooks";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

export default function AchievementsPage() {
  const {
    data: catalogData,
    loading: catalogLoading,
    error: catalogError,
    mutate: mutateCatalog,
  } = useApi("/achievements");
  const { data: mineData, loading: mineLoading } = useApi("/achievements/mine");

  const catalog = useMemo(
    () => catalogData?.achievements ?? [],
    [catalogData],
  );
  const mine = useMemo(() => mineData?.achievements ?? [], [mineData]);

  const unlocked = useMemo(() => {
    const map = new Map();
    mine.forEach((row) => {
      if (row.achievement) map.set(row.achievement.id, row);
      else map.set(row.achievementId, row);
    });
    return map;
  }, [mine]);

  const grouped = useMemo(() => {
    const groups = new Map();
    catalog.forEach((achievement) => {
      const key = achievement.category || "General";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(achievement);
    });
    return [...groups.entries()];
  }, [catalog]);

  const unlockedCount = catalog.filter((item) => unlocked.has(item.id)).length;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Milestones"
        title="Achievements"
        description="A record of the habits and milestones that shape a trader. Unlocks are processed as your activity settles."
        actions={
          <Badge tone="violet" dot>
            {unlockedCount} / {catalog.length || "—"} unlocked
          </Badge>
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat
          label="Unlocked"
          value={unlockedCount.toLocaleString()}
          deltaLabel={`of ${catalog.length} available`}
          icon={Trophy}
          tone="flat"
        />
        <Stat
          label="Latest"
          value={mine[0]?.achievement?.name || "—"}
          deltaLabel={
            mine[0]?.unlockedAt ? formatDate(mine[0].unlockedAt) : "No unlocks yet"
          }
          tone="flat"
          icon={Sparkles}
        />
        <Stat
          label="Categories"
          value={grouped.length.toString()}
          deltaLabel="milestone groups"
          tone="flat"
          icon={Award}
        />
      </div>

      {catalogError ? (
        <ErrorState
          code={catalogError.code}
          title="Could not load achievements"
          description={catalogError.message}
          action={
            <button
              type="button"
              onClick={() => mutateCatalog()}
              className="text-[12px] font-medium text-brand"
            >
              Retry
            </button>
          }
        />
      ) : catalogLoading && !catalog.length ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((key) => (
            <Skeleton key={key} className="h-[160px] rounded-[12px]" />
          ))}
        </div>
      ) : catalog.length === 0 ? (
        <EmptyState
          icon={Award}
          title="No achievements configured"
          description="The achievement catalog is empty. Milestones will appear here once defined."
        />
      ) : (
        <div className="space-y-6">
          {grouped.map(([category, items]) => (
            <div key={category} className="space-y-3">
              <div className="flex items-center gap-3">
                <h2 className="text-[13px] font-semibold text-fg-muted">
                  {category}
                </h2>
                <span className="h-px flex-1 bg-line" />
                <span className="text-[10.5px] text-fg-subtle">
                  {items.filter((item) => unlocked.has(item.id)).length} /{" "}
                  {items.length}
                </span>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {items.map((achievement) => {
                  const record = unlocked.get(achievement.id);
                  const isUnlocked = Boolean(record);

                  return (
                    <Card
                      key={achievement.id}
                      className={cn(
                        "relative overflow-hidden",
                        !isUnlocked && "opacity-75",
                      )}
                    >
                      {isUnlocked ? (
                        <div
                          className="pointer-events-none absolute -right-10 -top-10 size-28 rounded-full opacity-25 blur-2xl"
                          style={{
                            background:
                              "radial-gradient(circle, var(--violet), transparent 65%)",
                          }}
                        />
                      ) : null}
                      <CardContent className="relative p-4">
                        <div className="flex items-start justify-between gap-2">
                          <span
                            className={cn(
                              "flex size-10 items-center justify-center rounded-[10px] border",
                              isUnlocked
                                ? "border-violet/25 bg-violet-soft text-violet"
                                : "border-line bg-surface-2 text-fg-subtle",
                            )}
                          >
                            {isUnlocked ? (
                              <Award className="size-5" strokeWidth={1.7} />
                            ) : (
                              <Lock className="size-4" strokeWidth={1.7} />
                            )}
                          </span>
                          {isUnlocked ? (
                            <Badge tone="violet">
                              <Check className="size-3" aria-hidden="true" />
                              Unlocked
                            </Badge>
                          ) : (
                            <Badge tone="neutral">Locked</Badge>
                          )}
                        </div>

                        <h3 className="mt-3 text-[13px] font-semibold text-fg">
                          {achievement.name}
                        </h3>
                        <p className="mt-1 text-[11.5px] leading-relaxed text-fg-muted">
                          {achievement.description}
                        </p>

                        {isUnlocked ? (
                          <p className="mt-3 text-[10px] text-fg-subtle">
                            Unlocked {formatDate(record.unlockedAt)}
                            {record.reason ? ` · ${record.reason}` : ""}
                          </p>
                        ) : (
                          <p className="mt-3 text-[10px] text-fg-subtle">
                            Keep trading to unlock
                          </p>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {mineLoading && !mine.length ? (
        <p className="text-[11px] text-fg-subtle">Loading your unlocks…</p>
      ) : null}
    </div>
  );
}
