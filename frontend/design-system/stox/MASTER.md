# Stox Design System — "Terminal Calm"

**Version:** 1.0 · **Scope:** web app, marketing site, admin
**Stack:** Next.js 16 · React 19 · Tailwind CSS 4 · Radix primitives · Recharts · Lightweight Charts
**Theme:** dark-first, with a fully tokenised light theme

> Stox is a paper-trading terminal. The interface must feel like a professional
> trading desk: dense with information, quiet in presentation, fast under the
> hand, and legible for hours. Confidence comes from precision — tabular
> numbers, honest states, and no decoration that competes with the data.

---

## 1. Brand

| Item | Value |
| --- | --- |
| Product name | Stox |
| Descriptor | Paper trading, real markets |
| Mark | Three ascending rounded columns (stacked volume bars) in a soft square |
| Voice | Direct, calm, specific. Never hype. No exclamation marks in product UI. |
| Personality | Precise · Composed · Insightful · Fast |
| Primary brand | Electric indigo-blue `#5B8CFF` (action, focus, brand) |
| Data semantics | Emerald `#2BD98A` up/buy · Rose `#FF5C73` down/sell · Amber `#F5B84B` pending |

The brand accent is deliberately **blue**, not green. Green and red belong to
market direction and P&L. A green CTA next to a green gain is ambiguous; blue is
never mistaken for a price signal.

### Logo lockup
- Mark 24–28 px, then wordmark `stox` in Geist 600, tracking `-0.045em`,
  baseline aligned, with a period in brand colour (`stox.`).
- Minimum clear space: height of the mark on all sides.
- Never place the wordmark on a photograph without a scrim.

---

## 2. Principles

1. **Data first, chrome second.** Surfaces are quiet; the numbers, charts and
   states carry the hierarchy. No gradients behind text.
2. **One accent per view.** Blue marks what you can act on. Everything else is
   neutral or semantic.
3. **Numbers are typographic objects.** Always tabular, right-aligned in tables,
   fixed decimal places per context, and signed when direction matters.
4. **Show the state, not the spinner.** Prefer skeletons with the final layout
   over centred spinners. Every list has a real empty state.
5. **Fast is a feeling.** Press feedback in 120 ms, popovers in 160 ms, sheets
   in 260 ms. No animation on keyboard-repeat actions.
6. **Density with air.** A trading screen can be dense, but the grid, rhythm and
   alignment must stay calm. Default row height 44 px; compact 36 px.
7. **Never colour alone.** Direction is carried by sign, arrow, and label as
   well as colour.
8. **The market never stops; the UI must recover.** Every async surface has
   loading, empty, error and stale states.

---

## 3. Colour tokens

All colours are semantic tokens implemented in `app/globals.css`. Components
must never use a raw hex value.

### Core — dark (default)

| Token | Value | Use |
| --- | --- | --- |
| `--canvas` | `#07090E` | App background |
| `--canvas-deep` | `#04060A` | Landing hero / void |
| `--surface` | `#0C1018` | Cards, panels |
| `--surface-2` | `#111624` | Inputs, nested rows |
| `--surface-3` | `#161D2D` | Hover, selected rows |
| `--line` | `rgba(255,255,255,0.075)` | Default border |
| `--line-strong` | `rgba(255,255,255,0.14)` | Focused / emphasized border |
| `--fg` | `#E9EEF7` | Primary text |
| `--fg-muted` | `#96A2B8` | Secondary text |
| `--fg-subtle` | `#657088` | Tertiary / labels |
| `--brand` | `#6C97FF` | Primary action, active nav |
| `--brand-strong` | `#4D7DFF` | Hover / pressed |
| `--brand-ink` | `#071022` | Text on brand |
| `--brand-soft` | `rgba(108,151,255,0.12)` | Selected nav, tinted panels |
| `--up` | `#2BD98A` | Gains, buy, positive |
| `--up-soft` | `rgba(43,217,138,0.12)` | Positive tint |
| `--down` | `#FF5C73` | Losses, sell, negative |
| `--down-soft` | `rgba(255,92,115,0.12)` | Negative tint |
| `--warn` | `#F5B84B` | Pending, caution |
| `--warn-soft` | `rgba(245,184,75,0.12)` | Pending tint |
| `--info` | `#56C8F5` | Informational |
| `--violet` | `#A78BFA` | Social, secondary data series |
| `--cyan` | `#5EEAD4` | Secondary data series |
| `--pink` | `#F472B6` | Secondary data series |

