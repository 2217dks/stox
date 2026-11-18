"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { mutate as globalMutate } from "swr";

import { getAccessToken, onAuthChange, refreshSession } from "@/lib/auth";
import { disconnectSocket, getSocket } from "@/lib/socket";
import { useActivePortfolio } from "@/lib/hooks";
import { useSession } from "@/store/use-session";
import { formatPrice } from "@/lib/format";

function invalidateTrading(portfolioId) {
  globalMutate(
    (key) =>
      typeof key === "string" &&
      (key.startsWith("/orders") ||
        key.startsWith("/trades") ||
        key.startsWith("/portfolios") ||
        key.startsWith("/notifications") ||
        (portfolioId && key.startsWith(`/portfolios/${portfolioId}`))),
  );
}

function recoverAuth(socket) {
  if (socket.__stoxRecoverAuth) return;

  socket.__stoxRecoverAuth = async (error) => {
    const code = error?.data?.code;
    if (code !== "INVALID_ACCESS_TOKEN" && code !== "UNAUTHORIZED") return;

    const refreshed = await refreshSession();
    if (!refreshed) return;

    socket.auth = { token: getAccessToken() };
    socket.connect();
  };

  socket.on("connect_error", socket.__stoxRecoverAuth);
}

function NotificationBridge() {
  const router = useRouter();
  const status = useSession((state) => state.status);

  useEffect(() => {
    if (status !== "authed") return undefined;

    const token = getAccessToken();
    const socket = getSocket("/notifications", { token });
    recoverAuth(socket);

    const handleNotification = (notification) => {
      if (!notification?.notificationId) return;

      globalMutate(
        (key) => typeof key === "string" && key.startsWith("/notifications"),
      );

      toast(notification.title || "New notification", {
        description: notification.message,
        action: notification.data?.orderId
          ? {
              label: "View orders",
              onClick: () => {
                router.push("/orders");
              },
            }
          : undefined,
      });
    };

    socket.on("notification", handleNotification);

    return () => {
      socket.off("notification", handleNotification);
    };
  }, [status, router]);

  return null;
}

function TradingBridge() {
  const status = useSession((state) => state.status);
  const portfolioId = useActivePortfolio().portfolioId;

  useEffect(() => {
    if (status !== "authed" || !portfolioId) return undefined;

    const token = getAccessToken();
    const socket = getSocket("/trading", { token });
    recoverAuth(socket);

    const join = () => {
      socket.emit("join:portfolio", { portfolioId });
    };

    const handleOrderStatus = (event) => {
      if (!event?.orderId) return;

      invalidateTrading(event.portfolioId);

      if (
        event.status === "REJECTED" ||
        event.status === "CANCELLED" ||
        event.status === "EXPIRED"
      ) {
        toast(`Order ${event.status.toLowerCase()} · ${event.symbol}`, {
          description: `${event.side} ${event.quantity}`,
        });
      }
    };

    const handleTradeExecuted = (event) => {
      if (!event?.tradeId) return;

      invalidateTrading(event.portfolioId);
      toast(`Filled · ${event.symbol}`, {
        description: `${event.side} ${event.quantity} @ ${formatPrice(event.price)}`,
      });
    };

    const handlePortfolioUpdate = (event) => {
      if (!event?.portfolioId) return;
      globalMutate(
        (key) =>
          typeof key === "string" &&
          key.startsWith(`/portfolios/${event.portfolioId}`),
      );
      globalMutate(
        (key) => typeof key === "string" && key.startsWith("/portfolios?"),
      );
    };

    socket.on("connect", join);
    socket.on("order-status", handleOrderStatus);
    socket.on("trade-executed", handleTradeExecuted);
    socket.on("portfolio-update", handlePortfolioUpdate);

    if (socket.connected) join();

    return () => {
      socket.emit("leave:portfolio", { portfolioId });
      socket.off("connect", join);
      socket.off("order-status", handleOrderStatus);
      socket.off("trade-executed", handleTradeExecuted);
      socket.off("portfolio-update", handlePortfolioUpdate);
    };
  }, [status, portfolioId]);

  return null;
}

function AuthTokenSync() {
  useEffect(
    () =>
      onAuthChange((detail) => {
        if (detail.type === "logout") {
          disconnectSocket("/trading");
          disconnectSocket("/notifications");
          return;
        }

        if (detail.type !== "login") return;

        const token = getAccessToken();
        if (!token) return;

        ["/trading", "/notifications"].forEach((namespace) => {
          const socket = getSocket(namespace);
          if (socket.auth?.token === token) return;
          socket.auth = { token };
          if (socket.connected) socket.disconnect();
          socket.connect();
        });
      }),
    [],
  );

  return null;
}

export function RealtimeBridge() {
  return (
    <>
      <NotificationBridge />
      <TradingBridge />
      <AuthTokenSync />
    </>
  );
}
