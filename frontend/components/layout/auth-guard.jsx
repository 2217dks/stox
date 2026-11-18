"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";

import { Logo } from "@/components/ui/logo";
import { useSession } from "@/store/use-session";

function BootScreen() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-canvas">
      <Logo href={null} size={34} />
      <div className="flex items-center gap-2 text-[12px] text-fg-subtle">
        <span className="size-1.5 rounded-full bg-brand live-dot" />
        Preparing your terminal
      </div>
      <div className="h-1 w-40 overflow-hidden rounded-full bg-surface-2">
        <div className="h-full w-1/2 animate-[stox-shimmer_1.4s_ease-in-out_infinite] rounded-full bg-brand/70" />
      </div>
    </div>
  );
}

export function AuthGuard({ children }) {
  const router = useRouter();
  const pathname = usePathname();
  const status = useSession((state) => state.status);
  const user = useSession((state) => state.user);

  useEffect(() => {
    if (status !== "guest") return;
    const next = encodeURIComponent(pathname || "/dashboard");
    router.replace(`/login?next=${next}`);
  }, [status, router, pathname]);

  if (status === "idle" || status === "loading") return <BootScreen />;
  if (status === "guest" || !user) return <BootScreen />;

  return children;
}
