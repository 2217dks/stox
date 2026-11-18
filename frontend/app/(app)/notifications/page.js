"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Bell,
  BellOff,
  CheckCheck,
  CircleDollarSign,
  MailCheck,
  Trophy,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { mutate as globalMutate } from "swr";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, ErrorState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { SegmentedControl } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { useApi, useUnreadNotifications } from "@/lib/hooks";
import { notificationsApi } from "@/lib/endpoints";
import { NOTIFICATION_TYPES } from "@/lib/constants";
import { formatDateTime, formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";

const typeIcons = {
  ORDER_EXECUTED: CircleDollarSign,
  ORDER_CANCELLED: BellOff,
  ORDER_REJECTED: BellOff,
  ORDER_EXPIRED: BellOff,
  PRICE_ALERT: Bell,
  ACHIEVEMENT_UNLOCKED: Trophy,
  COPY_TRADE_EXECUTED: Users,
  LEAGUE_UPDATE: Trophy,
  NEW_FOLLOWER: Users,
  SYSTEM: MailCheck,
};

const filters = [
  { value: "ALL", label: "All" },
  { value: "UNREAD", label: "Unread" },
];

export default function NotificationsPage() {
  const router = useRouter();
  const [filter, setFilter] = useState("ALL");
  const [page, setPage] = useState(1);
  const [marking, setMarking] = useState(false);
  const [readingId, setReadingId] = useState(null);

  const { data, loading, error, mutate } = useApi("/notifications", {
    query: {
      page,
      limit: 20,
      isRead: filter === "UNREAD" ? false : undefined,
    },
    refreshInterval: 120000,
  });
  const { count: unreadCount } = useUnreadNotifications();

  const notifications = data?.notifications ?? [];
  const pagination = data?.pagination;

  const invalidate = () =>
    globalMutate(
      (key) => typeof key === "string" && key.startsWith("/notifications"),
    );

  const markRead = async (notification) => {
    if (notification.isRead) return;

    try {
      setReadingId(notification.id);
      await notificationsApi.markRead(notification.id);
      await invalidate();
    } catch (error) {
      toast.error("Could not mark as read", { description: error?.message });
    } finally {
      setReadingId(null);
    }
  };

  const markAll = async () => {
    try {
      setMarking(true);
      await notificationsApi.markAllRead();
      await invalidate();
      toast.success("All notifications marked as read");
    } catch (error) {
      toast.error("Could not mark all as read", { description: error?.message });
    } finally {
      setMarking(false);
    }
  };

  const openNotification = async (notification) => {
    await markRead(notification);
    const data = notification.data || {};

    if (data.orderId) {
      router.push(`/orders?focus=${data.orderId}`);
    } else if (data.alertId) {
      router.push("/alerts");
    } else if (data.userId) {
      router.push(`/u/${data.userId}`);
    } else if (data.leagueId) {
      router.push(`/leagues/${data.leagueId}`);
    }
  };

  const hasUnread = unreadCount > 0 || notifications.some((item) => !item.isRead);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Inbox"
        title="Notifications"
        description="Order outcomes, price alerts, achievements and social activity in one chronological stream."
        actions={
          <Button
            variant="secondary"
            size="md"
            onClick={markAll}
            loading={marking}
            disabled={!hasUnread}
          >
            <CheckCheck className="size-4" aria-hidden="true" />
            Mark all read
          </Button>
        }
      />

      <div className="flex items-center justify-between gap-3">
        <SegmentedControl
          options={filters}
          value={filter}
          onChange={(value) => {
            setFilter(value);
            setPage(1);
          }}
          ariaLabel="Notification filter"
        />
        <span className="text-[10.5px] text-fg-subtle">
          Notifications also arrive in real time when connected.
        </span>
      </div>

      {error ? (
        <ErrorState
          code={error.code}
          title="Could not load notifications"
          description={error.message}
          action={
            <Button variant="secondary" size="sm" onClick={() => mutate()}>
              Retry
            </Button>
          }
        />
      ) : loading && !notifications.length ? (
        <div className="space-y-2">
          {[0, 1, 2, 3, 4].map((key) => (
            <Skeleton key={key} className="h-[74px] rounded-[10px]" />
          ))}
        </div>
      ) : notifications.length === 0 ? (
        <EmptyState
          icon={filter === "UNREAD" ? BellOff : Bell}
          title={filter === "UNREAD" ? "You are all caught up" : "No notifications yet"}
          description={
            filter === "UNREAD"
              ? "New order, alert and social activity will appear here."
              : "Place an order or create an alert to start receiving notifications."
          }
        />
      ) : (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-line">
            {notifications.map((notification) => {
              const config =
                NOTIFICATION_TYPES[notification.type] || NOTIFICATION_TYPES.SYSTEM;
              const Icon = typeIcons[notification.type] || Bell;
              const toneMap = {
                up: "bg-up-soft text-up",
                down: "bg-down-soft text-down",
                brand: "bg-brand-soft text-brand",
                violet: "bg-violet-soft text-violet",
                info: "bg-info-soft text-info",
                warn: "bg-warn-soft text-warn",
                cyan: "bg-[rgba(94,234,212,.1)] text-cyan",
                neutral: "bg-surface-2 text-fg-muted",
              };

              return (
                <li key={notification.id}>
                  <button
                    type="button"
                    onClick={() => openNotification(notification)}
                    className={cn(
                      "flex w-full items-start gap-3 px-4 py-3.5 text-left transition-colors hover:bg-surface-2/70 sm:px-5",
                      !notification.isRead && "bg-brand-soft/25",
                    )}
                  >
                    <span
                      className={cn(
                        "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-[8px]",
                        toneMap[config.tone] || toneMap.neutral,
                      )}
                    >
                      <Icon className="size-4" strokeWidth={1.7} aria-hidden="true" />
                    </span>

                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span
                          className={cn(
                            "text-[12.5px] text-fg",
                            !notification.isRead ? "font-semibold" : "font-medium",
                          )}
                        >
                          {notification.title}
                        </span>
                        <Badge tone={config.tone} className="h-[18px] px-1.5 text-[8.5px]">
                          {config.label}
                        </Badge>
                        {!notification.isRead ? (
                          <span className="size-1.5 rounded-full bg-brand" aria-label="Unread" />
                        ) : null}
                      </span>
                      <span className="mt-0.5 block text-[11.5px] leading-relaxed text-fg-muted">
                        {notification.message}
                      </span>
                      <span
                        className="mt-1 block text-[9.5px] text-fg-subtle"
                        title={formatDateTime(notification.createdAt)}
                      >
                        {formatRelative(notification.createdAt)}
                      </span>
                    </span>

                    <ArrowRight
                      className={cn(
                        "mt-1 size-3.5 shrink-0 text-fg-subtle transition-opacity",
                        readingId === notification.id && "animate-pulse",
                      )}
                      aria-hidden="true"
                    />
                  </button>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {notifications.length ? (
        <Pagination
          page={pagination?.page || page}
          totalPages={pagination?.totalPages || 1}
          total={pagination?.total}
          limit={pagination?.limit || 20}
          onPageChange={setPage}
        />
      ) : null}
    </div>
  );
}
