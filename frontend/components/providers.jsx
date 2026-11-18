"use client";

import { useEffect } from "react";
import { SWRConfig } from "swr";
import { Toaster, toast } from "sonner";

import { onAuthChange } from "@/lib/auth";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useSession } from "@/store/use-session";
import { useUI } from "@/store/use-ui";
import { CommandMenu } from "@/components/layout/command-menu";
import { RealtimeBridge } from "@/components/realtime/realtime-bridge";

function AppBootstrap() {
  const hydrate = useSession((state) => state.hydrate);
  const boot = useUI((state) => state.boot);
  const theme = useUI((state) => state.theme);

  useEffect(() => {
    boot();
    hydrate();
  }, [boot, hydrate]);

  useEffect(
    () =>
      onAuthChange((detail) => {
        if (detail.type === "logout") {
          useSession.setState({ user: null, status: "guest", error: null });
        } else if (detail.type === "login" || detail.type === "user") {
          useSession.setState({
            user: detail.user,
            status: detail.user ? "authed" : "guest",
          });
        }
      }),
    [],
  );

  return (
    <>
      <RealtimeBridge />
      <Toaster
        theme={theme}
        position="bottom-right"
        closeButton
        richColors={false}
        duration={4000}
        toastOptions={{
          classNames: {
            toast:
              "!rounded-[12px] !border !border-line !bg-surface !text-fg !shadow-[var(--shadow-pop)]",
            title: "!text-[13px] !font-semibold !text-fg",
            description: "!text-[12px] !text-fg-muted",
            actionButton: "!bg-brand !text-brand-ink !text-[12px]",
            cancelButton: "!bg-surface-2 !text-fg-muted !text-[12px]",
            closeButton: "!bg-surface-2 !border-line !text-fg-muted",
            success: "!text-fg",
            error: "!text-fg",
          },
        }}
      />
    </>
  );
}

let lastRateLimitToast = 0;

function handleFetchError(error) {
  if (error?.status !== 429) return;
  const now = Date.now();
  if (now - lastRateLimitToast < 20000) return;
  lastRateLimitToast = now;
  toast.warning("Rate limit reached", {
    description:
      "The API is temporarily throttling requests. Data will resume shortly.",
  });
}

export function Providers({ children }) {
  return (
    <SWRConfig
      value={{
        revalidateOnFocus: false,
        revalidateIfStale: true,
        dedupingInterval: 3000,
        focusThrottleInterval: 10000,
        onError: handleFetchError,
      }}
    >
      <TooltipProvider delayDuration={350} skipDelayDuration={0}>
        <AppBootstrap />
        <CommandMenu />
        {children}
      </TooltipProvider>
    </SWRConfig>
  );
}
