# Stox — running notes (uncommitted)

> **Scratch log.** Issues and gaps found while using the app by hand. This file is
> intentionally **not committed** — do not stage it, do not include it in a PR.
> Fold anything worth keeping into `docs/` proper (or delete) before shipping.
>
> - Branch: `feature/phase1-remaining-tasks`
> - Last updated: 2026-11-19
> - Environment: local Postgres.app (`:5432`, DB `stox`), Redis (`:6379`), API
>   (`:8000`), workers (`npm run workers`), Next.js (`:3000`)

---

## Open issues

> **Status (2026-11-19):** issues 1, 2, 4, 5 and 6 are fixed on `frontend-fixes`;
> issue 3 was already implemented. The Redis appendix remains a separate backend
> infrastructure follow-up and was not changed in this frontend batch.

### 1. The order ticket never shows how many units I already own — fixed

**Observed:** on `/markets/META` the order ticket shows Buy / Sell, the symbol, and
`$0.00 available` next to Quantity. Nothing tells me whether I already hold META, or
how much.

**Where the gap is:** `frontend/components/market/order-ticket.jsx` — the Quantity
field's `action` slot (`:284-292`) renders *either* available cash (BUY) or
`availableQuantity` (SELL). There is no "you own N units" row, no average cost, no
market value.

**Partially covered today:** `frontend/app/(app)/markets/[symbol]/page.js:552` renders
a **"Your position"** card with quantity, average buy price, invested, and P&L — but

- it sits *below* the ticket (off-screen at 1440×900 without scrolling), and
- it only renders when `holding` is truthy (`:570`); otherwise it falls through to an
  empty/CTA state.

**Missing entirely** on the two other call sites, because neither passes the prop:

- `frontend/app/(app)/dashboard/page.js:482` — dashboard quick-trade ticket
- `frontend/app/(app)/orders/page.js:741` — "New order" dialog

**Fix sketch:** give `OrderTicket` its own holding lookup (or `useHoldings(portfolioId)`
from the parent) and render a compact "Position" line under Symbol: quantity, average
cost, current market value. Show an explicit "No open position" state so the absence of
a holding is visible rather than implied.

---

### 2. No "Sell Max" — but "Buy Max" works — fixed

**Observed:** the 100% button is labelled **Max** and fills the order from available
cash on BUY. Switching to SELL makes the whole 25/50/75/100 row disappear and replaces
it with the text "Sell quantity is limited to your open position. Enter the amount to
close or reduce."

**Root cause:** `frontend/components/market/order-ticket.jsx:309`:

```jsx
{side === "BUY" || availableQuantity ? ( ...quick allocations... ) : ( ...explanatory text... )}
```

`availableQuantity` is only ever supplied by `app/(app)/markets/[symbol]/page.js:548`:

```jsx
availableQuantity={holding ? Number(holding.quantity) : undefined}
```

Dashboard and the orders dialog never pass it, so on those surfaces SELL can never offer
Max. On the symbol page it works *only* if a holding row already exists.

**Secondary bug in the same code path:** `fillAllocation` (`:109-125`) guards with
`if (side === "SELL" && availableQuantity)`. When `availableQuantity` is `0` or
`undefined`, a SELL falls through to the cash-based branch and computes
`availableCash / price` — a meaningless quantity derived from cash for a sell order.

**The server already enforces the real limit** — `backend/src/services/orderService.js:591-609`
loads `Holding.quantity` and rejects with `SHORT_SELLING_DISALLOWED`
("Short selling is not permitted in league portfolios. Insufficient shares held.").
So this is purely a UI affordance problem, not a correctness hole.

**Fix sketch:**

1. Load holdings inside the ticket (or pass from all three call sites).
2. Render `Max` for SELL using the held quantity, and keep `<n>%` as fractions of it.
3. Guard `fillAllocation` explicitly when the holding is 0 / absent (disable the row
   instead of falling through to cash math).
4. Check pending SELL orders / reserved quantity so Max doesn't overshoot what is
   still free to sell.

---

### 3. Yahoo Finance is a first-class stock-history fallback (implemented)

Yahoo started as an inline fallback inside the Finnhub adapter. It is now a
registered provider so the provider layer is consistent and extensible:

| File | Role |
| --- | --- |
| `backend/src/providers/yahooMarketDataProvider.js` | Adapter: `operations:["history"]`, `markets:["*"]`, symbol pass-through |
| `backend/src/providers/yahooHistoricalPrices.js` | Mapping, 4h aggregation, HTTP call, error mapping |
| `backend/src/providers/createMarketDataProviders.js` | Single registry: adding a provider is one entry |
| `backend/src/services/marketDataService.js` | Ordered-chain selection and fallback |
| `backend/src/providers/marketRouting.js` | Exchange-suffix → region metadata |

