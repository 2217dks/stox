import { AuthAside } from "@/components/auth/auth-aside";
import { Logo } from "@/components/ui/logo";

export default function AuthLayout({ children }) {
  return (
    <div className="app-surface grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
      <AuthAside />
      <div className="flex min-h-dvh flex-col">
        <div className="flex items-center justify-between px-5 py-5 lg:hidden">
          <Logo href="/" size={26} />
          <span className="text-[10.5px] uppercase tracking-[0.09em] text-fg-subtle">
            Paper trading
          </span>
        </div>
        <div className="flex flex-1 items-center justify-center px-5 pb-12 pt-4 sm:px-8 lg:px-12">
          <div className="w-full max-w-[380px]">{children}</div>
        </div>
        <p className="px-6 pb-6 text-center text-[10.5px] text-fg-subtle lg:text-left">
          Virtual funds only. No real money is ever at risk.
        </p>
      </div>
    </div>
  );
}
