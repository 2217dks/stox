import { Geist, Geist_Mono } from "next/font/google";

import { Providers } from "@/components/providers";

import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000",
  ),
  title: {
    default: "Stox — Paper trading, real markets",
    template: "%s · Stox",
  },
  description:
    "Practice trading stocks and crypto with virtual capital, live market data, portfolio analytics, copy trading and leaderboards. No real money at risk.",
  applicationName: "Stox",
  keywords: [
    "paper trading",
    "trading simulator",
    "stocks",
    "crypto",
    "portfolio",
    "leaderboard",
  ],
  authors: [{ name: "Stox" }],
  openGraph: {
    title: "Stox — Paper trading, real markets",
    description:
      "A professional paper-trading terminal for stocks and crypto. Virtual funds. Real market data.",
    type: "website",
    siteName: "Stox",
  },
  twitter: {
    card: "summary_large_image",
    title: "Stox — Paper trading, real markets",
    description:
      "Practice trading stocks and crypto with virtual capital and live market data.",
  },
  robots: { index: true, follow: true },
};

export const viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#07090e" },
    { media: "(prefers-color-scheme: light)", color: "#f4f6fb" },
  ],
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

const themeScript = `(function(){try{var t=localStorage.getItem("stox_theme");if(t!=="light"&&t!=="dark")t="dark";document.documentElement.dataset.theme=t;}catch(e){document.documentElement.dataset.theme="dark";}})();`;

export default function RootLayout({ children }) {
  return (
    <html
      lang="en"
      data-theme="dark"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable}`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-dvh bg-canvas font-sans text-fg antialiased">
        <a
          href="#main-content"
          className="sr-only z-[100] rounded-md bg-brand px-3 py-2 text-[13px] font-medium text-brand-ink focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
        >
          Skip to content
        </a>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
