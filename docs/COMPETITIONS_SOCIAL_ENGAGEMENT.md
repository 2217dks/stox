# 🏆 Task 47: Competition, Social & Engagement Architecture

> Baseline analysis, existing code inventory, gap analysis, and Maintainer Product Decision Sheet for Issues #128, #129, #130, #131, #132, #133, and #134.

---

## 📌 Table of Contents

- [Executive Summary](#executive-summary)
- [Verification Evidence](#verification-evidence)
- [Maintainer Product Decision Sheet](#maintainer-product-decision-sheet)
  - [47.1 Competition Scoring Rules (#128)](#471-competition-scoring-rules-128)
  - [47.2 Leaderboard Refresh Job (#129)](#472-leaderboard-refresh-job-129)
  - [47.3 Achievement Trigger Rules (#130)](#473-achievement-trigger-rules-130)
  - [47.4 Leaderboard History API (#131)](#474-leaderboard-history-api-131)
  - [47.5 Social Feed Ranking (#132)](#475-social-feed-ranking-132)
  - [47.6 Order-Execution Notifications (#133)](#476-order-execution-notifications-133)
  - [47.7 Sentiment Aggregation (#134)](#477-sentiment-aggregation-134)
- [Summary of Decisions Awaiting Approval](#summary-of-decisions-awaiting-approval)

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

## Verification Evidence

The test suite was executed locally on `feature/task-47-competition-social-engagement` at `2026-11-16T10:17:15+05:30`:

1. **Targeted Invariant Test Suite**:
   * Command: `cd backend && npm test -- tests/unit/services/leaderboardSnapshotService.test.js tests/integration/leaderboard.integration.test.js`
   * Result: **2 passed, 2 total** (35 tests passed, 0 failures, 0 snapshots).
   * Verifies: UTC date normalization across boundaries, leap days, multi-level tie-breaking, negative return rankings, transaction rollback isolation, and suspended user exclusion.
2. **Full Backend Test Suite**:
   * Command: `cd backend && npm test -- --runInBand`
   * Result: **104 passed, 104 total** (1,382 tests passed, 0 failures, 0 snapshots in 54.854s).

---

## Maintainer Product Decision Sheet

### 47.1 Competition Scoring Rules (#128)

#### 1. Existing Implementation Evidence
* `backend/prisma/schema.prisma` (line 57): `OrderSource` enum contains `LEAGUE`.
* `backend/prisma/schema.prisma` (line 79): `NotificationType` enum contains `LEAGUE_UPDATE`.
* `docs/FEATURES.md` (lines 285–310): Trading leagues defined with `name`, `startDate`, `endDate`, `startingBalance`, `maxParticipants`, statuses (`UPCOMING`, `ACTIVE`, `COMPLETED`, `CANCELLED`), and league-specific portfolios.
* `docs/DATABASE.md` (lines 570–616): Documents prospective `League` and `LeagueMember` models.
* `backend/src/services/portfolioValuationService.js`: `calculatePortfolioValuation()` evaluates mark-to-market holdings value with non-zero pricing invariants (surfacing 503 if quote fails).
* `backend/src/services/portfolioSnapshotService.js`: Daily EOD valuation snapshots.
* *Critical Gap*: Neither `League` nor `LeagueMember` models exist in `schema.prisma` or database migrations. No competition scoring logic or routes exist in `backend/src/`.

#### 2. Exact Remaining Work
* Add Prisma models `League`, `LeagueMember`, and enum `LeagueStatus` via migration.
* Implement `backend/src/services/competitionService.js` with deterministic scoring calculation, boundary checks, and tie-breaking.
* Unit/integration tests for scoring calculation, edge boundaries, tie breaks, and zero-activity participants.

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
* **Impact on Existing Tables**: Adds relation `leagueMembers LeagueMember[]` to `User` and `leagueMember LeagueMember?` to `Portfolio`. Existing users and default portfolios remain untouched; zero data backfill required.

#### 4. Proposed Behavior [DECISIONS AWAITING APPROVAL]
* **[Awaiting Approval] Scoring Metric**: Total percentage return based on mark-to-market valuation:
  $$\text{Return \%} = \frac{\text{Current Valuation} - \text{startingBalance}}{\text{startingBalance}} \times 100$$
  * *Active leagues*: $\text{Current Valuation}$ computed via `calculatePortfolioValuation()` using live quotes.
  * *End-Date Valuation*: Once $T \ge \text{endDate}$ (or status is `COMPLETED`), portfolio holdings are frozen and valued using the historical market close as of `endDate` 23:59:59.999Z. Upon completion, `finalReturn` and `rank` are persisted to `LeagueMember`, making final competition outcomes immutable.
* **[Awaiting Approval] Boundary & Out-of-Range Trades**:
  * The scoring calculation strictly filters and excludes trades where `executedAt < startDate` or `executedAt > endDate`.
  * Out-of-range trades do not affect the score unless the maintainer explicitly approves modifying `orderService` to reject order execution for league portfolios outside the active competition window.
* **[Awaiting Approval] Late-Join Policy**:
  * Late joins are permitted while status is `ACTIVE` and current time $< \text{endDate}$.
  * The late joiner begins with the full competition `startingBalance` in cash. Their score is calculated against the same base starting balance, ensuring no distortion of percentage returns.
* **[Awaiting Approval] Insufficient Activity**:
  * Participants with 0 trades maintain their starting balance ($0.00\%$ return) and are ranked below participants who traded and achieved $\ge 0.00\%$ return.
* **[Awaiting Approval] Deterministic Tie-Breakers**:
  * 1) `returnPct DESC`, 2) `totalValue DESC`, 3) `tradeCount DESC`, 4) `joinedAt ASC`, 5) `userId ASC`.

#### 5. Alternatives Considered
* **Alternative A (Realized P&L Only)**: Closed-trade cash gains only. *(Drawback: penalizes swing/position traders with winning open holdings).*
* **Alternative B (TWRR)**: Time-weighted return. *(Drawback: because external deposits/withdrawals are disallowed in league portfolios, TWRR mathematically simplifies to standard percentage return).*

#### 6. Decision Still Needed
* Maintainer confirmation on:
  1. Adopting mark-to-market percentage return vs realized P&L only.
  2. Late-join policy (permitted with standard starting balance vs disallowed after start).
  3. Tie-breaker hierarchy and zero-trade rank demotion.
  4. Confirming that out-of-range trades are filtered out at the scoring level (vs rejecting order execution).

---

### 47.2 Leaderboard Refresh Job (#129)

#### 1. Existing Implementation Evidence & Actual Data Inputs
* Tracing `backend/src/services/leaderboardService.js` (`generateLeaderboardSnapshots`):
  * **Input 1**: Queries `portfolio.startingBalance`, `portfolio.cashBalance`, and `holding.totalInvested` (cost basis, NOT live quotes) directly from `Portfolio` and `Holding` tables for active users.
  * **Input 2**: Queries `trade.realizedPnl` from `Trade` table where `executedAt >= periodStart && executedAt < nextDay`.
  * **Calculations**:
    * `DAILY`, `WEEKLY`, `MONTHLY`: `periodPnl = sum(trade.realizedPnl)`, `returnPct = (periodPnl / startingBalance) * 100`.
    * `ALL_TIME`: `totalValue = cashBalance + holdings.totalInvested`, `periodPnl = totalValue - startingBalance`, `returnPct = (periodPnl / startingBalance) * 100`.
  * **Output**: Persists snapshots to `LeaderboardSnapshot` and `LeaderboardEntry` within `prisma.$transaction`.
* `backend/src/workers/portfolioSnapshotWorker.js`: In-process worker generating `PerformanceSnapshot` (capturing market-valued portfolio balances per portfolio) during 00:00–02:00 UTC.
* *Critical Gap*: `backend/src/workers/index.js` does NOT schedule or run leaderboard snapshot generation.

#### 2. Exact Remaining Work
* Implement `backend/src/workers/leaderboardSnapshotWorker.js` and register it in `backend/src/workers/index.js` with lifecycle shutdown.
* Define explicit missing-snapshot and failure-handling policies that preserve identical scoring semantics without reporting partial snapshots.

#### 3. Scope & Migration Impact
* No database migration. Worker orchestration update only.

#### 4. Proposed Behavior [DECISIONS AWAITING APPROVAL]
* **[Awaiting Approval] Canonical Transport**: Single **in-process scheduled worker** (`leaderboardSnapshotWorker.js`) started in `backend/src/workers/index.js`. No dual transport or BullMQ Redis scheduler. Runs identically in CI (`QUEUES_ENABLED=false`), local dev, and production.
* **[Awaiting Approval] Cadence & Settlement Window**:
  * Daily at **02:00 UTC** targeting yesterday ($T - 1$).
  * *Rationale*: Runs immediately after the 00:00–02:00 UTC window of `portfolioSnapshotWorker`.
* **[Awaiting Approval] Preserved Semantics & Missing-Snapshot Policy**:
  * *The Semantics Problem*: `leaderboardService.js` computes period returns from `Trade` rows and portfolio basis. If leaderboard refresh depends on EOD portfolio snapshots, a failure cannot silently switch to live intraday values for some users, nor can it omit failing users, as that would report a corrupted or partial snapshot.
  * **Policy Option A (Strict Verification with Scheduled Retry & Skip — Recommended)**:
    1. At 02:00 UTC, check whether all active portfolios have completed EOD settlement for date $D$.
    2. If any portfolio is missing, retry up to 3 times with 15-minute backoff (02:15, 02:30, 02:45 UTC).
    3. If still missing at 03:00 UTC, **skip leaderboard snapshot generation for date $D$** and log a high-priority alert. Do NOT write a partial snapshot or switch valuation sources for a subset of users. The API continues serving the previous valid snapshot until operators resolve the missing portfolio data.
  * **Policy Option B (Decoupled Direct Calculation)**:
    * Compute leaderboard snapshots purely from immutable historical `Trade` records in $[periodStart, nextDay)$ and snapshot baseline tables, completely decoupled from `PerformanceSnapshot`. Runs reliably without waiting for or depending on external snapshot tables.
* **[Awaiting Approval] Rerun Idempotency**: `generateLeaderboardSnapshots` uses `upsert` on snapshot and replaces entries in `prisma.$transaction`. Reruns safely refresh without duplicates.

#### 5. Alternatives Considered
* **Alternative A (BullMQ Repeatable Job)**: Adds Redis scheduler dependency, breaking `QUEUES_ENABLED=false` setups.
* **Alternative B (Silent Fallback to Live Values)**: Rejected per maintainer instructions (pollutes historical EOD results with live intraday data).

#### 6. Decision Still Needed
* Maintainer confirmation on:
  1. In-process worker transport at 02:00 UTC.
  2. Selecting missing-snapshot policy: Policy Option A (Strict verify with retry and skip) vs Policy Option B (Decoupled direct calculation).

---

### 47.3 Achievement Trigger Rules (#130)

#### 1. Existing Implementation Evidence
* `backend/prisma/schema.prisma` (line 77): Enum `NotificationType.ACHIEVEMENT_UNLOCKED`.
* `docs/FEATURES.md` (lines 312–326): Examples (`First Trade`, `First Profit`, `10 Successful Trades`, `Portfolio Milestone`, `League Winner`, `Consistent Trader`).
* `docs/DATABASE.md` (lines 535–567): Prospective `Achievement` and `UserAchievement` schemas.
* *Critical Gap*: Neither `Achievement` nor `UserAchievement` tables exist in Prisma.

#### 2. Exact Remaining Work
* Add `Achievement` and `UserAchievement` models to Prisma schema via migration.
* Seed baseline achievement definitions in `backend/prisma/seed.js`.
* Implement durable trigger handler and scheduled reconciliation worker.
* Connect post-commit hooks in `tradeService.js` and `socialService.js`.

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
* **[Awaiting Approval] Durable Post-Commit Approach & Crash Recovery**:
  * *Transaction Boundary*: Trades commit first. Trade financial execution NEVER fails or rolls back due to achievement processing.
  * *Immediate Hook*: Immediately post-commit, `await evaluateAndGrantAchievements(userId, { trade, order })` executes in `tradeService.js`.
  * *Durable Scheduled Crash Recovery*:
    * To ensure achievements survive any process crash, network abort, or unhandled exception between trade commit and achievement recording, a dedicated **scheduled reconciliation job** (`reconcileAchievementsJob`) runs on a recurring schedule (e.g. hourly, or at worker startup):
      1. Identifies active users whose cumulative trade statistics qualify for an achievement.
      2. Compares against existing `UserAchievement` records.
      3. Safely awards missing achievements.
  * *Idempotency Boundaries*:
    * `UserAchievement` has `@@unique([userId, achievementId])`.
    * Grants use `prisma.userAchievement.create` catching duplicate key constraint (`P2002`). Running multiple times or retrying is completely idempotent.
    * Notification creation is tied to the successful row insertion, guaranteeing zero duplicate unlock notifications.
* **[Awaiting Approval] Catalog & Proposed Thresholds**:
  1. `FIRST_TRADE`: Executed at least 1 trade (`totalTrades >= 1`). *[Proposed]*
  2. `FIRST_PROFIT`: Closed at least 1 trade with `realizedPnl > 0`. *[Proposed]*
  3. `TEN_SUCCESSFUL_TRADES`: Closed at least 10 trades with `realizedPnl > 0`. *[Proposed]*
  4. `PORTFOLIO_MILESTONE`: Total portfolio value crosses $\ge \$25,000$ (from $\$10,000$). *[Proposed]*
  5. *(Optional / Phase 2)*: `LEAGUE_WINNER`: Placed 1st in a completed league. *[Optional - Proposed]*
  6. *(Optional / Phase 2)*: `CONSISTENT_TRADER`: Traded across 5 distinct consecutive calendar days. *[Optional - Proposed]*

#### 5. Alternatives Considered
* **Alternative A (Ephemeral `setImmediate`)**: Rejected per maintainer instructions (in-memory callbacks are lost if Node.js restarts).
* **Alternative B (Dedicated Outbox Table)**: Extra table and queue when idempotent post-commit execution with a scheduled reconciliation worker achieves identical durability.

#### 6. Decision Still Needed
* Maintainer confirmation on:
  1. Approval of the durable post-commit hook + scheduled reconciliation worker architecture.
  2. Approval of the 4 core achievements and the $25,000 portfolio milestone threshold.
  3. Whether to defer `LEAGUE_WINNER` and `CONSISTENT_TRADER` to Phase 2.

---

### 47.4 Leaderboard History API (#131)

#### 1. Existing Implementation Evidence
* `backend/src/routes/leaderboardRoutes.js`: Exposes `GET /api/v1/leaderboard` (latest global) and `GET /api/v1/leaderboard/friends`.
* `backend/prisma/schema.prisma` (lines 500–526): `LeaderboardSnapshot` and `LeaderboardEntry` tables indexed by `[scope, period, snapshotDate]`.
* **Important Implementation Fact**:
  * In `leaderboardService.js`, snapshots are written strictly with `scope: "GLOBAL"`.
  * `FRIENDS` leaderboards are **never stored as snapshots**; they are computed dynamically on read by taking the current `GLOBAL` snapshot and filtering by the caller's followed users.
* *Critical Gap*: No route or service exists to query stored historical snapshots by date or date range.

#### 2. Exact Remaining Work
* Implement `getHistoricalLeaderboard` service in `leaderboardService.js`.
* Mount route `GET /api/v1/leaderboard/history` in `leaderboardRoutes.js`.
* Query validation schema and integration test suite.

#### 3. Scope & Migration Impact
* No database migration. Reuses existing `LeaderboardSnapshot` and `LeaderboardEntry` tables.

#### 4. Proposed Behavior [DECISIONS AWAITING APPROVAL]
* **[Awaiting Approval] Supported Scopes**:
  * Because stored snapshots exist **only for `scope: "GLOBAL"`**, historical date queries read from the stored `GLOBAL` snapshots.
  * If a caller requests `scope=FRIENDS`, the API reads the stored `GLOBAL` snapshot for that date, filters by the caller's friends, and re-ranks.
* **[Awaiting Approval] Endpoint & Query Parameters**:
  * `GET /api/v1/leaderboard/history`
  * Parameters:
    * `period`: `DAILY`, `WEEKLY`, `MONTHLY`, `ALL_TIME` (default: `ALL_TIME`).
    * `scope`: `GLOBAL` (default) or `FRIENDS`.
    * `date`: optional `YYYY-MM-DD` (single snapshot date).
    * `from` & `to`: optional `YYYY-MM-DD` (date range).
    * `page`: default 1 (bounded $\ge 1$).
    * `limit`: default 20 (bounded $1 \le \text{limit} \le 100$).
* **[Awaiting Approval] Preservation of Stored Ranks Under Visibility Filtering**:
  * The `rank` field in each entry was recorded when the snapshot was generated; it is returned verbatim.
  * If an account was subsequently suspended (`author.isSuspended: true`), filtering them out omits their record, but **preserves the exact stored ranks of remaining users** (e.g. Rank 1 and Rank 3 are shown; Rank 3 is NOT shifted to Rank 2). This guarantees historical consistency with stored records.
* **[Awaiting Approval] Response Structure**:
  * Returns **historical ranked entries** (`LeaderboardEntry`) for the requested snapshot dates:
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
* **Alternative A (Dynamic Recalculation)**: Violates issue #131's mandate to read stored snapshots.
* **Alternative B (Shifting Ranks on Suspension)**: Re-ranking entries when a suspended user is filtered corrupts historical records.

#### 6. Decision Still Needed
* Maintainer confirmation on:
  1. Scope support: Restrict stored historical queries to `scope: "GLOBAL"` vs allowing dynamic `FRIENDS` filtering over historical snapshots.
  2. Preserving stored ranks verbatim with gap preservation when suspended users are omitted.

---

### 47.5 Social Feed Ranking (#132)

#### 1. Existing Implementation Evidence
* `backend/src/services/socialService.js#getFeed`: Queries `Post` with `where: { isHidden: false }` ordered strictly by `createdAt: "desc"`.
* **Existing Indexes Verified in `schema.prisma`**:
  * `Post`: `@@index([authorId, createdAt])`, `@@index([createdAt])`.
  * *(Note: Composite index `[isHidden, createdAt]` does NOT exist).*
  * `PostLike`: `@@unique([postId, userId])`, `@@index([userId, createdAt])`.
* *Critical Gap*: No ranking signals, recency decay, or author affinity. Suspended authors are not filtered.

#### 2. Exact Remaining Work
* Implement ranking algorithm in `socialService.js`.
* Add query parameter `sort=trending|latest` (default: `trending`).
* Add author suspension filtering (`author: { isSuspended: false }`).

#### 3. Scope & Migration Impact
* No schema migration required initially (uses existing `@@index([createdAt])` on `Post`).

#### 4. Proposed Behavior [DECISIONS AWAITING APPROVAL]
* **[Awaiting Approval] Bounded Candidate Selection**:
  * For `sort=trending`, query candidates using existing `@@index([createdAt])`:
    `where: { isHidden: false, author: { isSuspended: false }, createdAt: { gte: candidateWindowStart } }`, ordered by `createdAt: 'desc'`, with hard cap: `take: 200` (`MAX_CANDIDATES = 200`).
  * *Bounded Row Count*: PostgreSQL index scan on `createdAt` limits rows examined.
  * *Bounded Memory*: Node.js evaluates decay scores for at most 200 candidate posts.
* **[Awaiting Approval] Ranking Signals & Formula**:
  * Engagement (likes) + Affinity (+2 if viewing user follows author) divided by age decay:
    $$\text{Score} = \frac{\text{likes} + 1 + (\text{isFollowing} ? 2 : 0)}{(\text{ageHours} + 2)^{1.2}}$$
* **[Awaiting Approval] Pagination Stability Analysis & Recommendation**:
  * *Analysis*: `asOf` freezes recency age decay only. However, concurrent likes (`postLikeCount`) or follow actions can still modify scores during pagination.
  * **Option A (Industry Standard Keyset with Eventual Consistency — Recommended)**:
    * Use keyset/cursor pagination: `(score DESC, createdAt DESC, id ASC)` using `asOf`.
    * Accept that concurrent real-time likes may cause minor edge shifts across page transitions, which is the established standard on Reddit, Hacker News, and Twitter.
  * **Option B (Session Snapshot Token / ID Cache)**:
    * On page 1, cache the ranked array of candidate Post IDs in Redis with a 10-minute session TTL.
    * Page 2+ requests slice from the cached ID list.
    * *Advantage*: 100% immune to concurrent like shifts during that browsing session.
    * *Drawback*: Requires Redis session storage for feed reading.
  * **Option C (Monotonic Chronological Fallback)**:
    * `sort=latest` provides completely monotonic, immutable pagination using `(createdAt DESC, id DESC)`.

#### 5. Alternatives Considered
* **Alternative A (Unbounded SQL Mathematical Ordering)**: Dynamic SQL ordering without candidate caps forces full-table scans.

#### 6. Decision Still Needed
* Maintainer confirmation on:
  1. Candidate pool size (200 rows) and window (7 days).
  2. Pagination stability contract: Option A (Eventual consistency cursor with `asOf`) vs Option B (Session snapshot ID cache in Redis) vs Option C (`sort=latest` default).

---

### 47.6 Order-Execution Notifications (#133)

#### 1. Existing Implementation Evidence
* `backend/src/services/notificationEvents.js#createOrderExecutedNotification`: Writes `ORDER_EXECUTED` notification with structured context in `data: Json`.
* `backend/prisma/schema.prisma` (lines 74–82): Enum `NotificationType` (`ORDER_EXECUTED`, `PRICE_ALERT`, `ACHIEVEMENT_UNLOCKED`, `COPY_TRADE_EXECUTED`, `LEAGUE_UPDATE`, `NEW_FOLLOWER`, `SYSTEM`).
* `backend/prisma/schema.prisma` (lines 45–51): Enum `OrderEventType` (`CREATED`, `EXECUTED`, `CANCELLED`, `EXPIRED`, `REJECTED`).
* *Critical Gap*: Terminal non-executed states (`CANCELLED`, `EXPIRED`, `REJECTED`) do not emit notifications; `NotificationType` enum lacks these types.

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
* **[Awaiting Approval] Adopt Option 1 (Explicit Enum Values)**:
  * Add `ORDER_CANCELLED`, `ORDER_REJECTED`, and `ORDER_EXPIRED` to `NotificationType` in `schema.prisma`.
  * Store structured order context in `Notification.data: Json` (`orderId`, `symbol`, `side`, `quantity`, `price`, `reason`/`notes`).
  * Emitted strictly post-commit from `orderService.js` (for user cancellations) and `orderQueueWorker.js` / `orderWorker.js` (for rejections and expirations).
  * Enforce transition guards so terminal transitions emit exactly once.

#### 5. Alternatives Considered
* **Alternative A (Single Generic `ORDER_UPDATE` Type)**: Requires a breaking rename of existing `ORDER_EXECUTED` enum value.

#### 6. Decision Still Needed
* Maintainer confirmation on adding explicit enum values (`ORDER_CANCELLED`, `ORDER_REJECTED`, `ORDER_EXPIRED`) via migration vs storing status inside `data: Json`.

---

### 47.7 Sentiment Aggregation (#134)

#### 1. Existing Implementation Evidence
* `docs/FEATURES.md` (lines 331–337): Users can vote `BULLISH`, `BEARISH`, `NEUTRAL` for supported symbols.
* `docs/DATABASE.md` (lines 622–637 & 805–809): Prospective `SentimentVote` schema and `enum Sentiment { BULLISH, BEARISH, NEUTRAL }`.
* *Critical Gap*: Neither `SentimentVote` model nor `Sentiment` enum exists in `schema.prisma` or migrations.

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
* **[Awaiting Approval] Fixed Minimum Sample Threshold**: Exactly **$N_{\min} = 5$** across all environments (test, development, production alike).
* **[Awaiting Approval] Distinguishing Zero Votes from Nonzero Insufficient Sample**:
  * **`ZERO_VOTES`**: Total votes $T = 0 \implies \text{classification} = \mathbf{NO\_DATA}$, `status: "ZERO_VOTES"`, `sampleThresholdMet: false`.
  * **`INSUFFICIENT_SAMPLE`**: $0 < T < 5 \implies \text{classification} = \mathbf{NO\_DATA}$, `status: "INSUFFICIENT_SAMPLE"`, `sampleThresholdMet: false` (reports exact count $T$ so clients can display "3/5 votes needed").
  * **`SAMPLE_MET`**: $T \ge 5 \implies \text{classification}$ evaluated, `sampleThresholdMet: true`.
* **[Awaiting Approval] Treatment of Neutral Votes**:
  * Total denominator includes neutral votes: $T = B + R + N$.
  * Percentage shares: $p_B = \frac{B}{T} \times 100, \quad p_R = \frac{R}{T} \times 100, \quad p_N = \frac{N}{T} \times 100$.
  * Consensus classification when $T \ge 5$:
    * **`BULLISH`**: $p_B > 50\%$ and $B > R$.
    * **`BEARISH`**: $p_R > 50\%$ and $R > B$.
    * **`NEUTRAL`**: Neither Bullish nor Bearish criteria met (e.g. Neutral votes dominate or neither Bullish nor Bearish achieves $> 50\%$).
* **[Awaiting Approval] Treatment of Vote Updates across Time Windows**:
  * Supported windows: `24h`, `7d`, `30d`, `ALL`.
  * Bounded windows filter strictly by `updatedAt >= windowStart`.
  * When a user changes their vote, `updatedAt = now()`. The updated vote reflects their active opinion and immediately enters the `24h` window. Older, un-updated votes naturally age out of `24h` and `7d` into `ALL`.

#### 5. Alternatives Considered
* **Alternative A (Continuous Score $[-1.0, +1.0]$)**: Neglects neutral voters in numerator, treating neutral voters identically to non-voters.
* **Alternative B (Binary Bullish/Bearish Only)**: Violates `docs/FEATURES.md` and `docs/DATABASE.md`, which explicitly define `NEUTRAL`.

#### 6. Decision Still Needed
* Maintainer confirmation on:
  1. Fixed sample threshold ($N_{\min} = 5$).
  2. Consensus classification rules and neutral vote treatment.
  3. Window filtering based on `updatedAt`.

---

## Summary of Decisions Awaiting Approval

1. **Competition Scoring (#128)**:
   * Approve mark-to-market percentage return vs realized P&L only.
   * Approve late-join policy (allowed with standard starting balance).
   * Approve tie-breaker hierarchy (`returnPct DESC` $\to$ `totalValue DESC` $\to$ `tradeCount DESC` $\to$ `joinedAt ASC` $\to$ `userId ASC`).
   * Confirm that out-of-range trades are filtered out at the scoring level (vs rejecting order execution).
2. **Leaderboard Refresh (#129)**:
   * Approve canonical in-process worker scheduled at 02:00 UTC.
   * Select missing-snapshot policy: Policy Option A (Strict verify with retry and skip) vs Policy Option B (Decoupled direct calculation).
3. **Achievements (#130)**:
   * Approve durable post-commit hook + scheduled reconciliation worker architecture.
   * Approve the 4 core achievements (`FIRST_TRADE`, `FIRST_PROFIT`, `TEN_SUCCESSFUL_TRADES`, `PORTFOLIO_MILESTONE` at $\$25,000$).
   * Defer `LEAGUE_WINNER` and `CONSISTENT_TRADER` to Phase 2.
4. **Leaderboard History (#131)**:
   * Confirm scope handling: restrict stored historical queries to `scope: "GLOBAL"` (since only global snapshots are stored) vs dynamic `FRIENDS` filtering over historical snapshots.
   * Confirm preserving stored ranks verbatim with gap preservation when suspended users are omitted.
5. **Feed Ranking (#132)**:
   * Approve candidate pool size (200 rows) and window (7 days).
   * Select pagination stability contract: Option A (Eventual consistency cursor with `asOf`) vs Option B (Session snapshot ID cache in Redis) vs Option C (`sort=latest` default).
6. **Order Notifications (#133)**:
   * Approve adding explicit enum values (`ORDER_CANCELLED`, `ORDER_REJECTED`, `ORDER_EXPIRED`) to `NotificationType` via migration vs storing status inside `data: Json`.
7. **Sentiment Aggregation (#134)**:
   * Approve fixed sample threshold ($N_{\min} = 5$) across all environments.
   * Approve consensus classification rules (`ZERO_VOTES` vs `INSUFFICIENT_SAMPLE` vs `BULLISH` / `BEARISH` / `NEUTRAL`).
   * Approve time window filtering based on `updatedAt >= windowStart`.
