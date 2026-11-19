# Frontend audit — 58 task checklist

> **Uncommitted scratch audit.** Read-only review performed 2026-11-18 on `main` @
> `25eb78c`. No code was changed. Delete or fold into `docs/` before shipping.
>
> **Method:** five parallel deep reads of every page/component/lib file, plus
> `npm run lint`, `npm run build`, a full `lib/endpoints.js` → `backend/src/routes`
> mapping, and contract spot-checks against controllers/services.
>
> **Limits:** the frontend has **no test suite**, and per `AGENTS.md` UI verification
> is manual, so "DONE" means *implemented, wired to a real endpoint, and no defect
> found by reading the code* — not "verified in a browser".

## Score

| Verdict | Count | Share |
| --- | --- | --- |
| DONE | 37 | 64% |
| PARTIAL | 20 | 34% |
| MISSING | 1 | 2% |

Baseline health: `npm run lint` → 0 errors, 6 warnings (React Compiler skips
`react-hook-form` `watch()` in `order-ticket.jsx` and the two copy-trade dialogs).
`npm run build` → passes, 24 routes. Every frontend path in `lib/endpoints.js`
(77 call sites / 63 distinct paths) resolves to a mounted backend route; no orphans in
either direction.

## Done (37)

1. Frontend auth state — `store/use-session.js`, `lib/auth.js`, `components/providers.jsx`
2. Frontend API client — `lib/api.js` (timeout, abort, one 401 refresh, envelope unwrap, `ApiError`)
3. Registration page — `app/(auth)/register/page.js`, field-level `VALIDATION_ERROR` mapping
4. Login page — `app/(auth)/login/page.js` + `login-form.jsx`, open-redirect-safe `next`
6. Session persistence — cached user + background `/auth/me`, rotating refresh, logout revoke
8. Profile page — `app/(app)/u/[userId]/page.js` (public + `/u/me`); editing lives in Settings
9. Dashboard shell — `components/layout/app-shell.jsx`, sidebar/topbar/mobile nav, skip link
10. Holdings table — portfolio detail `:461-530`, dashboard top-5 `:398-472`
11. Portfolio page — list + detail with Overview/Analytics/Activity tabs
12. Portfolio summary cards — total value, cash, invested, P&L
15. Market-order form — `order-ticket.jsx`, MARKET default, estimate + warning
18. Order-history table — filters, pagination, events
19. Cancel-order interaction — confirm dialog, toast, SWR invalidation, PENDING-only
20. Advanced-order forms — LIMIT / STOP_LOSS / TAKE_PROFIT + expiry, validated
21. Socket.IO client layer — `lib/socket.js` singletons, ref-counted rooms, reconnect replay
27. Crypto market page — `/markets` crypto default view, movers, curated table
28. Symbol search UI — combobox, keyboard nav, debounced `/market/search`
29. Historical-price chart — candle/line, empty + error states, 4h supported
30. Asset detail page — quote, chart, stats, sentiment, alerts, trades, ticket, position
32. Market statistics panel — 24h high/low, open, prev close, volume
34. Analytics dashboard — portfolio Analytics tab
35. P&L analytics charts — heatmap, monthly bars, breakdown table
36. Risk-metrics visualizations — volatility/drawdown/Sharpe tiles
38. Benchmark comparison view — indexed line + alpha/beta/correlation (benchmark fixed to SPY)
39. Alerts page — list, counts, filters, create/edit/delete
40. Create-alert form — RHF + zod, condition/target/channels
43. Notification read-state UI — per-item + mark-all, unread badge
44. Create-post UI — composer with symbol tag + counter
45. Social feed page — feed, likes (optimistic), delete
46. Follow/unfollow UI — feed sidebar, leaderboard, public profile
47. Achievement page — all + mine
48. Leaderboard page — global/friends/history, podium, pagination
50. Sentiment voting UI — bullish/neutral/bearish, window switch (missing error state)
51. Copy-trading UI — create/edit/pause/resume/stop, filters
53. Responsive navigation — `lg` sidebar, mobile drawer, bottom bar with safe-area inset
54. Frontend API error handling — normalized `ApiError`, toasts + `Alert`, `error.js`
55. Reusable form components — `Field`/`Input`/`Textarea`/`Select`, 9 forms on RHF + zod

## Partial (20)

