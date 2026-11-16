# 🏆 Task 47: Competition, Social & Engagement Architecture

> Baseline analysis, existing code inventory, gap analysis, and revised Maintainer Product Decision Sheet for Issues #128, #129, #130, #131, #132, #133, and #134.

---

## 📌 Table of Contents

- [Executive Summary](#executive-summary)
- [Maintainer Product Decision Sheet](#maintainer-product-decision-sheet)
  - [47.1 Competition Scoring Rules (#128)](#471-competition-scoring-rules-128)
  - [47.2 Leaderboard Refresh Job (#129)](#472-leaderboard-refresh-job-129)
  - [47.3 Achievement Trigger Rules (#130)](#473-achievement-trigger-rules-130)
  - [47.4 Leaderboard History API (#131)](#474-leaderboard-history-api-131)
  - [47.5 Social Feed Ranking (#132)](#475-social-feed-ranking-132)
  - [47.6 Order-Execution Notifications (#133)](#476-order-execution-notifications-133)
  - [47.7 Sentiment Aggregation (#134)](#477-sentiment-aggregation-134)
- [Commit Sequence & Execution Roadmap](#commit-sequence--execution-roadmap)

---

## Executive Summary

Task 47 encompasses seven related features across competitions, leaderboards, social engagement, and trading lifecycle notifications. 

A thorough review of `main` reveals that while certain foundational components exist (such as `LeaderboardSnapshot`, `portfolioValuationService`, in-app `createOrderExecutedNotification`, and chronological post feeds), significant architectural models and routes are currently absent from `schema.prisma` and `backend/src/` (notably Leagues/Competitions, Achievements, Sentiment Votes, historical leaderboard queries, and order lifecycle event notifications).

This document serves as the formal decision sheet. For each issue, it details:
1. **Existing Implementation Evidence**: Grounded strictly in current code, tests, and documentation.
2. **Exact Remaining Work**: What must be constructed.
3. **Migration & Scope Impact**: Database changes and affected models.
4. **Proposed Behavior [DECISIONS AWAITING APPROVAL]**: Clear proposals explicitly flagged as awaiting maintainer approval.
5. **Alternatives Considered**: Other viable architectures and reasons for rejection.
6. **Decision Still Needed**: Specific items requiring maintainer sign-off.

---

## Maintainer Product Decision Sheet

### 47.1 Competition Scoring Rules (#128)

#### 1. Existing Implementation Evidence
* `backend/prisma/schema.prisma` line 57: `OrderSource` enum contains `LEAGUE`.
* `backend/prisma/schema.prisma` line 79: `NotificationType` enum contains `LEAGUE_UPDATE`.
* `docs/FEATURES.md` lines 285–310: Documents league concept, fields (`name`, `description`, `startDate`, `endDate`, `startingBalance`, `maxParticipants`), statuses (`UPCOMING`, `ACTIVE`, `COMPLETED`, `CANCELLED`), and the requirement that each participant receives a league-specific portfolio.
* `docs/DATABASE.md` lines 570–616: Documents prospective `model League` and `model LeagueMember` schemas.
* `backend/src/services/portfolioValuationService.js`: `calculatePortfolioValuation(portfolioId, { asOf, client, priceProvider })` calculates mark-to-market portfolio value ($\text{cashBalance} + \text{holdingsValue}$) using live quotes or historical candle closes with strict non-zero pricing invariants (surfaces 503 if quotes unavailable).
* `backend/src/services/portfolioSnapshotService.js`: Captures daily EOD valuation snapshots comparing against initial balance or prior day.
* **CRITICAL GAP**: Neither `League` nor `LeagueMember` models exist in `schema.prisma` or database migrations. No competition routes or scoring services exist in `backend/src/`.

#### 2. Exact Remaining Work
* Prisma schema update and migration adding `LeagueStatus` enum, `League`, and `LeagueMember` models.
* Creation of `backend/src/services/competitionService.js` with deterministic scoring calculation, boundary checks, and tie-breaking.
* Unit and integration test suite covering scoring calculation, edge boundaries, tie breaks, and zero-activity participants.

#### 3. Scope & Migration Impact
* **New Models**:
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
    portfolio   Portfolio @relation(fields: [portfolioId], references: [id], onDelete: Cascade)
    @@unique([leagueId, userId])
    @@index([leagueId])
    @@index([userId])
  }
  ```
* **Impact on Existing Tables**: Adds relation `leagueMembers LeagueMember[]` to `User` and `leagueMember LeagueMember?` to `Portfolio`. Existing users and portfolios remain untouched; zero data backfill required.

#### 4. Proposed Behavior [DECISIONS AWAITING APPROVAL]
* **[AWAITING APPROVAL] Scoring Metric**: Total percentage return based on mark-to-market valuation:
  $$\text{Return \%} = \frac{\text{Current Valuation} - \text{startingBalance}}{\text{startingBalance}} \times 100$$
  * Active leagues: Valued via `calculatePortfolioValuation()` using live quotes.
  * Completed leagues: Valued using historical candle close as of `league.endDate`.
* **[AWAITING APPROVAL] Portfolio Isolation**: Each participant enters with an isolated competition portfolio (`OrderSource.LEAGUE`, `isDefault: false`, `startingBalance: league.startingBalance`, `cashBalance: league.startingBalance`). Cash deposits and withdrawals are disallowed to prevent return distortion.
* **[AWAITING APPROVAL] Boundary & Trades**: Only trades with `executedAt >= league.startDate` and `executedAt <= league.endDate` belong to the competition. Trades outside this window are rejected.
* **[AWAITING APPROVAL] Late-Join Policy**: Allowed while league status is `ACTIVE` and current time $< \text{endDate}$. The late joiner starts with the full `startingBalance` in cash.
* **[AWAITING APPROVAL] Insufficient Activity**: Participants with 0 trades remain at starting balance ($0.00\%$ return) and are sorted below participants who made trades and achieved $\ge 0.00\%$ return.
* **[AWAITING APPROVAL] Deterministic Tie-Breakers**: 1) `returnPct DESC`, 2) `totalValue DESC`, 3) `tradeCount DESC`, 4) `joinedAt ASC`, 5) `userId ASC`.

#### 5. Alternatives Considered
* **Alternative A (Realized P&L Only)**: Only count closed trade cash gains.
  * *Drawback*: Penalizes open swing/position holdings; participants holding winning open positions would show 0% return.
* **Alternative B (Time-Weighted Rate of Return / TWRR)**:
  * *Drawback*: Unnecessary complexity; because external deposits/withdrawals are disallowed in competition portfolios, TWRR mathematically collapses to standard percentage return.

#### 6. Decision Still Needed
* Maintainer confirmation on:
  1. Percentage return formula using mark-to-market valuation vs realized P&L only.
  2. Late-join policy (permitted with standard starting balance vs disallowed after start).
  3. Tie-breaker hierarchy and zero-trade rank demotion.

---

### 47.2 Leaderboard Refresh Job (#129)

#### 1. Existing Implementation Evidence
* `backend/src/services/leaderboardService.js`: `generateLeaderboardSnapshots({ date })` computes and persists snapshots for `DAILY`, `WEEKLY`, `MONTHLY`, `ALL_TIME`.
* `backend/scripts/generate-leaderboard-snapshots.js`: Manual CLI trigger (`npm run leaderboard:snapshot`).
* `backend/src/workers/portfolioSnapshotWorker.js`: In-process scheduled worker (`startPortfolioSnapshotWorker`) polling every 60s with an allowable settlement window from 00:00 to 02:00 UTC for yesterday's close.
* `backend/src/workers/index.js`: Manages worker lifecycles (`orderWorker`/`queueWorker`, `scanScheduler`, `portfolioSnapshotWorker`).
* **CRITICAL GAP**: Leaderboard snapshot generation is completely absent from `backend/src/workers/index.js`. No background job currently executes it.

#### 2. Exact Remaining Work
* Implement `backend/src/workers/leaderboardSnapshotWorker.js`.
* Register `startLeaderboardSnapshotWorker` in `backend/src/workers/index.js` with lifecycle start and graceful shutdown.
* Define fallback and retry policies when prior EOD portfolio snapshots are missing.

#### 3. Scope & Migration Impact
* No schema migration required.
* Worker orchestration update only.

#### 4. Proposed Behavior [DECISIONS AWAITING APPROVAL]
* **[AWAITING APPROVAL] Canonical Transport**: Single **in-process scheduled worker** (`leaderboardSnapshotWorker.js`) started in `backend/src/workers/index.js`.
  * *Rationale*: Matches `portfolioSnapshotWorker.js`. Avoids dual scheduling, runs identically across local development, CI (`QUEUES_ENABLED=false`), and production without Redis queue dependencies.
* **[AWAITING APPROVAL] Schedule & Cadence**: Daily at **02:00 UTC** targeting yesterday ($T - 1$).
  * *Rationale*: `portfolioSnapshotWorker` runs between 00:00 and 02:00 UTC to finalize EOD portfolio snapshots. 02:00 UTC ensures all EOD closing prices and trades have settled.
* **[AWAITING APPROVAL] Missing/Failed Portfolio Snapshot Handling**:
  If at 02:00 UTC some active portfolios have failed or missing EOD snapshots:
  * **Option 1 (Recommended Retry + Fallback)**:
    1. Check if all active portfolios have completed EOD snapshots for date $D$.
    2. If missing, retry up to 3 times with 15-minute intervals (02:15, 02:30, 02:45 UTC).
    3. If still missing at 03:00 UTC, execute approved fallback: compute period rankings directly using live portfolio cash and holdings basis (the current behavior of `generateLeaderboardSnapshots`), log a high-priority warning, and record metric `LEADERBOARD_REFRESH_PARTIAL_FALLBACK`.
  * **Option 2 (Strict Block)**: Skip leaderboard generation for that date entirely and alert operators. (Drawback: a single failing portfolio prevents all users from having updated leaderboard rankings).
  * **Option 3 (Independent Direct Calculation)**: Re-calculate each user's period P&L and total valuation directly from trades and current balances (current `generateLeaderboardSnapshots` logic), completely decoupled from `PerformanceSnapshot`.
* **[AWAITING APPROVAL] Rerun Idempotency**: `generateLeaderboardSnapshots` uses `leaderboardSnapshot.upsert` and replaces `leaderboardEntry` within `prisma.$transaction`. Reruns safely refresh the snapshot without data duplication.

#### 5. Alternatives Considered
* **Alternative A (BullMQ Repeatable Job)**:
  * *Drawback*: Breaks environments running with `QUEUES_ENABLED=false` (CI, offline dev). In-process scheduling aligns directly with `portfolioSnapshotWorker`.

#### 6. Decision Still Needed
* Maintainer confirmation on:
  1. Adopting the canonical in-process worker model at 02:00 UTC.
  2. Selecting the missing-snapshot failure policy: Option 1 (Retry with fallback), Option 2 (Strict block), or Option 3 (Decoupled direct calculation).

---

### 47.3 Achievement Trigger Rules (#130)

#### 1. Existing Implementation Evidence
* `backend/prisma/schema.prisma` line 77: Enum `NotificationType.ACHIEVEMENT_UNLOCKED`.
* `docs/FEATURES.md` lines 312–326: Documents achievement criteria examples (`First Trade`, `First Profit`, `10 Successful Trades`, `Portfolio Milestone`, `League Winner`, `Consistent Trader`) and notes that unlocking is processed asynchronously.
* `docs/DATABASE.md` lines 535–567: Documents prospective `Achievement` and `UserAchievement` schemas.
* **CRITICAL GAP**: Neither `Achievement` nor `UserAchievement` models exist in `schema.prisma` or database migrations. No trigger service exists in `backend/src/`.

#### 2. Exact Remaining Work
* Prisma schema update and migration adding `Achievement` and `UserAchievement` tables.
* Seeding baseline achievement definitions in `backend/prisma/seed.js`.
* Implementation of durable trigger handler in `backend/src/services/achievementService.js`.
* Integration of post-commit evaluation hooks in `tradeService.js` and `socialService.js`.

#### 3. Scope & Migration Impact
* **New Models**:
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
* Adds relation `achievements UserAchievement[]` to `User`. No changes or locks on existing tables.

#### 4. Proposed Behavior [DECISIONS AWAITING APPROVAL]
* **[AWAITING APPROVAL] Durable Post-Commit Evaluation (Crash-Resilient)**:
  * Evaluated post-commit directly in `tradeService.js` (awaited in a try/catch block matching `createOrderExecutedNotification`).
  * **Crash Recovery & Reconciliation**: To ensure achievements survive process crashes before the post-commit handler finishes:
    1. Grants execute via idempotent upsert: `prisma.userAchievement.create` catching duplicate key constraint (`P2002`).
    2. A reconciliation helper `reconcileUserAchievements(userId)` checks cumulative stats (`totalTrades`, `profitableTrades`, `totalPortfolioValue`) against unlocked achievements. The next user action or worker startup automatically grants any earned but unrecorded achievements.
  * Side Effect: Writes in-app `Notification` of type `ACHIEVEMENT_UNLOCKED`.
* **[AWAITING APPROVAL] Catalog & Proposed Thresholds**:
  1. `FIRST_TRADE`: Executed at least 1 trade (`totalTrades >= 1`). *[Proposed]*
  2. `FIRST_PROFIT`: Closed at least 1 trade with `realizedPnl > 0`. *[Proposed]*
  3. `TEN_SUCCESSFUL_TRADES`: Closed at least 10 trades with `realizedPnl > 0`. *[Proposed]*
  4. `PORTFOLIO_MILESTONE`: Total portfolio value crosses $\ge \$25,000$ (from $\$10,000$). *[Proposed]*
  5. *(Optional / Phase 2)*: `LEAGUE_WINNER`: Won 1st place in a completed league (requires League completion settlement). *[Optional - Proposed]*
  6. *(Optional / Phase 2)*: `CONSISTENT_TRADER`: Traded across 5 distinct consecutive calendar days. *[Optional - Proposed]*

#### 5. Alternatives Considered
* **Alternative A (Ephemeral `setImmediate`)**:
  * *Drawback*: Rejected per maintainer feedback. An in-memory callback is lost if the Node.js process crashes or restarts before it executes.
* **Alternative B (Dedicated Outbox Table)**:
  * *Drawback*: Extra database table and polling worker when idempotent post-commit execution with query reconciliation achieves identical durability.

#### 6. Decision Still Needed
* Maintainer confirmation on:
  1. Approval of the 4 core achievements and the $25,000 portfolio milestone threshold.
  2. Whether to defer `LEAGUE_WINNER` and `CONSISTENT_TRADER` to Phase 2.

---

### 47.4 Leaderboard History API (#131)

#### 1. Existing Implementation Evidence
* `backend/src/routes/leaderboardRoutes.js`: Exposes `GET /api/v1/leaderboard` (latest global snapshot) and `GET /api/v1/leaderboard/friends`.
* `backend/prisma/schema.prisma` lines 500–526: `LeaderboardSnapshot` and `LeaderboardEntry` tables storing historical runs indexed by `[scope, period, snapshotDate]`.
* **CRITICAL GAP**: No route or service exists to query stored historical snapshots by date or across date ranges.

#### 2. Exact Remaining Work
* Implement `getHistoricalLeaderboard` service in `backend/src/services/leaderboardService.js`.
* Mount route `GET /api/v1/leaderboard/history` in `backend/src/routes/leaderboardRoutes.js`.
* Add query validation schema and test coverage.

#### 3. Scope & Migration Impact
* No schema migration required. Leverages existing `LeaderboardSnapshot` and `LeaderboardEntry` tables.

#### 4. Proposed Behavior [DECISIONS AWAITING APPROVAL]
* **[AWAITING APPROVAL] Endpoint Contract**: `GET /api/v1/leaderboard/history`
* **[AWAITING APPROVAL] Query Parameters**:
  * `period`: `DAILY`, `WEEKLY`, `MONTHLY`, `ALL_TIME` (default: `ALL_TIME`).
  * `date`: optional `YYYY-MM-DD` (single snapshot date).
  * `from` and `to`: optional `YYYY-MM-DD` (date range).
  * `page`: default 1 (bounded $\ge 1$).
  * `limit`: default 20 (bounded $1 \le \text{limit} \le 100$).
* **[AWAITING APPROVAL] Response Structure & Stored Ranks**:
  * Returns **historical ranked entries** (`LeaderboardEntry`) for the requested snapshot dates.
  * **Preservation of Stored Ranks**: The `rank` field in each entry was recorded when the snapshot was generated. It is returned verbatim without recalculation or re-ranking.
  * **Ordering**:
    * Date range (`from`/`to`): Ordered by `snapshotDate DESC, rank ASC, userId ASC`.
    * Single date (`date`): Ordered by `rank ASC, userId ASC`.
  * **Visibility**: Excludes suspended users (`where: { user: { isSuspended: false } }`).
  * **Response Shape**:
    ```json
    {
      "scope": "GLOBAL",
      "period": "DAILY",
      "from": "2026-11-01",
      "to": "2026-11-07",
      "entries": [
        {
          "snapshotDate": "2026-11-07",
          "rank": 1,
          "userId": "usr_123",
          "user": { "name": "Alice", "avatarUrl": null },
          "totalValue": "12500.00000000",
          "returnPct": "25.0000"
        }
      ],
      "pagination": { "page": 1, "limit": 20, "total": 140, "totalPages": 7 }
    }
    ```

#### 5. Alternatives Considered
* **Alternative A (Dynamic Historical Recalculation)**:
  * *Drawback*: Violates issue #131's mandate: "return stored historical results rather than recalculating old rankings from current data".
* **Alternative B (Snapshot Metadata Catalog Only)**:
  * *Drawback*: Rejected per maintainer feedback; issue #131 requires historical ranked entries.

#### 6. Decision Still Needed
* Maintainer confirmation on:
  1. Route parameters and response shape for date range queries.
  2. Confirming that suspended users are filtered from historical snapshot views.

---

### 47.5 Social Feed Ranking (#132)

#### 1. Existing Implementation Evidence
* `backend/src/services/socialService.js#getFeed`: Queries `Post` with `where: { isHidden: false }` ordered strictly by `createdAt: "desc"`.
* Existing indexes in `backend/prisma/schema.prisma`:
  * `Post`: `@@index([authorId, createdAt])`, `@@index([createdAt])`.
  * *Note: Composite index `[isHidden, createdAt]` DOES NOT exist.*
  * `PostLike`: `@@unique([postId, userId])`, `@@index([userId, createdAt])`.
* **CRITICAL GAP**: Feed is purely chronological; no engagement ranking signals, recency decay, or author affinity boosts exist. Suspended authors (`isSuspended: true`) are not currently filtered out of `getFeed`.

#### 2. Exact Remaining Work
* Implement ranking algorithm in `socialService.js`.
* Add query parameter `sort=trending|latest` (default: `trending`).
* Add author suspension filtering (`author: { isSuspended: false }`).

#### 3. Scope & Migration Impact
* No schema migration required initially (utilizes existing `@@index([createdAt])` on `Post`). Optional composite index `[isHidden, createdAt]` could be added if candidate pools expand in the future.

#### 4. Proposed Behavior [DECISIONS AWAITING APPROVAL]
* **[AWAITING APPROVAL] Bounded Candidate Selection**:
  * For `sort=trending`, query candidates using the existing `@@index([createdAt])` index:
    `where: { isHidden: false, author: { isSuspended: false }, createdAt: { gte: candidateWindowStart } }`, ordered by `createdAt: 'desc'`, with a hard cap: `take: 200` (`MAX_CANDIDATES = 200`).
  * **Bounded Row Count**: PostgreSQL uses the `createdAt` index to scan only recent rows, eliminating full-table scans.
  * **Bounded Node.js Memory**: Node.js receives at most 200 candidate posts.
* **[AWAITING APPROVAL] Ranking Signals & Formula**:
  * Engagement (likes count) + Affinity (+2 if viewing user follows author) divided by age decay:
    $$\text{Score} = \frac{\text{likes} + 1 + (\text{isFollowing} ? 2 : 0)}{(\text{ageHours} + 2)^{1.2}}$$
* **[AWAITING APPROVAL] Pagination Under Dynamic Score Changes**:
  * Because scores decay continuously with elapsed time, naive offset pagination can experience item shift across page requests.
  * **Session Stabilization**: The feed API accepts an optional `asOf` timestamp (or returns a `nextCursor` containing `asOf`). When fetching page 2, the client passes `asOf`, ensuring all decay scores remain completely identical throughout that feed browsing session.
  * Alternatively, `sort=latest` provides completely monotonic, stable pagination using `(createdAt DESC, id DESC)`.

#### 5. Alternatives Considered
* **Alternative A (Unbounded SQL Mathematical Ordering)**:
  * Run dynamic SQL ordering without candidate caps: `ORDER BY ((likes + 1) / POW(age + 2, 1.2))`.
  * *Drawback*: Forces full-table sequential scans on every request, degrading latency as post volume grows.

#### 6. Decision Still Needed
* Maintainer confirmation on:
  1. Candidate pool size (200 rows) and window (7 days).
  2. Gravity formula exponents ($+2$ following boost, $1.2$ decay exponent).
  3. Session `asOf` pagination stabilization.

---

### 47.6 Order-Execution Notifications (#133)

#### 1. Existing Implementation Evidence
* `backend/src/services/notificationEvents.js#createOrderExecutedNotification`: Writes `ORDER_EXECUTED` notification with structured context in `data: Json`.
* `backend/prisma/schema.prisma` lines 74–82: Enum `NotificationType` (`ORDER_EXECUTED`, `PRICE_ALERT`, `ACHIEVEMENT_UNLOCKED`, `COPY_TRADE_EXECUTED`, `LEAGUE_UPDATE`, `NEW_FOLLOWER`, `SYSTEM`).
* `backend/prisma/schema.prisma` lines 45–51: Enum `OrderEventType` (`CREATED`, `EXECUTED`, `CANCELLED`, `EXPIRED`, `REJECTED`).
* **CRITICAL GAP**: Terminal non-executed states (`CANCELLED`, `EXPIRED`, `REJECTED`) do not emit notifications, and `NotificationType` enum currently lacks values for cancellations, rejections, and expirations.

#### 2. Exact Remaining Work
* Add notification hooks for terminal outcomes: `CANCELLED` (in `orderService.cancelOrder`), `REJECTED`, and `EXPIRED` (in `orderQueueWorker.js` / `orderWorker.js`).
* Implement enum migration or structured data routing.

#### 3. Comparison: Enum Values vs Structured Event Data
| Dimension | Option 1: Add Explicit Enum Values (`ORDER_CANCELLED`, `ORDER_REJECTED`, `ORDER_EXPIRED`) | Option 2: Retain Existing Enum + Structured Event Data in `data: Json` |
| :--- | :--- | :--- |
| **Client Filtering** | Direct query filtering: `GET /notifications?type=ORDER_REJECTED` | Client must fetch all notifications and inspect nested JSON `data.status` |
| **Schema Clarity** | Type-safe, accurate categorization in DB | Semantically misleading to label a cancelled or rejected order as `ORDER_EXECUTED` or `SYSTEM` |
| **Database Migration** | Requires Prisma migration (`ALTER TYPE "NotificationType" ADD VALUE ...`) | No schema migration required |
| **Codebase Consistency** | Matches existing fine-grained types (`ACHIEVEMENT_UNLOCKED`, `COPY_TRADE_EXECUTED`) | Reuses existing generic `data: Json` structure |

#### 4. Proposed Behavior [DECISIONS AWAITING APPROVAL]
* **[AWAITING APPROVAL] Adopt Option 1 (Explicit Enum Values)**:
  * Add `ORDER_CANCELLED`, `ORDER_REJECTED`, and `ORDER_EXPIRED` to `NotificationType` enum in `schema.prisma`.
  * Store structured order context in `Notification.data: Json` (`orderId`, `symbol`, `side`, `quantity`, `price`, `reason`/`notes`).
  * Emitted strictly post-commit from `orderService.js` (for user cancellations) and `orderQueueWorker.js` / `orderWorker.js` (for rejections and expirations).
  * Enforce transition guards so terminal transitions emit exactly once.

#### 5. Alternatives Considered
* **Alternative A (Single Generic `ORDER_UPDATE` Type)**:
  * *Drawback*: Requires breaking rename of existing `ORDER_EXECUTED` enum value.

#### 6. Decision Still Needed
* Maintainer confirmation on adding explicit enum values (`ORDER_CANCELLED`, `ORDER_REJECTED`, `ORDER_EXPIRED`) via migration vs storing status inside `data: Json`.

---

### 47.7 Sentiment Aggregation (#134)

#### 1. Existing Implementation Evidence
* `docs/FEATURES.md` lines 331–337: Users can vote `BULLISH`, `BEARISH`, `NEUTRAL` for supported symbols.
* `docs/DATABASE.md` lines 622–637 & 805–809: Documents prospective `model SentimentVote` and `enum Sentiment { BULLISH, BEARISH, NEUTRAL }`.
* **CRITICAL GAP**: Neither `SentimentVote` model nor `Sentiment` enum exists in `backend/prisma/schema.prisma` or database migrations. No routes or services exist in `backend/src/`.

#### 2. Exact Remaining Work
* Prisma schema update and migration adding `Sentiment` enum and `SentimentVote` model.
* Implement `backend/src/services/sentimentService.js` (voting + window aggregation).
* Mount routes `POST /api/v1/sentiment/:symbol/vote` and `GET /api/v1/sentiment/:symbol`.

#### 3. Scope & Migration Impact
* **New Models**:
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
* Adds relation `votes SentimentVote[]` to `User`. No changes or locks on existing tables.

#### 4. Proposed Behavior [DECISIONS AWAITING APPROVAL]
* **[AWAITING APPROVAL] Fixed Minimum Sample Threshold**:
  * Exactly **$N_{\min} = 5$** across all environments (test, development, production alike).
* **[AWAITING APPROVAL] Distinguishing Zero Votes from Insufficient Sample**:
  * **`ZERO_VOTES`**: Total votes in window $T = 0 \implies \text{classification} = \mathbf{NO\_DATA}$, `status: "ZERO_VOTES"`, `sampleThresholdMet: false`.
  * **`INSUFFICIENT_SAMPLE`**: $0 < T < 5 \implies \text{classification} = \mathbf{NO\_DATA}$, `status: "INSUFFICIENT_SAMPLE"`, `sampleThresholdMet: false`.
  * **`SAMPLE_MET`**: $T \ge 5 \implies `sampleThresholdMet: true`.
* **[AWAITING APPROVAL] Treatment of Neutral Votes**:
  * Total denominator includes neutral votes: $T = B + R + N$.
  * Percentage shares: $p_B = \frac{B}{T} \times 100, \quad p_R = \frac{R}{T} \times 100, \quad p_N = \frac{N}{T} \times 100$.
  * Consensus classification when $T \ge 5$:
    * **`BULLISH`**: $p_B > 50\%$ and $B > R$.
    * **`BEARISH`**: $p_R > 50\%$ and $R > B$.
    * **`NEUTRAL`**: Neither Bullish nor Bearish criteria met (e.g. Neutral votes dominate or neither Bullish nor Bearish achieves $> 50\%$).
* **[AWAITING APPROVAL] Treatment of Vote Updates across Time Windows**:
  * Supported windows: `24h`, `7d`, `30d`, `ALL`.
  * Bounded windows filter strictly by `updatedAt >= windowStart`.
  * When a user changes their vote, `updatedAt = now()`. The updated vote reflects their current opinion and immediately enters the `24h` window. Older, un-updated votes naturally age out of `24h` and `7d` into `ALL`.

#### 5. Alternatives Considered
* **Alternative A (Continuous Score $[-1.0, +1.0]$)**:
  * Score $= \frac{B - R}{T}$.
  * *Drawback*: Ignores `NEUTRAL` votes in numerator, treating neutral voters identically to non-voters.
* **Alternative B (Binary Bullish/Bearish Only)**:
  * *Drawback*: Violates `docs/FEATURES.md` and `docs/DATABASE.md`, which explicitly define `NEUTRAL`.

#### 6. Decision Still Needed
* Maintainer confirmation on:
  1. Fixed sample threshold ($N_{\min} = 5$).
  2. Consensus classification rules and neutral vote treatment.
  3. Window filtering based on `updatedAt`.

---

## Commit Sequence & Execution Roadmap

1. `docs(task-47): record current behavior and open product decisions` *(Committed: 34fad5a)*
2. `test(leaderboard): cover snapshot refresh invariants` *(Committed: 6a8381b)*
3. `docs(task-47): revise product decision sheet with recommendations and impact analysis` *(Committed: ce5c641)*
4. `feat(workers): schedule leaderboard snapshot refreshes` *(Canonical in-process worker; pending Decision 2 approval)*
5. `feat(competitions): implement approved scoring rules` *(Requires Decision 1 approval & migration)*
6. `feat(achievements): add approved idempotent trigger rules` *(Requires Decision 3 approval & migration)*
7. `feat(api): expose stored leaderboard history` *(Requires Decision 4 approval)*
8. `feat(social): rank feed using approved signals` *(Requires Decision 5 approval)*
9. `feat(notifications): cover approved order lifecycle transitions` *(Requires Decision 6 approval & migration)*
10. `feat(sentiment): aggregate votes by approved windows` *(Requires Decision 7 approval & migration)*
11. `test(task-47): cover cross-feature regressions`
12. `docs(task-47): document approved APIs and operations`
13. `docs(task-47): record final verification`
