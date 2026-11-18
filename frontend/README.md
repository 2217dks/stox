# Stox frontend

The web client for **Stox**, a paper-trading terminal for stocks and crypto.
Next.js 16 App Router, React 19, Tailwind CSS 4, plain JavaScript.

The API surface is defined by `../docs/PHASE1_API_HANDOVER.md`. Market data
needs a configured backend provider (Binance for crypto works without a key;
stock quotes need Finnhub configured on the backend).

## Run

```bash
cd frontend
npm install
cp .env.example .env.local   # already created for local development
npm run dev                  # http://localhost:3000
```

`.env.local` must point at the backend:

```bash
NEXT_PUBLIC_API_URL="http://localhost:8000/api/v1"
NEXT_PUBLIC_SOCKET_URL="http://localhost:8000"
```

Start the backend from `../backend` (and `npm run workers` if you want orders
to execute and realtime trading/notification events). Seed local demo users with
`npm run seed`; the demo password is `Password1!` and `trader1@stox.com` is the
regular trader account.

## Routes

| Route | Purpose |
| --- | --- |
| `/` | Marketing site with live crypto quotes |
| `/login`, `/register` | Email/password and Google auth |
| `/design` | Living design-system reference |
| `/dashboard` | KPIs, value chart, allocation, holdings, quick order, movers |
| `/markets`, `/markets/[symbol]` | Search, quotes, candles, sentiment, order ticket |
| `/portfolios`, `/portfolios/[portfolioId]` | Portfolio list, analytics, risk, heatmap, benchmark |
| `/orders`, `/trades` | Order lifecycle + audit trail, executed fills |
| `/alerts` | Price / percentage alerts |
| `/social`, `/u/[userId]` | Feed, likes, follows, public profiles |
| `/leaderboard` | Global/friends rankings and history |
| `/copy-trading` | Copy relationships and settings |
| `/leagues`, `/leagues/[leagueId]` | Competitions and league leaderboards |
| `/achievements` | Catalog and unlock history |
| `/notifications` | In-app notification inbox |
| `/settings` | Profile, channels, theme, session |
| `/admin` | Read-only users/portfolios/orders (ADMIN role only) |

Protected routes live in `app/(app)/` behind `AuthGuard`; auth routes live in
`app/(auth)/`.

## Architecture

- `lib/api.js` — fetch wrapper, bearer token, one transparent refresh, error
  envelope → `ApiError`.
- `lib/auth.js` — `stox_*` localStorage session, refresh lock, auth events.
- `lib/endpoints.js` — one function per mounted endpoint.
- `lib/hooks.js` — SWR data hooks, active portfolio, quote/socket merging.
- `store/` — Zustand session and UI state (theme, sidebar, portfolio).
- `components/ui/` — design-system primitives (Radix based).
- `components/charts/` — Recharts area/donut/line/bar, SVG sparkline, P&L
  heatmap, Lightweight Charts candles.
- `components/layout/` — app shell, sidebar, top bar, command palette.
- `design-system/stox/MASTER.md` — the design source of truth.

### Realtime

`components/realtime/realtime-bridge.jsx` connects to `/notifications` and
`/trading`, re-joins the active portfolio after reconnects, refreshes SWR caches,
and surfaces order/trade toasts. Market pages subscribe to `/market`; HTTP quotes
are the initial snapshot, then socket prices take over.

The backend applies a strict global API limiter outside local development
(default 100 requests / 15 minutes). `backend/.env` currently sets
`RATE_LIMIT_ENABLED=false` for local UI testing; re-enable it before shipping.
Hooks still use long refresh intervals, SWR deduplication and sockets, so the
app stays within the production budget.

## Visual system

- Dark-first with a fully tokenised light theme (`data-theme` on `<html>`).
- Geist for UI, Geist Mono for every number (`tnum`).
- Blue is the action accent; green/red are reserved for market direction/P&L.
- Shared tokens, easing and utilities live in `app/globals.css`.
- Docs: `design-system/stox/MASTER.md`. Live examples: `/design`.

## Checks

```bash
npm run lint
npm run build
```

There is no frontend test suite. UI verification is manual; see the checklist
in the handover notes or ask the user which route/viewport to verify.
