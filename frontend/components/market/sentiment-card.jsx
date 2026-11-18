"use client";

import { useState } from "react";
import { Minus, TrendingDown, TrendingUp } from "lucide-react";
import { toast } from "sonner";

import { Card, CardAction, CardContent, CardHeader, CardHeading, CardTitle } from "@/components/ui/card";
import { SegmentedControl } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { sentimentApi } from "@/lib/endpoints";
import { useApi } from "@/lib/hooks";
import { cn } from "@/lib/utils";

const windows = [
  { value: "24h", label: "24h" },
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
  { value: "all", label: "All" },
];

const votes = [
  { value: "BULLISH", label: "Bullish", icon: TrendingUp, tone: "up" },
  { value: "NEUTRAL", label: "Neutral", icon: Minus, tone: "neutral" },
  { value: "BEARISH", label: "Bearish", icon: TrendingDown, tone: "down" },
];

export function SentimentCard({ symbol }) {
  const [window, setWindow] = useState("30d");
  const [voting, setVoting] = useState(false);

  const { data, loading, mutate } = useApi(
    symbol ? `/sentiment/${encodeURIComponent(symbol)}` : null,
    { query: { window }, refreshInterval: 180000 },
  );

  const percentages = data?.percentages || { bullish: 0, bearish: 0, neutral: 0 };
  const totalVotes = data?.totalVotes || 0;
  const thresholdMet = data?.sampleThresholdMet;

  const vote = async (value) => {
    try {
      setVoting(true);
      await sentimentApi.vote(symbol, value);
      await mutate();
      toast.success("Vote recorded", {
        description: `You voted ${value.toLowerCase()} on ${symbol}.`,
      });
    } catch (error) {
      toast.error("Vote failed", { description: error?.message });
    } finally {
      setVoting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardHeading>
          <CardTitle>Community sentiment</CardTitle>
          <p className="text-[11.5px] text-fg-subtle">
            {thresholdMet
              ? `${totalVotes.toLocaleString()} votes · sample met`
              : totalVotes
                ? `${totalVotes.toLocaleString()} votes · below sample threshold`
                : "No votes in this window"}
          </p>
        </CardHeading>
        <CardAction>
          <SegmentedControl
            options={windows}
            value={window}
            onChange={setWindow}
            size="sm"
            ariaLabel="Sentiment window"
          />
        </CardAction>
      </CardHeader>
      <CardContent>
        {loading && !data ? (
          <Skeleton className="h-24" />
        ) : (
          <>
            <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-surface-3">
              <span
                className="bg-up transition-[width] duration-500"
                style={{ width: `${percentages.bullish || 0}%` }}
                aria-hidden="true"
              />
              <span
                className="bg-fg-subtle/60 transition-[width] duration-500"
                style={{ width: `${percentages.neutral || 0}%` }}
                aria-hidden="true"
              />
              <span
                className="bg-down transition-[width] duration-500"
                style={{ width: `${percentages.bearish || 0}%` }}
                aria-hidden="true"
              />
            </div>

            <div className="mt-2.5 flex justify-between text-[10.5px]">
              <span className="tnum text-up">
                {(percentages.bullish || 0).toFixed(0)}% bullish
              </span>
              <span className="tnum text-fg-subtle">
                {(percentages.neutral || 0).toFixed(0)}% neutral
              </span>
              <span className="tnum text-down">
                {(percentages.bearish || 0).toFixed(0)}% bearish
              </span>
            </div>

            <div className="mt-4 grid grid-cols-3 gap-1.5">
              {votes.map((item) => {
                const active = data?.userVote === item.value;
                return (
                  <button
                    key={item.value}
                    type="button"
                    onClick={() => vote(item.value)}
                    disabled={voting}
                    aria-pressed={active}
                    className={cn(
                      "flex h-9 items-center justify-center gap-1.5 rounded-[7px] border text-[11px] font-medium transition-colors disabled:opacity-60",
                      active
                        ? item.value === "BULLISH"
                          ? "border-up/40 bg-up-soft text-up"
                          : item.value === "BEARISH"
                            ? "border-down/40 bg-down-soft text-down"
                            : "border-line-strong bg-surface-3 text-fg"
                        : "border-line bg-surface-2 text-fg-muted hover:border-line-strong hover:text-fg",
                    )}
                  >
                    <item.icon className="size-3.5" aria-hidden="true" />
                    {item.label}
                  </button>
                );
              })}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