| # | Task | Why it is not done |
| --- | --- | --- |
| 5 | Protected-route handling | Client-only (`auth-guard.jsx`); no `middleware.js`. `/admin` role check lives in the page, `/design` is public |
| 7 | Settings page | `settings/page.js:297` ignores a failed `GET /preferences` → renders defaults, then overwrites server values; profile errors collapse to one root message |
| 13 | P&L display | Cost-basis fallback renders `0.00 · 0%` when a quote is missing instead of `—`; no day/period P&L |
| 14 | Order entry interface | Ticket never shows units owned; no portfolio selector inside; `defaultSymbol="BTCUSDT"` on `/orders` |
| 16 | Open-orders table | Only the `PENDING` tab; no row-level cancel; header says "updates every 30s", poll is 120s |
| 17 | Order validation UI | No client sell-max / insufficient-cash block (server rejects); `details[]` collapsed into one Alert |
| 22 | Live-price subscriptions | `useQuotes` swallows per-symbol errors → ErrorState unreachable; no `connect_error`/ack handling; slash symbols (`BTC/USDT`) never match; tables freeze if socket dies |
| 23 | Realtime portfolio updates | Bridge joins only the active portfolio room; list key `/portfolios` vs `/portfolios?` mismatch; payload discarded |
| 24 | Realtime order updates | Same single-room limit; no optimistic patch; EXECUTED depends on a separate `trade-executed` event |
| 25 | Market overview page | Crypto-only: `useMarketOverview("CRYPTO")` hardcoded, rail still says "Crypto trades 24/7" on the Stocks tab |
| 26 | Stock market page | No stock overview/movers; stocks are a filter on `/markets`, not a page |
| 31 | Live price chart | History-only, refetched every 180s; the socket tick updates the header price but never the series |
| 33 | Allocation chart | Weights computed over `allocation.slice(0,6)` (`dashboard/page.js:365`, `donut-chart.jsx:43-48`), so legend % ≠ portfolio %, no "Other" bucket |
| 37 | Trade-statistics view | 4 tiles only; `averageReturn`, `bestTrade`, `worstTrade`, `monthly[]` unused; `/statistics/monthly` has no consumer |
| 42 | Alert management UI | No pause/re-arm: `alert-dialog.jsx:82-88` never sends `status`, although `updateAlertSchema` accepts it |
| 49 | Competition/league page | `canJoin` true for ACTIVE leagues (server returns `LEAGUE_ALREADY_STARTED`); membership not persisted (409 on rejoin); `leagueController.list` returns `{data, pagination}` siblings so `apiFetch` drops pagination; no leave/edit; creator not auto-joined |
| 52 | Loading/error/empty states | ~90% coverage; dashboard/social/profile/achievements ignore secondary query errors and render false empty states |
| 56 | Accessibility pass | Basics in place (skip link, landmarks, `aria-label`, `scope="col"`, `role="img"` on charts, reduced-motion, 29 `focus-visible`), but no audit artifact; `/login` has no `<h1>` |
| 57 | Responsive pass | No evidence of a completed pass; needs manual verification at 360/768/1024/1440 |
| 58 | Phase 3 frontend/API integration review | No artifact exists. This audit covers it; see findings below |

## Missing (1)

| # | Task | Reality |
| --- | --- | --- |
| 41 | Notifications panel | `topbar.jsx:73-92` renders a bell **link** only. No dropdown/inbox; `/notifications` page exists |

## Integration findings (the review)

1. **Handover is stale.** `docs/PHASE1_API_HANDOVER.md:400` lists "portfolio performance and
   P&L heatmap", leagues, achievements and sentiment as unregistered; all are mounted
   (`portfolioRoutes.js:66-108`, `routes/index.js:31-38`). The doc is the stated source of
   truth, so it must be corrected before the next client work.
2. **Envelope inconsistency.** Most controllers wrap in `data`; `leagueController.list`
   spreads `{data, pagination}` at top level, so `apiFetch`'s `payload.data` drops
   pagination. Same shape risk for any controller using `{success:true, ...result}`.
3. **Dead API surface.** `usersApi` (whole object), `portfoliosApi.benchmark`,
   `socialApi.getPost/feed`, `achievementsApi`, `leaderboardApi`, `leaguesApi.*`,
   `sentimentApi.get`, `alertsApi.list`, `notificationsApi.list` are defined but pages
   call raw `useApi` paths instead.
4. **Doc/UI drift:** `/users/me/statistics/monthly` and `/portfolios/:id/benchmark` are
   documented and mounted but have zero UI consumers.

## Top fixes, in priority order

1. Notifications panel (#41) — the only missing deliverable.
2. League join/pagination/membership (#49) — user-visible errors and unreachable pages.
3. Realtime room scoping (#23/#24) — non-active portfolios never update.
4. `useQuotes` error propagation + socket failure signalling (#22).
5. Order ticket: position display, sell-max, cash guard (#14/#17).
6. Allocation percentages (#33) and P&L "—" fallback (#13).
7. Settings preferences error handling (#7).
8. Update the handover (#58).