**Why it exists:** Finnhub's free plan authorises `/quote` but returns
`403 {"error":"You don't have access to this resource."}` for `/stock/candle`.
`mapProviderError` maps that 403 to `MARKET_DATA_INVALID_CREDENTIALS`, the
service treats it as a provider-side failure, and the default stock chain
(`finnhub,yahoo`) tries Yahoo next. A paid Finnhub key never reaches Yahoo.

**Configuration:** `MARKET_DATA_STOCK_PROVIDERS=finnhub,yahoo` (ordered chain)
and `YAHOO_FINANCE_API_URL=https://query1.finance.yahoo.com`. The legacy
`MARKET_DATA_STOCK_PROVIDER` still sets the primary and keeps the documented
fallback.

**Verified by hand 2026-11-18:** Finnhub candles 403; `GET
/api/v1/market/history/META?interval=4h&…` returns 200 with aggregated candles
whose last close matched the live quote. Unit coverage now lives in
`tests/unit/providers/yahooMarketDataProvider.test.js`,
`tests/unit/providers/marketRouting.test.js`, and
`tests/unit/services/marketDataFallback.test.js`.

**Traps worth keeping:**

- Yahoo returns **HTTP 400** (not 404) for ranges before the symbol's first trade
  date or for an interval/range combination it refuses — e.g. `1m` over months,
  or a range in 1970. That surfaces to the client as `503
  MARKET_DATA_PROVIDER_UNAVAILABLE` because only 404 maps to not-found.
- The API's `from`/`to` are **epoch milliseconds**; passing seconds silently
  produces a 1970 window and the 400 above.
- Yahoo is unofficial and undocumented: no key, no SLA, no ToS guarantee for
  programmatic use, and it rate-limits aggressively (429). A 429 is not retried
  against the same provider.
- Yahoo has no native 4h interval; 1h candles are aggregated into UTC 4h
  buckets.
- A browser-like `User-Agent` is required; requests without one are rejected.
- International symbols use exchange suffixes (`VOD.L`, `7203.T`,
  `RELIANCE.NS`). The router infers the region and skips US-only Finnhub.

**Docs updated:** `docs/MARKET_DATA.md` (three providers, Yahoo section,
chain/fallback section), `docs/MARKET_DATA_SERVICE.md` (adapter contract,
routing, config), `docs/API.md` (chain/fallback notes), `backend/.env.example`.

---

### 4. Popups jump: they open slightly up-left, then snap to center — fixed

**Reported (2026-11-18):** "every popup spawn slightly shifted top left and then comes
at the center, very bad experience weird animation or something."

**Affected elements and their animations:**

| Component | Animation | Declared at |
| --- | --- | --- |
| `DialogContent` | `dialog-in 220ms` | `frontend/components/ui/dialog.jsx:33` |
| Dropdown menu | `menu-in 160ms` | `frontend/components/ui/dropdown.jsx:19` |
| Select content | `menu-in 160ms` | `frontend/components/ui/select.jsx:37` |
| Tooltip | `fade-in 125ms` | `frontend/components/ui/tooltip.jsx:18` |
| Overlay / mobile sidebar | `stox-fade` / `fade-in` | `dialog.jsx:28`, `layout/topbar.jsx:206` |

**Keyframes:** `frontend/app/globals.css:488-515`

```css
@keyframes dialog-in {
  from { opacity: 0; transform: translate(-50%, -48%) scale(0.96); }
  to   { opacity: 1; transform: translate(-50%, -50%) scale(1); }
}

@keyframes menu-in {
  from { opacity: 0; transform: scale(0.97) translateY(-2px); }
  to   { opacity: 1; transform: scale(1) translateY(0); }
}
```

**Suspected cause:** the keyframes animate `transform`, but positioning of these
elements also depends on `transform`/`translate`:

- `DialogContent` is centered with `left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2`
  (`dialog.jsx:30-33`). Tailwind v4 emits translate utilities as the standalone
  `translate` property, while the keyframes write `transform` — so both compose during
  the animation instead of replacing each other, and the element starts offset up-left
  by roughly half its own size before the animation settles.
- Dropdown/Select/Tooltip are Radix Popper-positioned, which writes an inline
  `transform: translate3d(…)` on the same element. The animation overrides it for
  160 ms, so the panel first paints at the wrong origin and then jumps when Popper's
  transform takes over.

Either way, "position owned by a transform" is being animated by a transform, so the
element moves twice for the first ~200 ms.