### Core — light

Light is a token swap only, never a component fork. Canvas `#F4F6FB`, surface
`#FFFFFF`, surface-2 `#EEF2F8`, line `rgba(13,23,42,0.09)`, fg `#0B1220`,
muted `#57627A`, brand `#315CFF`, up `#079455`, down `#D92D48`.

### Chart series order
`brand → cyan → violet → amber → pink → neutral`. Green/red are *reserved* for
P&L and direction, and are not used in categorical series except for
gain/loss visualisations (P&L heatmap, allocation by performance).

### Contrast contract
- Body text on surface ≥ 7:1; muted text ≥ 4.5:1; 12 px text never below 4.5:1.
- Focus ring: 2 px brand ring + 2 px offset. Never remove outlines without a
  replacement.
- Tints are backgrounds only; never use a soft token as text colour.

---

## 4. Typography

| Role | Family | Size / line | Weight | Tracking |
| --- | --- | --- | --- | --- |
| Display / hero | Geist | `clamp(2.75rem, 6vw, 5rem)` / 0.96 | 600 | `-0.045em` |
| Page title | Geist | 28 px / 1.15 | 600 | `-0.03em` |
| Section title | Geist | 18 px / 1.3 | 600 | `-0.02em` |
| Card title | Geist | 14 px / 1.4 | 550 | `-0.01em` |
| Body | Geist | 14 px / 1.55 | 400 | 0 |
| Small | Geist | 12.5 px / 1.5 | 400 | 0 |
| Micro / label | Geist | 11 px / 1.3 | 500 | `0.08em` uppercase |
| Number / price | Geist Mono | 13–32 px | 450–600 | `-0.02em`, tabular |
| Hero number | Geist Mono | 32–44 px | 550 | `-0.03em`, tabular |

Rules:
- Base UI size is 14 px; never body text below 12 px.
- Numerals always use `.tnum` (`font-variant-numeric: tabular-nums`).
- Currency and percent keep a fixed 2 decimals for fiat, up to 8 significant
  decimals for crypto quantities. Trim trailing zeros in quantities only.
- Use `Intl.NumberFormat`; never concatenate `$` manually.
- Headings balance (`text-wrap: balance`), paragraphs pretty (`text-wrap:
  pretty`).
- Tabular figures are mandatory in tables, KPI blocks, order tickets and charts.

---

## 5. Space, radius, elevation

**Spacing scale** (4 px base): 4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80, 96.

**Radius:** `6` chips/inputs-inside · `8` buttons/inputs · `12` cards ·
`16` large panels/modals · `20` hero containers · `999` pills.

**Elevation:** borders do the work. Shadows are only for floating layers:
- popover: `0 12px 32px rgba(0,0,0,.35), 0 2px 8px rgba(0,0,0,.2)`
- modal/sheet: `0 32px 80px rgba(0,0,0,.5)`
- light theme uses softer, lower-opacity equivalents.

**Layout:**
- App shell: sidebar 248 px (72 px collapsed), top bar 60 px, content gutter
  20/24/32 px, max content 1600 px.
- Dashboard grid: 12 columns, 20 px gap; KPI row 4-up → 2-up → 1-up.
- Tables: 44 px rows, 36 px compact; first column left, numeric right.
- Reading measure: 68ch maximum for prose.

---

## 6. Motion

| Token | Value |
| --- | --- |
| `--ease-out` | `cubic-bezier(0.23, 1, 0.32, 1)` |
| `--ease-in-out` | `cubic-bezier(0.77, 0, 0.175, 1)` |
| `--ease-drawer` | `cubic-bezier(0.32, 0.72, 0, 1)` |
| `--dur-press` | `120ms` |
| `--dur-fast` | `160ms` |
| `--dur-base` | `220ms` |
| `--dur-sheet` | `320ms` |

Rules:
- Press: `scale(0.97)` on pointer-down for buttons and rows.
- Popovers scale from the trigger (`transform-origin: var(--radix-popover-content-transform-origin)`).
- Modals scale from `0.96` + fade; never from `0`.
- Page content entrance: 8 px rise + fade, 240 ms, stagger 40 ms, max 6 items.
- Ticker marquee is the only continuous motion; pause on hover/focus and
  disable entirely under reduced motion.
