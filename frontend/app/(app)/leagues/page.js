"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  ArrowRight,
  Plus,
  Trophy,
} from "lucide-react";
import { toast } from "sonner";
import { mutate as globalMutate } from "swr";

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
import { Field, Input, Textarea } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { SegmentedControl } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { useApi } from "@/lib/hooks";
import { leaguesApi } from "@/lib/endpoints";
import { LEAGUE_STATUS } from "@/lib/constants";
import { formatCurrency, formatDate } from "@/lib/format";
import { leagueSchema } from "@/lib/validators";

const filters = [
  { value: "ALL", label: "All" },
  { value: "ACTIVE", label: "Active" },
  { value: "UPCOMING", label: "Upcoming" },
  { value: "COMPLETED", label: "Completed" },
];

function CreateLeagueDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(leagueSchema),
    defaultValues: {
      name: "",
      description: "",
      startingBalance: "10000",
      startDate: "",
      endDate: "",
      maxParticipants: "",
    },
  });

  const onSubmit = async (values) => {
    try {
      const data = await leaguesApi.create({
        name: values.name.trim(),
        description: values.description?.trim() || undefined,
        startingBalance: Number(values.startingBalance),
        startDate: new Date(values.startDate).toISOString(),
        endDate: new Date(values.endDate).toISOString(),
        maxParticipants: values.maxParticipants
          ? Number(values.maxParticipants)
          : undefined,
      });
      const league = data?.league ?? data;
      toast.success("League created", {
        description: `${values.name} · ${formatCurrency(values.startingBalance, { compact: true })} start`,
      });
      await globalMutate(
        (key) => typeof key === "string" && key.startsWith("/leagues"),
      );
      setOpen(false);
      if (league?.id) router.push(`/leagues/${league.id}`);
    } catch (error) {
      setError("root", {
        message: error?.message || "Could not create the league.",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary" size="md">
          <Plus className="size-4" aria-hidden="true" />
          Create league
        </Button>
      </DialogTrigger>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Create a league</DialogTitle>
          <DialogDescription>
            Leagues are time-bound competitions. Each participant gets a
            league-specific portfolio with the starting balance you set.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} noValidate>
          <DialogBody className="space-y-4">
            {errors.root?.message ? (
              <div className="rounded-[8px] border border-down/25 bg-down-soft px-3 py-2 text-[12px] text-down">
                {errors.root.message}
              </div>
            ) : null}

            <Field label="Name" htmlFor="league-name" error={errors.name?.message}>
              {({ id }) => (
                <Input
                  id={id}
                  placeholder="Weekend alpha"
                  invalid={Boolean(errors.name)}
                  {...register("name")}
                />
              )}
            </Field>

            <Field
              label="Description"
              htmlFor="league-description"
              optional
              error={errors.description?.message}
            >
              {({ id }) => (
                <Textarea
                  id={id}
                  rows={2}
                  placeholder="Rules, theme or goal for this league"
                  {...register("description")}
                />
              )}
            </Field>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label="Starting balance"
                htmlFor="league-balance"
                error={errors.startingBalance?.message}
              >
                {({ id }) => (
                  <Input
                    id={id}
                    inputMode="decimal"
                    className="font-mono tnum"
                    leftIcon={<span className="text-[12px]">$</span>}
                    invalid={Boolean(errors.startingBalance)}
                    {...register("startingBalance")}
                  />
                )}
              </Field>
              <Field
                label="Max participants"
                htmlFor="league-max"
                optional
                error={errors.maxParticipants?.message}
              >
                {({ id }) => (
                  <Input
                    id={id}
                    inputMode="numeric"
                    placeholder="Unlimited"
                    className="font-mono tnum"
                    {...register("maxParticipants")}
                  />
                )}
              </Field>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label="Starts"
                htmlFor="league-start"
                error={errors.startDate?.message}
              >
                {({ id }) => (
                  <Input
                    id={id}
                    type="datetime-local"
                    invalid={Boolean(errors.startDate)}
                    {...register("startDate")}
                  />
                )}
              </Field>
              <Field
                label="Ends"
                htmlFor="league-end"
                error={errors.endDate?.message}
              >
                {({ id }) => (
                  <Input
                    id={id}
                    type="datetime-local"
                    invalid={Boolean(errors.endDate)}
                    {...register("endDate")}
                  />
                )}
              </Field>
            </div>
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={isSubmitting}>
              Create league
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function LeagueCard({ league }) {
  const status = LEAGUE_STATUS[league.status] || LEAGUE_STATUS.UPCOMING;
  const start = new Date(league.startDate);
  const end = new Date(league.endDate);

  return (
    <Card className="flex flex-col overflow-hidden">
      <CardContent className="flex flex-1 flex-col p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <Link
              href={`/leagues/${league.id}`}
              className="block truncate text-[14px] font-semibold text-fg hover:text-brand"
            >
              {league.name}
            </Link>
            <p className="mt-1 line-clamp-2 min-h-[30px] text-[11px] leading-relaxed text-fg-subtle">
              {league.description || "No description"}
            </p>
          </div>
          <Badge tone={status.tone} dot>
            {status.label}
          </Badge>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-1.5">
          <div className="rounded-[7px] border border-line bg-surface-2/50 px-2 py-1.5">
            <p className="text-[8.5px] uppercase tracking-[0.07em] text-fg-subtle">
              Start
            </p>
            <p className="tnum mt-0.5 text-[10.5px] text-fg">
              {formatCurrency(league.startingBalance, { compact: true })}
            </p>
          </div>
          <div className="rounded-[7px] border border-line bg-surface-2/50 px-2 py-1.5">
            <p className="text-[8.5px] uppercase tracking-[0.07em] text-fg-subtle">
              Players
            </p>
            <p className="tnum mt-0.5 text-[10.5px] text-fg">
              {league.memberCount ?? 0}
              {league.maxParticipants ? `/${league.maxParticipants}` : ""}
            </p>
          </div>
          <div className="rounded-[7px] border border-line bg-surface-2/50 px-2 py-1.5">
            <p className="text-[8.5px] uppercase tracking-[0.07em] text-fg-subtle">
              Ends
            </p>
            <p className="mt-0.5 text-[10.5px] text-fg">
              {formatDate(end, { year: undefined })}
            </p>
          </div>
        </div>

        <div className="mt-3 flex items-center justify-between rounded-[7px] border border-line bg-surface-2/30 px-2.5 py-1.5 text-[9.5px] text-fg-subtle">
          <span>{formatDate(start, { year: undefined })}</span>
          <span className="text-line-strong">→</span>
          <span>{formatDate(end, { year: undefined })}</span>
        </div>

        <div className="mt-auto flex items-center gap-2 pt-4">
          <Button asChild variant="secondary" size="sm" className="flex-1">
            <Link href={`/leagues/${league.id}`}>
              View league
              <ArrowRight className="size-3.5" aria-hidden="true" />
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function LeaguesPage() {
  const [status, setStatus] = useState("ALL");
  const { data, loading, error, mutate } = useApi("/leagues", {
    query: { status: status === "ALL" ? undefined : status, limit: 50 },
    refreshInterval: 180000,
  });

  const leagues = Array.isArray(data) ? data : (data?.leagues ?? []);
  const active = leagues.filter((league) => league.status === "ACTIVE");
  const upcoming = leagues.filter((league) => league.status === "UPCOMING");
  const completed = leagues.filter((league) => league.status === "COMPLETED");

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Competition"
        title="Leagues"
        description="Time-bound competitions with a dedicated portfolio and starting balance. Same markets, same clock."
        actions={<CreateLeagueDialog />}
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl
          options={filters}
          value={status}
          onChange={setStatus}
          ariaLabel="League status"
        />
        <span className="text-[10.5px] text-fg-subtle">
          {leagues.length} leagues · {active.length} active
        </span>
      </div>

      {error ? (
        <ErrorState
          code={error.code}
          title="Could not load leagues"
          description={error.message}
          action={
            <Button variant="secondary" size="sm" onClick={() => mutate()}>
              Retry
            </Button>
          }
        />
      ) : loading && !leagues.length ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((key) => (
            <Skeleton key={key} className="h-[240px] rounded-[12px]" />
          ))}
        </div>
      ) : leagues.length === 0 ? (
        <EmptyState
          icon={Trophy}
          title="No leagues here"
          description="Create one and invite traders, or wait for the next community competition."
          action={<CreateLeagueDialog />}
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {leagues.map((league) => (
            <LeagueCard key={league.id} league={league} />
          ))}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardContent className="p-4">
            <p className="eyebrow">Active now</p>
            <p className="tnum mt-2 text-[28px] font-semibold text-fg">
              {active.length}
            </p>
            <p className="mt-1 text-[11px] text-fg-subtle">
              Leagues currently trading
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="eyebrow">Upcoming</p>
            <p className="tnum mt-2 text-[28px] font-semibold text-fg">
              {upcoming.length}
            </p>
            <p className="mt-1 text-[11px] text-fg-subtle">
              Starting soon
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="eyebrow">Completed</p>
            <p className="tnum mt-2 text-[28px] font-semibold text-fg">
              {completed.length}
            </p>
            <p className="mt-1 text-[11px] text-fg-subtle">
              Final standings preserved
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