**Applied fix (2026-11-19):** verified by code inspection; browser confirmation is
still recommended. In DevTools, compare computed `transform` vs `translate` while
the popup opens.

The implementation keeps `transform` exclusively for
positioning. Animate only `opacity` + `scale` (Tailwind v4 `scale` is also a standalone
property, so it composes safely), e.g. `dialog-in` becomes `opacity 0→1` and
`scale .96→1` without any `translate(...)`. Popper panels keep their inline
positioning `transform`; their scale animation runs on the same element and uses the
Radix `--radix-*-content-transform-origin` variable for the correct anchor.

---

### 5. Quantity-first trading: holdings are invisible outside portfolio pages, and sells size from cash — fixed

**Reported (2026-11-18):** "all stocks or crypto should also show remaining quantity and
a sell feature by quantity and not money. the app is more targetted towards daytrading
like experience."

This is the same root cause as issues 1 and 2, but the scope is wider than the order
ticket: it applies to **every surface that shows a symbol**. The product direction is a
day-trading experience, where the loop is "see what I hold → exit by units", so cash-
denominated sizing for a sell is the wrong mental model.

**Where quantity is visible today:**

| Surface | Shows held quantity? | Evidence |
| --- | --- | --- |
| `/portfolios` (cards) | Only a positions *count* | `portfolios/page.js:144-175` |
| `/portfolios/{id}` Overview | Yes — Holdings table | `[portfolioId]/page.js:450-530` |
| `/dashboard` Holdings card | Yes — top 5 | `dashboard/page.js:398-472` |
| `/markets` table | **No** — columns are Asset, Price, 24h, 24h high, 24h low, action | `markets/page.js:285-347` |
| `/markets/{symbol}` header | **No** — symbol, name, badges, price only | `[symbol]/page.js:186-210` |
| `/markets/{symbol}` "Your position" card | Yes, but below the ticket and only when a holding exists | `[symbol]/page.js:555-600` |
| Order ticket (symbol page) | Only an "N available" label next to Quantity | `order-ticket.jsx:284-292` |
| Order ticket (dashboard / orders dialog) | **No** — `availableQuantity` never passed | `dashboard/page.js:482`, `orders/page.js:741` |

**How sells are sized today:** `fillAllocation` in `order-ticket.jsx:109-125` only uses
the position when `side === "SELL" && availableQuantity`. Otherwise it falls through to
the cash branch and computes `availableCash * pct / price` — i.e. it derives a **sell**
quantity from **cash**, which is meaningless. The 25/50/75/100 row is also hidden for
SELL when no position prop is present (`:309`), so on `/dashboard` and the orders dialog
a sell cannot be sized at all.

**Expected behaviour (acceptance criteria):**

1. Every symbol surface shows remaining quantity and average cost, with an explicit
   "No position" state instead of hiding the row:
   - `/markets` table → a "Position" column (qty + avg, or "—").
   - `/markets/{symbol}` header → held qty inline next to the price, not only in a card
     below the fold.
   - Order ticket (all three call sites) → a "You own N @ avg" line.
2. **Sell is quantity-first.** `Max` fills the exact held quantity; `25/50/75/100%` are
   fractions *of the position*; the control is disabled at 0. No sell quantity may ever
   be derived from cash.
3. **Buy stays cash-first but shows both sides:** cash-based Max plus the implied units,
   and a live "estimated proceeds" for sells. Estimated value should always render in
   both units and currency.
4. Server enforcement stays as-is: `orderService.js:591-609` already rejects
   over-selling with `SHORT_SELLING_DISALLOWED`. This is purely the client affordance.
5. Pending SELL orders / reserved quantity should be netted so `Max` cannot overshoot
   what is still free to sell.

**Implementation sketch:** one cached holdings source (`GET /portfolios/{id}/holdings`,
already 120 s SWR in `useHoldings`) surfaced through a `useHolding(portfolioId, symbol)`
selector, consumed by the markets table, the asset header and all three `OrderTicket`
mounts. Then replace the `fillAllocation` cash fallback with an explicit
`positionQuantity <= 0 → disable` branch.

---

### 6. Chart interval buttons show ranges far longer than their labels — fixed

**Reported (2026-11-18):** "for the chart which shows candles and lines, the 4w chart option
shows 2 year chart; 1 day chart option shows 1 year chart and so on for other options for
4h, 1h, 15m, 5m."

**Where:** `frontend/app/(app)/markets/[symbol]/page.js:103-121` (window + request) and
`frontend/lib/constants.js:87-94` (`CHART_INTERVALS`).