- No animation on keyboard shortcuts, command palette, or table sorting.
- `prefers-reduced-motion`: keep fades, remove translation, scale and marquee.

---

## 7. Iconography

- Lucide React, 1.6–1.8 px stroke, 16 px in dense UI, 18–20 px in nav/headers.
- Icons always paired with a label except universal controls (close, search,
  more, chevron) which require `aria-label` and a tooltip.
- Opinions: `ArrowUpRight` gains, `ArrowDownRight` losses, `TrendingUp`
  markets, `Wallet` portfolio, `ListOrdered` orders, `History` trades,
  `Bell` alerts, `Users` social, `Trophy` leaderboard, `Copy` copy trading.
- Directional arrows: up-right for positive, down-right for negative. Never
  rely on colour to distinguish.

---

## 8. Components

### 8.1 Button
Variants: `primary` (brand fill), `secondary` (surface + border), `ghost`,
`danger` (rose tint/fill), `success`, `link`.
Sizes: `sm` 32 px · `md` 38 px · `lg` 44 px · `icon` 36×36.
States: hover (+4% luminance), active scale 0.97, focus ring, disabled 45%
opacity, loading (spinner + preserve label width). Full-width option.
Never animate width. Icon + label gap 8 px.

### 8.2 Input / Textarea / Select
38 px height (sm 32, lg 44). Label above, optional hint below, error replaces
hint and adds a 2 px rose border + `aria-invalid`. Prefix/suffix slots for
`$`, `%`, search and visibility. No placeholder-only labels. Number inputs use
`inputMode="decimal"`, select-all on focus, and a mono face.

### 8.3 Card / Surface
`rounded-xl border border-line bg-surface`. Header (title + action) 16 px
padding, body 16/20 px, footer separated by a border. Interactive cards lift
border to `line-strong` and add a 1 px inner highlight — never a large shadow.
Stat cards include a label, value, delta and optional sparkline.

### 8.4 Tabs / Segmented control
Radix Tabs. Underline tab for page sections; pill segmented control for dense
filters (1D/1W/1M). Active = brand text + 2 px underline or brand-soft fill.
Keyboard arrows navigate. No sliding colour animation on rapid changes; use a
150 ms background transition.

### 8.5 Table / Data table
Sticky header, 11 px uppercase labels, 44 px rows, zebra-free, hover row
`surface-2`, selected row `brand-soft` + left 2 px brand bar. Numeric columns
right-aligned tabular. Sortable headers show direction. Mobile: transform to
stacked cards with the primary value in the top-right. Empty and loading states
occupy the table body, not a separate modal.

### 8.6 Badge / Status
Pill 22 px tall, 11 px uppercase, dot optional.
`neutral`, `brand`, `up`, `down`, `warn`, `info`.
Order status mapping: PENDING→warn, EXECUTED→up, CANCELLED→neutral,
EXPIRED→neutral, REJECTED→down. Alert status: ACTIVE→brand, TRIGGERED→warn,
EXPIRED→neutral, CANCELLED→neutral.

### 8.7 Dialog / Sheet
Radix Dialog. Centred modal max 560 px, 16 px radius, overlay
`rgba(4,6,10,.72)` + 4 px backdrop blur. Title 18 px, description muted.
Footer actions right-aligned, primary last. Mobile uses a bottom sheet at
`92dvh` max, drag handle, safe-area padding, `ease-drawer`.
Focus trap and scroll lock are mandatory; Escape closes.

### 8.8 Menu / Popover / Tooltip
Radix. 8 px radius, surface, 1 px border, 6 px padding, 13 px items, 32 px row.
Tooltip 4 px radius, 12 px, dark inverse surface, 400 ms open delay, 0 ms once
one is open. Never put essential information only in a tooltip.

### 8.9 Toast
Sonner, bottom-right desktop / top-centre mobile, 4 px radius, surface with a
coloured left rail, title + optional description + action. Success 4 s, error
persistent until dismissed, promise toast for order submission. Pause on hover
and when the tab is hidden.

### 8.10 Stat / KPI
Label (micro), value (mono 28 px), delta (signed, arrow + colour), context
line. Loading uses a skeleton of identical height. Optional 28 px sparkline
with no axes.

