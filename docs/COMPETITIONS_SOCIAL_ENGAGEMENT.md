# 🏆 Task 47: Competition, Social & Engagement Architecture

> Baseline analysis, existing code inventory, gap analysis, and revised Maintainer Product Decision Sheet for Issues #128, #129, #130, #131, #132, #133, and #134.

---

## 📌 Table of Contents

- [Executive Summary](#executive-summary)
- [Source-Backed Existing Code Inventory](#source-backed-existing-code-inventory)
  - [47.1 Competition Scoring Rules (#128)](#471-competition-scoring-rules-128)
  - [47.2 Leaderboard Refresh Job (#129)](#472-leaderboard-refresh-job-129)
  - [47.3 Achievement Trigger Rules (#130)](#473-achievement-trigger-rules-130)
  - [47.4 Leaderboard History API (#131)](#474-leaderboard-history-api-131)
  - [47.5 Social Feed Ranking (#132)](#475-social-feed-ranking-132)
  - [47.6 Order-Execution Notifications (#133)](#476-order-execution-notifications-133)
  - [47.7 Sentiment Aggregation (#134)](#477-sentiment-aggregation-134)
- [Maintainer Product Decision Sheet](#maintainer-product-decision-sheet)
  - [Decision 1: Competition Scoring Rules & Boundary Conventions (#128)](#decision-1-competition-scoring-rules--boundary-conventions-128)
  - [Decision 2: Leaderboard Refresh Canonical Scheduler & Transport (#129)](#decision-2-leaderboard-refresh-canonical-scheduler--transport-129)
  - [Decision 3: Achievement Rules Catalog & Event Hooks (#130)](#decision-3-achievement-rules-catalog--event-hooks-130)
  - [Decision 4: Leaderboard History API & Date-Range Contract (#131)](#decision-4-leaderboard-history-api--date-range-contract-131)
  - [Decision 5: Social Feed Ranking Signals, Bounded Queries & Pagination (#132)](#decision-5-social-feed-ranking-signals-bounded-queries--pagination-132)
  - [Decision 6: Order Lifecycle Notifications — Enum vs Structured Event Data (#133)](#decision-6-order-lifecycle-notifications--enum-vs-structured-event-data-133)
  - [Decision 7: Sentiment Aggregation — Values, Windows & Complete Classification (#134)](#decision-7-sentiment-aggregation--values-windows--complete-classification-134)
- [Commit Sequence & Execution Roadmap](#commit-sequence--execution-roadmap)

---

## Executive Summary

Task 47 encompasses seven related features across competitions, leaderboards, social engagement, and trading lifecycle notifications. 

A thorough review of `main` reveals that while certain foundational components exist (such as `LeaderboardSnapshot`, `portfolioValuationService`, in-app `createOrderExecutedNotification`, and chronological post feeds), significant architectural models and routes are currently absent from `schema.prisma` and `backend/src/` (notably Leagues/Competitions, Achievements, Sentiment Votes, historical leaderboard queries, and order lifecycle event notifications).

Per project instructions, this revised decision sheet explicitly separates confirmed baseline requirements from recommendations, evaluates alternatives, and details practical impact across database performance, data consistency, and API contracts.

---

## Source-Backed Existing Code Inventory

### 47.1 Competition Scoring Rules (#128)
- **Current Main Implementation**:
  - `backend/prisma/schema.prisma` defines enum `OrderSource.LEAGUE` (line 57) and `NotificationType.LEAGUE_UPDATE` (line 79).
  - **CRITICAL GAP**: No Prisma models exist for `League`, `Competition`, `LeagueMember`, or league rules in `schema.prisma` or migrations.
  - No services, controllers, or routes exist in `backend/src/` for leagues or competitions.
  - `docs/DATABASE.md` (lines 570–616) and `docs/FEATURES.md` (lines 285–310) document prospective designs for `model League` and `model LeagueMember`.
  - Existing portfolio valuation (`backend/src/services/portfolioValuationService.js`) calculates mark-to-market valuation `totalValue = cashBalance + holdingsValue` using live quotes or historical candle closes, with strict non-zero pricing invariants.
  - Existing daily performance snapshots (`backend/src/services/portfolioSnapshotService.js`) capture end-of-day balances and returns.

### 47.2 Leaderboard Refresh Job (#129)
- **Current Main Implementation**:
  - `backend/src/services/leaderboardService.js` provides `generateLeaderboardSnapshots({ date })`:
    - Normalizes dates to UTC midnight: `normalizeSnapshotDate(date)`.
    - Iterates over active users (`isSuspended: false`).
    - Calculates period P&L from trades in UTC date ranges (`DAILY`, `WEEKLY`, `MONTHLY`, `ALL_TIME`).
    - Computes `returnPct` (4 decimals) and `totalValue` (8 decimals).
    - Persists snapshots into `LeaderboardSnapshot` and `LeaderboardEntry` within `prisma.$transaction`.
  - `backend/scripts/generate-leaderboard-snapshots.js` provides a manual CLI runner (`npm run leaderboard:snapshot`).
  - **CRITICAL GAP**: `backend/src/workers/index.js` orchestrates `scanScheduler`, `orderWorker` / `orderQueueWorker`, and `portfolioSnapshotWorker` (`startPortfolioSnapshotWorker`), but **does NOT schedule or trigger leaderboard snapshot generation**.

### 47.3 Achievement Trigger Rules (#130)
- **Current Main Implementation**:
  - `NotificationType` enum includes `ACHIEVEMENT_UNLOCKED`.
  - **CRITICAL GAP**: No `Achievement` or `UserAchievement` tables exist in `schema.prisma` or database migrations.
  - No achievement service, trigger rules, or evaluation hooks exist in `backend/src/`.
  - `docs/FEATURES.md` (lines 312–326) defines achievement examples (`First Trade`, `First Profit`, `10 Successful Trades`, `Portfolio Milestone`, `League Winner`, `Consistent Trader`).
  - `docs/DATABASE.md` (lines 535–567) documents prospective `Achievement` and `UserAchievement` schemas.

### 47.4 Leaderboard History API (#131)
- **Current Main Implementation**:
  - `backend/src/routes/leaderboardRoutes.js` registers:
    - `GET /api/v1/leaderboard` (latest global snapshot)
    - `GET /api/v1/leaderboard/friends` (friends filtered from latest global snapshot)
  - `LeaderboardSnapshot` and `LeaderboardEntry` models exist in Prisma and store historical runs indexed by `[scope, period, snapshotDate]`.
  - **CRITICAL GAP**: No route or controller exists to query historical leaderboard snapshots by specific date or across date ranges.

### 47.5 Social Feed Ranking (#132)
- **Current Main Implementation**:
  - `backend/src/services/socialService.js#getFeed` queries posts with `where: { isHidden: false }` ordered strictly by `createdAt: "desc"`.
  - Includes `_count: { likes: true }` and author public profile.
  - **CRITICAL GAP**: Feed is purely chronological; no engagement ranking signals, recency decay, or author affinity boosts exist. Suspended authors (`isSuspended: true`) are not currently filtered out of `getFeed`.

### 47.6 Order-Execution Notifications (#133)
- **Current Main Implementation**:
  - `backend/src/services/notificationEvents.js#createOrderExecutedNotification` writes an in-app `ORDER_EXECUTED` notification row with structured payload in `data: Json`.
  - Called from `tradeService.js` post-commit.
  - **CRITICAL GAP**: Terminal non-executed states (`CANCELLED`, `EXPIRED`, `REJECTED`) do not emit notifications, and `NotificationType` enum currently lacks values for cancellations, rejections, and expirations.

### 47.7 Sentiment Aggregation (#134)
- **Current Main Implementation**:
  - **CRITICAL GAP**: No `SentimentVote` model or `Sentiment` enum exists in `schema.prisma`.
  - No sentiment routes or services exist in `backend/src/`.
  - `docs/FEATURES.md` (lines 331–337) specifies votes: `BULLISH`, `BEARISH`, `NEUTRAL`.
  - `docs/DATABASE.md` (lines 622–637, 805–809) documents `enum Sentiment { BULLISH, BEARISH, NEUTRAL }` and `model SentimentVote`.

---

## Maintainer Product Decision Sheet

### Decision 1: Competition Scoring Rules & Boundary Conventions (#128)

#### Confirmed / Baseline Requirements
- **Goal**: Define and implement scoring for supported competition formats using approved product rules. Confirm inputs, period boundaries, tie-breaks, and insufficient-activity behavior; make scoring deterministic and test ties.
- **Documented Features**: Trading leagues are time-bound competitions with `startDate`, `endDate`, `startingBalance`, `maxParticipants`, and statuses (`UPCOMING`, `ACTIVE`, `COMPLETED`, `CANCELLED`). Each participant receives an isolated league portfolio.
- **Missing Database Models**: `model League` and `model LeagueMember` do not currently exist in `schema.prisma` and require a migration.
- **Existing Valuation Conventions**:
  - `calculatePortfolioValuation(portfolioId, { asOf, client, priceProvider })`: Computes `totalValue = cashBalance + holdingsValue`. Invariant: Never treats missing/stale prices as zero; surfaces 503 if quote is unavailable.
  - `captureDailyPortfolioSnapshots`: Captures EOD close comparing against initial balance or prior day.

#### Proposed Recommendation
1. **Scoring Metric**: Percentage portfolio return over the competition duration:
   $$\text{Return \%} = \frac{\text{Current Valuation} - \text{startingBalance}}{\text{startingBalance}} \times 100$$
   - For `ACTIVE` leagues: $\text{Current Valuation}$ computed via `calculatePortfolioValuation()` using live quotes (or cached valuation).
   - For `COMPLETED` leagues: Valued using historical candle close as of `league.endDate` (or the last completed daily performance snapshot for that league portfolio as of `endDate`).
2. **Boundary & Trade Filtering**:
   - Only trades executed within $[\text{startDate}, \text{endDate}]$ UTC belong to the competition. Trades attempted prior to `startDate` or after `endDate` are rejected.
   - The competition portfolio is created with `OrderSource.LEAGUE`, `isDefault: false`, `startingBalance: league.startingBalance`, and `cashBalance: league.startingBalance`. External deposits and withdrawals are strictly disabled.
3. **Insufficient Activity**:
   - Participants with 0 trades maintain their starting balance ($0.00\%$ return). They are ranked below active participants who traded and achieved $\ge 0.00\%$ return.
4. **Deterministic Tie-Breaking**:
   - 1) `returnPct DESC`, 2) `totalValue DESC`, 3) `tradeCount DESC`, 4) `joinedAt ASC` (earlier join ranks higher), 5) `userId ASC`.
5. **Required Models to Add via Migration**:
   ```prisma
   enum LeagueStatus {
     UPCOMING
     ACTIVE
     COMPLETED
     CANCELLED
   }

   model League {
     id              String        @id @default(uuid())
     name            String
     description     String?
     startDate       DateTime
     endDate         DateTime
     startingBalance Decimal       @default(10000) @db.Decimal(18, 8)
     maxParticipants Int?
     status          LeagueStatus  @default(UPCOMING)
     createdAt       DateTime      @default(now())
     updatedAt       DateTime      @updatedAt
     members         LeagueMember[]
     @@index([status])
     @@index([startDate])
   }

   model LeagueMember {
     id          String    @id @default(uuid())
     leagueId    String
     userId      String
     portfolioId String    @unique
     rank        Int?
     finalReturn Decimal?  @db.Decimal(10, 4)
     joinedAt    DateTime  @default(now())
     league      League    @relation(fields: [leagueId], references: [id], onDelete: Cascade)
     user        User      @relation(fields: [userId], references: [id], onDelete: Cascade)
     @@unique([leagueId, userId])
     @@index([leagueId])
     @@index([userId])
   }
   ```

#### Alternatives Considered
- **Alternative A: Realized P&L Only**: Sum realized trade profits during the competition window, ignoring open holdings.
  - *Drawback*: Severely penalizes long-term or swing positions; participants holding profitable unclosed positions would register 0% return.
- **Alternative B: Time-Weighted Rate of Return (TWRR)**:
  - *Drawback*: TWRR exists to neutralize cash inflows/outflows. Since league portfolios prohibit external cash deposits and withdrawals, TWRR mathematically collapses to standard percentage return while adding unnecessary computational complexity.

#### Practical Impact
- Reuses existing robust financial primitives (`calculatePortfolioValuation`).
- Eliminates any cash-deposit gaming.
- Deterministic multi-tier sort guarantees zero flaky ranking assertions across concurrent test runs.

---

### Decision 2: Leaderboard Refresh Canonical Scheduler & Transport (#129)

#### Confirmed / Baseline Requirements
- **Goal**: Schedule/enqueue leaderboard snapshot refreshes for supported periods (`DAILY`, `WEEKLY`, `MONTHLY`, `ALL_TIME`). Reuse existing snapshot-generation logic (`generateLeaderboardSnapshots`), define cadence/timezone, make reruns idempotent, and ensure APIs read consistent completed snapshots.
- **Existing Worker Setup**:
  - `backend/src/workers/index.js` manages worker lifecycles.
  - `backend/src/workers/portfolioSnapshotWorker.js` runs as an in-process scheduled worker (`startPortfolioSnapshotWorker`) polling every 60 seconds with an allowable settlement window from 00:00 to 02:00 UTC for yesterday's close.
  - BullMQ is reserved specifically for transactional queues (`orders` queue with `orderQueueWorker`).

#### Proposed Recommendation
- **Canonical Transport**: Implement `backend/src/workers/leaderboardSnapshotWorker.js` as an **in-process scheduled worker** matching the exact architecture of `portfolioSnapshotWorker.js`, and start it in `backend/src/workers/index.js`.
- **Do not run a dual polling + BullMQ scheduler**:
  - A single in-process worker matches `portfolioSnapshotWorker` and guarantees the snapshot generator runs identically across local development, test suites, and production without requiring Redis queues.
- **Cadence & Window**:
  - Daily at **02:00 UTC**.
  - *Rationale*: `portfolioSnapshotWorker` runs between 00:00 and 02:00 UTC to finalize all daily portfolio valuations for the prior day. Scheduling leaderboard snapshots at 02:00 UTC ensures all portfolio closing values and trades have settled.
- **Rerun Idempotency**:
  - `generateLeaderboardSnapshots` already uses `leaderboardSnapshot.upsert` and deletes existing entries for `(scope, period, snapshotDate)` inside a transaction before inserting new ones. Reruns safely refresh the snapshot without data duplication.

#### Alternatives Considered
- **Alternative A: BullMQ Repeatable Cron Job**:
  - Create a new BullMQ queue (`leaderboard-snapshots`) with a repeatable job scheduled via Redis.
  - *Drawback*: Adds unnecessary distributed lock and Redis dependency for a single daily job; breaks environments running with `QUEUES_ENABLED=false` (e.g. CI, offline dev).

#### Practical Impact
- Zero additional infrastructure requirements.
- Clean sequential orchestration: EOD Portfolio Snapshots settle (00:00–02:00 UTC) $\to$ Leaderboard Snapshots generate (02:00 UTC).
- Graceful shutdown handled seamlessly alongside existing workers in `backend/src/workers/index.js`.

---

### Decision 3: Achievement Rules Catalog & Event Hooks (#130)

#### Confirmed / Baseline Requirements
- **Goal**: Build achievement trigger rules. Unlocking must be processed asynchronously or via event hooks.
- **Existing Enum**: `NotificationType.ACHIEVEMENT_UNLOCKED` exists in `schema.prisma`.
- **Missing Models**: `Achievement` and `UserAchievement` tables are not in `schema.prisma` and require a migration.
- **Documented Examples in `docs/FEATURES.md` (lines 318–324)**:
  - First Trade
  - First Profit
  - 10 Successful Trades
  - Portfolio Milestone
  - League Winner
  - Consistent Trader

#### Proposed Recommendation
1. **Initial Catalog (Grounded in `docs/FEATURES.md`)**:
   - `FIRST_TRADE` ("First Trade"): Executed at least 1 trade (`totalTrades >= 1`).
   - `FIRST_PROFIT` ("First Profit"): Closed at least 1 trade with `realizedPnl > 0`.
   - `TEN_SUCCESSFUL_TRADES` ("10 Successful Trades"): Achieved 10 trades with `realizedPnl > 0`.
   - `PORTFOLIO_MILESTONE` ("Portfolio Milestone"): Total portfolio value crosses $\ge \$25,000$ (from initial $\$10,000$).
   - *(Optional / Phase 2)*: `LEAGUE_WINNER` ("League Winner"): Won 1st place in a completed league (depends on League completion job).
   - *(Optional / Phase 2)*: `CONSISTENT_TRADER` ("Consistent Trader"): Traded on 5 distinct consecutive calendar days (requires historical activity tracking).
2. **Trigger Mechanism**:
   - Event-driven post-commit hook in `tradeService.js` (following the pattern of `createOrderExecutedNotification`).
   - Executes evaluation asynchronously after the trade transaction has committed (`setImmediate` or async worker).
   - Idempotent unlock via `prisma.userAchievement.create` catching unique constraint violations (`P2002`) or using `upsert`.
   - Automatically writes an in-app `Notification` with `type: "ACHIEVEMENT_UNLOCKED"`.
3. **Required Models to Add via Migration**:
   ```prisma
   model Achievement {
     id          String            @id @default(uuid())
     code        String            @unique
     name        String
     description String
     iconUrl     String?
     category    String            @default("TRADING")
     criteria    Json
     createdAt   DateTime          @default(now())
     users       UserAchievement[]
   }

   model UserAchievement {
     id            String      @id @default(uuid())
     userId        String
     achievementId String
     unlockedAt    DateTime    @default(now())
     user          User        @relation(fields: [userId], references: [id], onDelete: Cascade)
     achievement   Achievement @relation(fields: [achievementId], references: [id], onDelete: Cascade)
     @@unique([userId, achievementId])
     @@index([userId])
   }
   ```

#### Alternatives Considered
- **Alternative A: Heavy BullMQ Queue Evaluation**:
  - Enqueue an `evaluate-achievements` job to Redis for every single user interaction.
  - *Drawback*: High queue overhead for straightforward counter checks.
- **Alternative B: Nightly Batch Evaluation**:
  - Run a daily batch scanner to award achievements.
  - *Drawback*: Completely eliminates real-time user delight; achievements unlock hours or days after the achievement event took place.

#### Practical Impact
- Immediate user feedback.
- Strict `@@unique([userId, achievementId])` database constraint guarantees zero duplicate unlocks.
- Post-commit execution ensures trade execution latency is unaffected.

---

### Decision 4: Leaderboard History API & Date-Range Contract (#131)

#### Confirmed / Baseline Requirements
- **Goal**: Expose historical leaderboard snapshots for supported periods/date ranges. Define ordering, pagination, snapshot selection, and visibility rules; return stored historical results rather than recalculating old rankings from current data.
- **Existing Schema**: `LeaderboardSnapshot` (`id`, `scope`, `period`, `snapshotDate`, `createdAt`, `@@unique([scope, period, snapshotDate])`) and `LeaderboardEntry` (`id`, `snapshotId`, `userId`, `rank`, `totalValue`, `returnPct`, `snapshotDate`).
- **Required Capability**: Must support both single-date snapshots and date-range retrieval.

#### Proposed Recommendation
- **Endpoint**: `GET /api/v1/leaderboard/history`
- **Query Parameters**:
  - `period`: enum (`DAILY`, `WEEKLY`, `MONTHLY`, `ALL_TIME`, default: `ALL_TIME`).
  - `date`: optional `YYYY-MM-DD` date string (exact single-day historical leaderboard).
  - `from` and `to`: optional `YYYY-MM-DD` date range bounds.
  - `page`: default 1 (bounded $1 \le \text{page}$).
  - `limit`: default 20 (bounded $1 \le \text{limit} \le 100$).
- **Response Modes & Ordering**:
  1. **Single-Date Historical Leaderboard** (`date` provided, or defaults to latest available date when neither `date` nor `from`/`to` provided):
     - Returns the ranked leaderboard entries for that snapshot date.
     - Ordering: Stable `rank ASC`, `userId ASC`.
     - Shape:
       ```json
       {
         "snapshotDate": "2026-11-10",
         "period": "MONTHLY",
         "scope": "GLOBAL",
         "leaderboard": [
           { "rank": 1, "userId": "...", "user": { "name": "...", "avatarUrl": "..." }, "totalValue": "11500.00000000", "returnPct": "15.0000" }
         ],
         "pagination": { "page": 1, "limit": 20, "total": 150, "totalPages": 8 }
       }
       ```
  2. **Date-Range Snapshot Summary** (`from` and `to` provided):
     - Returns available snapshot runs within $[from, to]$ with top performers or caller's historical performance.
     - Ordering: `snapshotDate DESC`.
     - Shape:
       ```json
       {
         "period": "DAILY",
         "scope": "GLOBAL",
         "from": "2026-11-01",
         "to": "2026-11-10",
         "snapshots": [
           { "snapshotDate": "2026-11-10", "totalEntries": 42, "topUser": { "userId": "...", "name": "...", "returnPct": "12.5000" } }
         ],
         "pagination": { "page": 1, "limit": 20, "total": 10, "totalPages": 1 }
       }
       ```
- **Visibility**: Excludes suspended users (`user.isSuspended: false`).
- **Data Source**: Reads strictly from indexed `LeaderboardSnapshot` and `LeaderboardEntry`. Never dynamic recalculation.

#### Alternatives Considered
- **Alternative A: Dynamic Historical Querying**:
  - Re-run transaction calculations across historical trade tables for arbitrary past dates.
  - *Drawback*: Extreme database load; contradicts issue #131's explicit mandate: "return stored historical results rather than recalculating old rankings from current data".

#### Practical Impact
- Sub-millisecond indexed database queries.
- Bounded memory and network usage via standard pagination.
- Full compliance with date-range query specifications.

---

### Decision 5: Social Feed Ranking Signals, Bounded Queries & Pagination (#132)

#### Confirmed / Baseline Requirements
- **Goal**: Define and implement feed ordering/ranking from approved product requirements. Confirm ranking signals, recency weighting, stable pagination, and fallback ordering; preserve privacy/visibility rules and avoid unbounded query cost.
- **Existing Implementation**: `socialService.js#getFeed` queries `Post` with `where: { isHidden: false }` ordered strictly by `createdAt: "desc"`.

#### Proposed Recommendation
1. **Privacy & Visibility Rules (Strictly Enforced)**:
   - `post.isHidden: false`.
   - Author is active: `author.isSuspended: false`.
2. **Ranking Signals**:
   - **Engagement**: Total likes count (`postLikeCount`).
   - **Social Affinity**: $+2$ boost if the author is followed by the viewing user.
   - **Recency Decay**: Age in hours elapsed since `createdAt`.
   - **Gravity Decay Formula**:
     $$\text{Score} = \frac{\text{likes} + 1 + (\text{isFollowing} ? 2 : 0)}{(\text{ageHours} + 2)^{1.2}}$$
3. **Bounded Database Execution (Preventing Table Scans)**:
   - Computing floating-point decay across millions of posts in raw SQL causes table scans and severe CPU bottlenecks.
   - **Bounded Candidate Pool**: Filter ranking candidates strictly to recent posts: `createdAt >= NOW() - INTERVAL '7 days'`.
   - Query uses the composite index `[isHidden, createdAt]`.
4. **Stable Pagination & Two Modes**:
   - `GET /api/v1/social/feed?sort=trending` (default):
     - Fetches candidate posts from the 7-day window.
     - Orders by deterministic multi-tier tie-breakers: `score DESC`, `createdAt DESC`, `id ASC`.
     - Stable pagination supported via offset/limit or composite cursor `(score, createdAt, id)`.
   - `GET /api/v1/social/feed?sort=latest`:
     - Bypasses decay scoring entirely.
     - Direct indexed cursor pagination: `createdAt DESC`, `id DESC`.
   - Posts older than 7 days remain fully accessible via `sort=latest`.

#### Alternatives Considered
- **Alternative A: Offline Background Feed Aggregation (Fan-Out on Write)**:
  - Generate per-user timeline tables on each post or like.
  - *Drawback*: Excessive database write amplification and architecture bloat for current scale.
- **Alternative B: Unbounded SQL Dynamic Scoring**:
  - Run SQL `ORDER BY ((likes + 1) / POW(EXTRACT(EPOCH FROM (NOW() - createdAt))/3600 + 2, 1.2))` without date boundaries.
  - *Drawback*: Prevents PostgreSQL from utilizing B-tree indexes, forcing full-table sequential scans on every feed request.

#### Practical Impact
- Index-assisted candidate fetch limits database scan to the last 7 days.
- Zero risk of pagination drifting or duplicate posts.
- Complete privacy protection against suspended users and hidden posts.

---

### Decision 6: Order Lifecycle Notifications — Enum vs Structured Event Data (#133)

#### Confirmed / Baseline Requirements
- **Goal**: Generate notifications for relevant order lifecycle outcomes such as filled, rejected, cancelled, or expired. Use the existing notification pipeline, ensure one notification per intended transition, and emit only after the transaction commits.
- **Existing Schema**:
  - `model Notification` contains: `type NotificationType`, `title String`, `message String`, `data Json?`, `isRead Boolean`, `readAt DateTime?`.
  - Current `enum NotificationType`: `ORDER_EXECUTED`, `PRICE_ALERT`, `ACHIEVEMENT_UNLOCKED`, `COPY_TRADE_EXECUTED`, `LEAGUE_UPDATE`, `NEW_FOLLOWER`, `SYSTEM`.
  - Current `enum OrderEventType`: `CREATED`, `EXECUTED`, `CANCELLED`, `EXPIRED`, `REJECTED`.

#### Comparison: Enum Values vs Structured Event Data
| Angle | Option 1: Add Enum Values (`ORDER_CANCELLED`, `ORDER_REJECTED`, `ORDER_EXPIRED`) | Option 2: Retain Existing Enum + Structured Event Data in `data: Json` |
| :--- | :--- | :--- |
| **API & Filtering** | Clients can filter directly: `GET /notifications?type=ORDER_REJECTED` | Clients must fetch all notifications and inspect client-side `data.status` |
| **Schema Semantics** | Explicit, type-safe notification categorization in database | Semantically confusing if `type: ORDER_EXECUTED` is stored for an order that was cancelled or rejected |
| **Migration Risk** | Requires Prisma migration (`ALTER TYPE "NotificationType" ADD VALUE ...`) | Zero database migrations required |
| **Current Conventions** | Matches `ACHIEVEMENT_UNLOCKED` and `COPY_TRADE_EXECUTED` as distinct top-level enum types | Reuses existing `data: Json` field in `Notification` |

#### Proposed Recommendation
- **Adopt Option 1 (Explicit Enum Values)**:
  - Add `ORDER_CANCELLED`, `ORDER_REJECTED`, and `ORDER_EXPIRED` to `NotificationType` enum via migration.
  - Store complete execution/rejection metadata in `Notification.data: Json` (`orderId`, `symbol`, `side`, `quantity`, `reason`, `notes`).
- **Emission Invariants**:
  - Emitted strictly post-commit from `orderService.js` (for user cancellations) and `orderQueueWorker.js` / `orderWorker.js` (for worker rejections and expirations).
  - One notification per terminal transition; retry loops in workers will not re-emit duplicate notifications.

#### Practical Impact
- Clean, type-safe notification filtering for mobile/web clients.
- Prevents misleading notifications where cancelled/rejected orders carry `type: "ORDER_EXECUTED"`.

---

### Decision 7: Sentiment Aggregation — Values, Windows & Complete Classification (#134)

#### Confirmed / Baseline Requirements
- **Goal**: Aggregate sentiment votes by symbol/asset and supported time windows. Define weighting, time decay, minimum sample thresholds, and response fields from product requirements; distinguish no data from neutral sentiment.
- **Documented Values (`docs/FEATURES.md` line 334 & `docs/DATABASE.md` line 805)**:
  `enum Sentiment { BULLISH, BEARISH, NEUTRAL }`.
- **Missing Models**: `model SentimentVote` and `enum Sentiment` do not exist in `schema.prisma`.

#### Proposed Recommendation
1. **Model & Uniqueness**:
   ```prisma
   enum Sentiment {
     BULLISH
     BEARISH
     NEUTRAL
   }

   model SentimentVote {
     id        String    @id @default(uuid())
     userId    String
     symbol    String
     sentiment Sentiment
     createdAt DateTime  @default(now())
     updatedAt DateTime  @updatedAt

     user User @relation(fields: [userId], references: [id], onDelete: Cascade)

     @@unique([userId, symbol])
     @@index([symbol, updatedAt])
   }
   ```
2. **Vote Updates & Time Windows**:
   - Each user has at most 1 vote per symbol (`@@unique([userId, symbol])`). Subsequent votes update the record and refresh `updatedAt = now()`.
   - **Supported Windows**: `24h`, `7d`, `30d`, `ALL`.
   - **Window Filtering**:
     - For bounded windows (`24h`, `7d`, `30d`), filter by `updatedAt >= windowStart`.
     - *Semantics*: When a user updates their vote today from Bullish to Bearish, their vote reflects their active sentiment and enters the `24h` window. If a user voted 6 months ago and never updated it, their vote remains in `ALL` but expires out of the `24h` and `7d` windows.
3. **Mathematically Complete Classification (Distinguishing No Data from Neutral)**:
   - Let $B = \text{bullish votes}$, $R = \text{bearish votes}$, $N = \text{neutral votes}$ within the window.
   - Total votes $T = B + R + N$.
   - Sample Threshold: Minimum sample size $N_{\min} = 5$ (configurable, default 3 in test environment).
   - **Classification Rules**:
     1. **`NO_DATA`**: If $T < N_{\min}$ (insufficient votes to draw a statistically meaningful sentiment).
     2. **`BULLISH`**: If $T \ge N_{\min}$ AND $\frac{B}{T} > 0.50$ AND $B > R$.
     3. **`BEARISH`**: If $T \ge N_{\min}$ AND $\frac{R}{T} > 0.50$ AND $R > B$.
     4. **`NEUTRAL`**: If $T \ge N_{\min}$ AND neither Bullish nor Bearish criteria are met (e.g. Neutral votes dominate, or Bullish and Bearish are evenly divided).
   - *Completeness Guarantee*: These four cases form a disjoint, exhaustive partition of all possible states.
4. **API Response Contract**:
   ```json
   {
     "symbol": "AAPL",
     "window": "7d",
     "totalVotes": 15,
     "sampleThresholdMet": true,
     "breakdown": {
       "bullish": { "count": 9, "percentage": "60.00" },
       "bearish": { "count": 3, "percentage": "20.00" },
       "neutral": { "count": 3, "percentage": "20.00" }
     },
     "classification": "BULLISH",
     "userVote": "BULLISH"
   }
   ```

#### Alternatives Considered
- **Alternative A: Continuous Normalized Score $[-1.0, +1.0]$**:
  - Score $= \frac{B - R}{T}$.
  - *Drawback*: Ignores `NEUTRAL` votes in the numerator, treating neutral voters identically to non-voters.
- **Alternative B: Binary Bullish/Bearish Only**:
  - *Drawback*: Directly violates `docs/FEATURES.md` and `docs/DATABASE.md` which explicitly define `NEUTRAL`.

#### Practical Impact
- Rigorously solves the ambiguity between zero data and neutral sentiment.
- `@@unique([userId, symbol])` prevents ballot stuffing.
- Index on `[symbol, updatedAt]` ensures aggregate queries run via index scans in $< 1\text{ms}$.

---

## Commit Sequence & Execution Roadmap

1. `docs(task-47): record current behavior and open product decisions` *(Committed: 34fad5a)*
2. `test(leaderboard): cover snapshot refresh invariants` *(Committed: 6a8381b)*
3. `feat(workers): schedule leaderboard snapshot refreshes` *(Canonical in-process worker)*
4. `feat(competitions): implement approved scoring rules` *(Requires Decision 1 approval & migration)*
5. `feat(achievements): add approved idempotent trigger rules` *(Requires Decision 3 approval & migration)*
6. `feat(api): expose stored leaderboard history` *(Requires Decision 4 approval)*
7. `feat(social): rank feed using approved signals` *(Requires Decision 5 approval)*
8. `feat(notifications): cover approved order lifecycle transitions` *(Requires Decision 6 approval & migration)*
9. `feat(sentiment): aggregate votes by approved windows` *(Requires Decision 7 approval & migration)*
10. `test(task-47): cover cross-feature regressions`
11. `docs(task-47): document approved APIs and operations`
12. `docs(task-47): record final verification`