**What actually happens:** the buttons are labelled by candle **interval**, but each one
also silently fixes a visible **range** via its `duration`, and the request asks for
`limit: 800` candles inside that range:

```js
const intervalConfig = CHART_INTERVALS.find((item) => item.value === interval) …;
const to = Date.now();
const from = to - intervalConfig.duration;      // hidden range
return marketApi.history(rawSymbol, { interval, from, to, limit: 800, assetClass });
```

| Button label | Interval sent | Range actually requested | ≈ candles (limit 800) |
| --- | --- | --- | --- |
| 5m | `5m` | 12 hours | 144 |
| 15m | `15m` | 3 days | 288 |
| 1h | `1h` | 14 days | 336 |
| 4h | `4h` | 60 days | 360 |
| 1D | `1d` | **365 days** | 365 |
| 1W | `1w` | **1095 days (3 years)** | ~156 |

So "1D" draws a one-year chart and "1W" (reported as "4w") draws roughly a
two-to-three-year chart. The other four are equally off-label: "5m" shows 12 hours,
"1h" shows a fortnight, "4h" shows two months.

**Root cause:** one segmented control is doing two jobs. The label names the candle
resolution, the consumer reads it as a time range, and the real range is an arbitrary
mapping in `duration` that appears nowhere in the UI. `limit: 800` is never the binding
constraint for `1d`/`1w` — `duration` is.

**Fix direction (decide before coding):**

1. **Preferred:** split into two controls — interval (5m/15m/1h/4h/1D/1W) × range
   (1D/1W/1M/3M/1Y/3Y), defaulting to a sensible pair per asset class. This keeps the
   backend contract (`from`, `to`, `interval`, `limit`) unchanged and removes the
   ambiguity.
2. **Minimal:** keep one control but relabel the buttons to the real window
   (12H, 3D, 14D, 60D, 1Y, 3Y) and store both interval and duration together.
3. **Not enough:** just shrinking `duration` — the labels would still not describe the
   range, and "1W" with a 7-day window would only draw one candle at `1w` resolution.

Constraints to respect: backend `isValidHistoricalRange` requires
`to - from <= intervalMillis * limit` and caps `limit` at 1000
(`backend/src/utils/historicalRange.js:7-37`); stock candles come from the Yahoo fallback,
which rejects unsupported range/interval combinations with `400 → 503
MARKET_DATA_PROVIDER_UNAVAILABLE` (see issue 3).

Fixed — interval and range are now independent; see the fix batch below.

---

## Fix batch — 2026-11-19 (frontend)

- **Position model:** new `usePosition(portfolioId, symbol)` hook in `lib/hooks.js`
  joins `/portfolios/:id/holdings` with pending `SELL` orders. Symbol matching is
  provider-independent through `canonicalMarketSymbol()` in `lib/utils.js`, so
  legacy `BINANCE:BTCUSDT` holdings and canonical `BTCUSDT` routes compare equal.
- **Order ticket:** shows quantity, average cost, live value and P&L; exposes
  `No open position`, `Checking position…` and `Position unavailable` states;
  sell `Max`/percentages are fractions of the free (unreserved) position; BUY
  stays cash-first and shows the implied units for Max; estimated cost/proceeds
  render in both units and currency; sells can never be sized from cash.
- **Markets table:** `Position` column shows held quantity and average cost, or
  `—` when there is no position.
- **Asset header:** inline “You own N @ avg” chip with pending-sell count.
- **Chart:** one timeframe control (`1D / 1W / 1M / 3M / 1Y / 3Y`). Each
  timeframe owns a readable candle interval and request limit
  (`CHART_TIMEFRAMES`, `chartRequestWindow`), so the label is the real visible
  window and every request stays within the 1,000-candle backend cap. The chart
  fits the returned series and draws a live “Current” price line, with the quote
  included in the auto-scaled y-domain.
- **Popups:** `dialog-in` / `menu-in` now animate only `opacity` and the
  individual `scale` property, never `transform`. Positioning `translate` and
  Radix Popper `transform` are left untouched, with `transform-origin` taken from
  Radix variables for dropdowns/selects.
- **Verification:** `npm run lint` → 0 errors (6 pre-existing React Compiler
  warnings); `npm run build` passes all 21 routes. Browser verification remains
  manual per `AGENTS.md`.

## Implemented but uncommitted (2026-11-18)

> Code is in the working tree; **nothing is staged or committed**. Listed here so the
> next agent does not treat these as missing — `docs/FRONTEND_AUDIT.md` was written
> before them.

### Portfolio deactivate → reactivate