### 8.11 Chart
Cartesian charts use no vertical grid except a faint 4-line scale. Axis labels
11 px muted mono; tooltip uses surface/popover styling with a 1 px crosshair.
Area fills are 12–18% opacity gradients. Candles: up `--up`, down `--down`,
wick 1 px, body min 2 px. Never use dual axes. Provide a summary sentence for
screen readers (`aria-label`) and a table fallback in the DOM when practical.

### 8.12 Empty / Error / Loading
- Empty: 40 px line icon in a 48 px tinted square, one sentence, one action.
- Error: show the API error code in mono small caps, a human message, retry.
- Loading: skeletons shaped like the final content; no layout shift.
- Stale: a small `Cached · 34s ago` line in muted text, with refresh.

### 8.13 Order ticket
Side segmented control (Buy emerald / Sell rose), type select, symbol combobox,
quantity with quick % chips (25/50/75/Max), price field for limit/stop,
estimated cost, available cash, fee note, submit. Inline validation on blur and
submit; server error in an alert above the footer. Confirmation toast links to
the order detail. Keyboard: Enter submits, Escape closes.

---

## 9. Page templates

### Marketing
Sticky translucent nav → hero (eyebrow, display headline, subcopy, dual CTA,
live market ticker) → trust metric strip → product preview → feature grid →
how it works → leaderboard/social proof → final CTA → footer. Max width 1200,
hero gutter 24. Background grid fades at 55% height.

### Auth
Split layout: left brand panel with live ticker and a single proof point
(hidden < 1024 px), right 400 px form column. Inline validation, show/hide
password, Google button, legal line. Redirect to `next` or `/dashboard`.

### App
Sidebar (logo, portfolio switcher, primary nav, secondary nav, user card) +
top bar (breadcrumb/search, market status, notifications, theme, avatar).
Mobile: top bar + 5-item bottom nav + sheet for the rest.
Page header: eyebrow, title, description, primary action.
Dashboard: KPI row (4) → chart + allocation (2:1) → holdings + market movers →
recent orders + activity.

---

## 10. Content & states

- Sentence case for all UI text. No "Please".
- Buttons are verbs: "Place buy order", "Cancel order", "Save changes".
- Money: `$12,480.50`; compact `$12.4K` only in tight KPI contexts.
- Percent: `+2.41%`; crypto: `+0.82%`. Sign always shown for changes.
- Dates: `Nov 18, 2026`, `14:32 UTC` in tables; relative `2m ago` in activity.
- Errors: what happened + what to do. Quote code in mono.
- Never claim real money. Persistent microcopy: "Virtual funds. Real market
  data."
- Destructive actions name the object: "Cancel AAPL limit order?".

---

## 11. Accessibility

- WCAG 2.2 AA. Keyboard reachable; visible 2 px focus ring.
- Landmarks: `header`, `nav`, `main`; one `h1` per page.
- Tables have `<caption class="sr-only">`, `scope` on headers.
- Live regions: `aria-live="polite"` for order status and toasts; `assertive`
  for errors.
- Charts expose a text summary and data table alternative.
- Motion respects `prefers-reduced-motion`; hover effects are behind
  `@media (hover: hover)`.
- Touch targets ≥ 44×44 px; bottom nav accounts for `env(safe-area-inset-bottom)`.
- Inputs are 16 px on mobile to prevent iOS zoom.

---

## 12. Implementation map

| Token / pattern | Code |
| --- | --- |
| Colour, type, motion, utilities | `app/globals.css` |
| Class merge helper | `lib/utils.js` (`cn`) |
| Buttons, inputs, cards, badges | `components/ui/` |
| Dialogs, menus, tabs, tooltips | `components/ui/` (Radix wrappers) |
| App shell, nav, top bar | `components/layout/` |
| Charts | `components/charts/` |
| Data + auth | `lib/api.js`, `lib/auth.js`, `lib/hooks.js`, `store/` |
| Living style guide | `/design` route |

### Non-negotiables
1. No raw hex in components — use tokens.
2. No `transition: all`.
3. No `scale(0)` entrances.
4. No hover-only affordances on touch.
5. No fake data presented as real; demo data is labelled.
6. Every new component is added to `/design` and documented here.