Deactivation was a one-way door: the API deliberately refused lifecycle updates and the
UI kept offering "Deactivate" on already-inactive portfolios.

- **Backend** — new `POST /api/v1/portfolios/:portfolioId/reactivate`
  - `src/services/portfolioService.js` → `reactivatePortfolio()`: owner-scoped lookup,
    `isActive: true`, invalidates portfolio + portfolio-analytics + user-analytics caches,
    idempotent when already active.
  - `src/controllers/portfolioController.js` → `reactivatePortfolio`, standard
    `{ data: { portfolio } }` envelope.
  - `src/routes/portfolioRoutes.js` → `authMiddleware` + UUID validation, mounted
    alongside `DELETE /:portfolioId`.
  - `docs/PHASE1_API_HANDOVER.md` → documented the new contract under **Portfolios**
    (the handover is the API authority, so it had to be updated with the route).
  - Tests written first: 3 unit cases in `tests/unit/services/portfolioService.test.js`,
    4 integration cases in `tests/integration/portfolio.integration.test.js`
    (round trip, idempotency, cross-user 404, unauthenticated 401).
- **Frontend**
  - `lib/endpoints.js` → `portfoliosApi.reactivate`.
  - `lib/hooks.js` → `useReactivatePortfolio()` (`{ reactivate, pendingId }`): POST,
    success/error toast, revalidates every `/portfolios*` SWR key.
  - `app/(app)/portfolios/page.js` → card menu shows **Reactivate** when inactive,
    **Deactivate** when active.
  - `app/(app)/portfolios/[portfolioId]/page.js` → Reactivate button replaces Deactivate
    for inactive portfolios, warning banner, "New order" disabled.
  - `components/market/order-ticket.jsx` → inactive portfolio shows a banner, blocks
    submit in `onSubmit`, and disables the submit button (the API already rejected these
    orders with `PORTFOLIO_INACTIVE`; the UI no longer pretends otherwise).
- **Verified:** backend unit 79 suites / 978 tests, `portfolio.integration` 19/19,
  frontend lint 0 errors (6 pre-existing warnings), `npm run build` passes.

### Portfolio navigation

- `lib/navigation.js` → sidebar/bottom-bar entry renamed **"Portfolios" → "Portfolio"**
  and flagged `portfolioScoped`, resolved by `resolveNavHref(item, portfolioId)` to the
  active portfolio's detail page (falls back to `/portfolios` when none exists).
- `components/layout/sidebar.jsx`, `components/layout/mobile-nav.jsx` → consume the
  active portfolio id so the entry always opens the portfolio shown in the switcher.
- `components/layout/portfolio-switcher.jsx` → selecting a portfolio while on
  `/portfolios/:id` calls `router.replace('/portfolios/<newId>')`, so the page follows
  the switcher instead of staying on the old portfolio. `replace` (not `push`) keeps
  repeated switches out of the back stack.
- **Known trade-off:** switching resets the detail page's `tab`/`period` local state to
  Overview/1M, because they are not URL state. Move them to search params if tab
  persistence across switches is wanted.

---

## Appendix — Redis usage review (2026-11-18)

Full audit done while debugging; the short version, kept here so it isn't lost.

**Correct:** separate BullMQ connection with `maxRetriesPerRequest: null`
(`src/queues/connection.js`); dedicated pub/sub subscriber via `duplicate()` with
reconnect-aware resubscribe (`src/realtime/redisBus.js`); every cache op wrapped in
`safe()` so Redis loss degrades to no-cache instead of failing requests.

**Waste / gaps:**

1. Dead cache API: `cacheService.getHistoricalPrices`/`setHistoricalPrices` are never
   called (history is uncached); `cacheKeys.symbol`, `cacheKeys.session`,
   `cacheKeys.leaderboard` and their `CACHE_TTL_*` vars are unused; `getMetrics()` is
   only referenced by tests.
2. Cache hit/miss counters cost two extra round trips per read and are never exposed
   (`cacheService.js:45-58`).
3. `cacheKeys.historicalPrices` includes exact `from`/`to`/`limit`, so keys never repeat
   between chart loads — the TTL is meaningless by construction.
4. Rate limiting is `express-rate-limit`'s in-memory MemoryStore
   (`src/middleware/rateLimiter.js`) — per-process, cleared on restart.
5. `getOrSet` has no stampede protection (cold key ⇒ every concurrent request calls the
   loader).
6. Cache prefix is a hardcoded `stox:v1`; queues get `QUEUE_PREFIX` but the cache has no
   environment namespace.
7. `invalidateMarketSearch` is exported and tested but never called from `src`, so search
   results can be stale for up to 1 h.
