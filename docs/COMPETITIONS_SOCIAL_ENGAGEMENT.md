# 🏆 Task 47: Competition, Social & Engagement Architecture

> Baseline analysis, existing code inventory, gap analysis, and open product decision sheet for Issues #128, #129, #130, #131, #132, #133, and #134.

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
- [Commit Sequence & Execution Roadmap](#commit-sequence--execution-roadmap)

---

## Executive Summary

Task 47 encompasses seven related features across competitions, leaderboards, social engagement, and trading lifecycle notifications. 

A thorough review of `main` reveals that while certain foundation elements exist (such as `LeaderboardSnapshot`, in-app `createOrderExecutedNotification`, and chronological post feeds), significant architectural gaps and unmounted routes exist across competitions/leagues, achievements, historical leaderboard queries, feed ranking algorithms, non-executed order notifications, and market sentiment aggregation.

Per project instructions, we establish this source-backed inventory and decision sheet prior to implementing ambiguous contracts.

---

## Source-Backed Existing Code Inventory

### 47.1 Competition Scoring Rules (#128)
- **Current Main Implementation**:
  - `backend/prisma/schema.prisma` defines `OrderSource.LEAGUE` (line 33) and `NotificationType.LEAGUE_UPDATE` (line 47).
  - No database models exist for `League`, `Competition`, `LeagueMember`, or competition rules in `schema.prisma` or migrations.
  - No services, controllers, or routes exist in `backend/src/` for leagues or competitions.
  - `docs/DATABASE.md` (lines 270-305) and `docs/FEATURES.md` (lines 140-165) document a prospective design where leagues have start/end dates, starting balances, and participants receive league portfolios.
- **Identified Gaps**:
  - Requires Prisma model definitions (`League`, `LeagueMember`) and migration.
  - Requires deterministic scoring calculation service evaluating participant portfolio return during the competition window.
  - Requires validation of start/end boundaries, tie-breaking, and minimum trade activity rules.

### 47.2 Leaderboard Refresh Job (#129)
- **Current Main Implementation**:
  - `backend/src/services/leaderboardService.js` provides `generateLeaderboardSnapshots({ date })`:
    - Normalizes dates to UTC midnight: `normalizeSnapshotDate(date)`.
    - Iterates over active users (`isSuspended: false`).
    - Calculates starting balance, cash, and invested holding basis (`totalInvested`).
    - Calculates period P&L from trades in UTC date ranges (`DAILY`, `WEEKLY`, `MONTHLY`, `ALL_TIME`).
    - Computes `returnPct = (periodPnl / startingBalance) * 100` (4 decimals) and `totalValue` (8 decimals).
    - Sorts deterministically: `returnPct DESC`, `totalValue DESC`, `userId ASC`.
    - Persists snapshots into `LeaderboardSnapshot` and `LeaderboardEntry` within `prisma.$transaction`.
  - `backend/scripts/generate-leaderboard-snapshots.js` provides a CLI runner (`npm run leaderboard:snapshot`).
- **Identified Gaps**:
  - **CRITICAL GAP**: `backend/src/workers/index.js` does NOT schedule or run leaderboard snapshot generation!
  - `backend/src/workers/index.js` only launches `orderWorker` / `queueWorker` and `portfolioSnapshotWorker` (for `PerformanceSnapshot`).
  - There is no scheduled recurring job (neither BullMQ repeatable job nor in-process polling worker) running `generateLeaderboardSnapshots`.

### 47.3 Achievement Trigger Rules (#130)
- **Current Main Implementation**:
  - `NotificationType` enum includes `ACHIEVEMENT_UNLOCKED`.
  - No `Achievement` or `UserAchievement` tables exist in Prisma or database migrations.
  - No achievement service, trigger rules, or evaluation hooks exist in `backend/src/`.
  - `docs/API.md` and `docs/DATABASE.md` describe speculative endpoints (`GET /achievements`, `GET /achievements/mine`) and schemas (`Achievement`, `UserAchievement`).
- **Identified Gaps**:
  - Requires Prisma models (`Achievement`, `UserAchievement`) with `@@unique([userId, achievementId])`.
  - Requires event-driven trigger rules (e.g. on trade execution, follow, portfolio milestone) that grant achievements idempotently and emit `ACHIEVEMENT_UNLOCKED` notifications.

### 47.4 Leaderboard History API (#131)
- **Current Main Implementation**:
  - `backend/src/routes/leaderboardRoutes.js` registers:
    - `GET /api/v1/leaderboard` (latest global snapshot)
    - `GET /api/v1/leaderboard/friends` (friends filtered from latest global snapshot)
  - `LeaderboardSnapshot` and `LeaderboardEntry` models exist and store historical runs indexed by `[scope, period, snapshotDate]`.
- **Identified Gaps**:
  - No endpoint exists to query historical leaderboard snapshots by date or range.
  - Requires route `GET /api/v1/leaderboard/history` with date filtering, period validation, pagination, and deterministic ordering from stored snapshots.

### 47.5 Social Feed Ranking (#132)
- **Current Main Implementation**:
  - `backend/src/services/socialService.js#getFeed` queries posts with `where: { isHidden: false }` ordered strictly by `createdAt: "desc"`.
  - Includes `_count: { likes: true }` and author public profile.
- **Identified Gaps**:
  - Feed is currently purely chronological; no engagement ranking signals, recency decay, or author relationship boosts exist.
  - Suspended authors (`isSuspended: true`) are not currently filtered out of `getFeed`.
  - Requires ranking algorithm balancing engagement (likes), relationship (following), and recency decay.

### 47.6 Order-Execution Notifications (#133)
- **Current Main Implementation**:
  - `backend/src/services/notificationEvents.js#createOrderExecutedNotification` writes an in-app `ORDER_EXECUTED` notification row.
  - Called from `tradeService.js` (lines 582-586) after the trade transaction commits.
- **Identified Gaps**:
  - `OrderStatus` has enum values `PENDING`, `EXECUTED`, `CANCELLED`, `EXPIRED`, `REJECTED`.
  - Currently, terminal non-executed states (`CANCELLED`, `EXPIRED`, `REJECTED`) do NOT create in-app notifications.
  - `NotificationType` enum currently only contains `ORDER_EXECUTED` and lacks `ORDER_CANCELLED`, `ORDER_REJECTED`, and `ORDER_EXPIRED`.
  - Requires enum migration or mapping, and post-commit notification hooks for order cancellations, rejections, and expirations.

### 47.7 Sentiment Aggregation (#134)
- **Current Main Implementation**:
  - No `SentimentVote` model exists in Prisma or database migrations.
  - No sentiment routes or services exist in `backend/src/`.
  - `docs/DATABASE.md` and `docs/API.md` describe speculative routes (`GET /sentiment/:symbol`, `POST /sentiment/:symbol/vote`) and `model SentimentVote`.
- **Identified Gaps**:
  - Requires Prisma model (`SentimentVote`) with unique constraint on `[userId, symbol]`.
  - Requires voting endpoint and aggregation service calculating bullish/bearish percentages, sample thresholds, and neutral/no-data classifications across time windows.

---

## Maintainer Product Decision Sheet

The following concrete proposals are presented for maintainer confirmation before implementing ambiguous behavior:

### 1. Competition Scoring (#128)
- **Proposed Scoring Metric**: Portfolio percentage return over the competition duration:
  $$\text{Return \%} = \frac{\text{Current Value} - \text{Starting Balance}}{\text{Starting Balance}} \times 100$$
- **Portfolio Isolation**: Each participant enters with an isolated competition portfolio (`isDefault: false`, `OrderSource.LEAGUE`) initialized with the league's `startingBalance`. Cash deposits and withdrawals are disallowed to prevent return distortion.
- **Time Boundary & Trades**: Only trades executed between `startDate` and `endDate` (inclusive UTC) are included.
- **Open Holdings Valuation**: Valued at market price / latest quote close as of the scoring calculation timestamp.
- **Inactive Participants**: Participants with 0 trades are recorded at 0.00% return and placed below active participants with 0.00% return.
- **Tie-Breaker Hierarchy**: 1) `returnPct DESC`, 2) `totalValue DESC`, 3) `tradeCount DESC`, 4) `userId ASC`.
- **Late Joins**: Allowed if league status is `ACTIVE` and current time < `endDate`, starting with the default starting balance.

### 2. Leaderboard Refresh Job (#129)
- **Cadence**: Daily at 02:00 UTC (immediately following the 00:00–02:00 UTC portfolio snapshot settlement window) so end-of-day portfolio valuations are settled.
- **Scopes & Periods**: `GLOBAL` scope for `DAILY`, `WEEKLY`, `MONTHLY`, and `ALL_TIME`.
- **Transport Architecture**: Dual transport matching existing Stox worker conventions:
  - If `QUEUES_ENABLED=true`: BullMQ repeatable job on `notifications` or dedicated scheduler.
  - If `QUEUES_ENABLED=false`: In-process timer loop in `backend/src/workers/leaderboardWorker.js` started via `backend/src/workers/index.js`.
- **Rerun Idempotency**: Reuse existing transaction-wrapped snapshot upsert and entry replacement; repeat executions safely overwrite existing records for that date.

### 3. Achievement Rules (#130)
- **Supported Initial Catalog (MVP)**:
  1. `FIRST_TRADE`: Executed at least 1 trade.
  2. `CENTURION`: Executed at least 100 trades.
  3. `PROFIT_MAKER`: Realized cumulative net profit exceeding $1,000.
  4. `DIVERSIFIED`: Holds active positions across 5 or more distinct symbols.
  5. `SOCIAL_BUTTERFLY`: Follows at least 5 other active traders.
- **Evaluation Mechanism**: Event-driven post-commit hooks triggered after trade execution (`tradeService`) and follow actions (`socialService`).
- **Revocation**: Permanent once unlocked; never revoked.
- **Idempotency**: Unique constraint `@@unique([userId, achievementId])`. Grants use safe upserts (`ON CONFLICT DO NOTHING`).
- **Side Effects**: Automatically generates an in-app `Notification` of type `ACHIEVEMENT_UNLOCKED`.

### 4. Leaderboard History API (#131)
- **Endpoint**: `GET /api/v1/leaderboard/history`
- **Query Parameters**:
  - `period`: enum (`DAILY`, `WEEKLY`, `MONTHLY`, `ALL_TIME`), default `ALL_TIME`.
  - `date`: optional `YYYY-MM-DD` date string (defaults to latest available historical snapshot date).
  - `page`: default 1, `limit`: default 20 (max 100).
- **Semantics**: Reads exclusively from persisted `LeaderboardSnapshot` and `LeaderboardEntry` tables. Never recalculates historical rankings dynamically.
- **Empty / Missing Behavior**: Returns empty pagination result `{ leaderboard: [], pagination: ... }` if no snapshot exists on the requested date.
- **Auth**: Requires standard bearer authentication (`authMiddleware`).

### 5. Social Feed Ranking (#132)
- **Ranking Signals**:
  - Engagement: total like count (`postLikeCount`).
  - Author relationship: $+2$ engagement boost if author is followed by the viewing user.
  - Recency Decay: age in hours since `createdAt`.
- **Proposed Gravity Decay Formula**:
  $$\text{Score} = \frac{\text{likes} + 1 + (\text{isFollowing} ? 2 : 0)}{(\text{ageHours} + 2)^{1.2}}$$
- **Query Parameter**: `GET /api/v1/social/feed?sort=trending` (default) vs `?sort=latest` (chronological).
- **Safety & Performance**:
  - Filters out `isHidden: true` posts and suspended authors (`author.isSuspended: false`).
  - Limits ranking computation to posts created within the last 30 days to avoid full-table scans. Older posts remain accessible via `sort=latest`.

### 6. Execution Notifications (#133)
- **Supported Order Transitions**:
  - `EXECUTED`: (existing, preserved)
  - `CANCELLED`: Order cancelled by user or system.
  - `REJECTED`: Order rejected (insufficient funds, circuit breaker, or max attempts exceeded).
  - `EXPIRED`: Order expired (time-in-force expiration).
- **Prisma Schema Update**:
  - Add `ORDER_CANCELLED`, `ORDER_REJECTED`, and `ORDER_EXPIRED` to `NotificationType` enum via migration (or consolidate under `ORDER_STATUS` with event payload).
- **Idempotency & Delivery**:
  - Emitted strictly post-commit from `orderService.js` and `orderWorker.js`.
  - Idempotent by recording notification metadata (`orderId`, `status`) to avoid duplicate notifications on worker retries.
  - Respects user notification preferences if configured.

### 7. Sentiment Aggregation (#134)
- **Model**: `SentimentVote` (`userId`, `symbol`, `sentiment: BULLISH | BEARISH`, timestamps) with `@@unique([userId, symbol])`.
- **Voting Semantics**: 1 vote per user per symbol; subsequent votes update existing vote (`upsert`).
- **Aggregation Windows**: `GET /api/v1/sentiment/:symbol?window=all` (supports `24h`, `7d`, `30d`, `all`).
- **Sample Threshold**: Minimum 3 votes (`MIN_VOTES = 3`). If `totalVotes < 3`, returns `sentiment: "NO_DATA"`.
- **Classification**:
  - Bullish: `bullishPct > 55%`
  - Bearish: `bearishPct > 55%`
  - Neutral: `45% <= bullishPct <= 55%` (when sample threshold is met).
- **Response Shape**:
  ```json
  {
    "symbol": "AAPL",
    "window": "all",
    "totalVotes": 12,
    "bullishVotes": 8,
    "bearishVotes": 4,
    "bullishPct": "66.67",
    "bearishPct": "33.33",
    "sentiment": "BULLISH",
    "userVote": "BULLISH"
  }
  ```

---

## Commit Sequence & Execution Roadmap

1. `docs(task-47): record current behavior and open product decisions` *(This document)*
2. `test(leaderboard): cover snapshot refresh invariants` *(Independent coverage for existing leaderboard service)*
3. `feat(workers): schedule leaderboard snapshot refreshes` *(Implement recurring refresh worker)*
4. `feat(competitions): implement approved scoring rules` *(Implement #128 after approval)*
5. `feat(achievements): add approved idempotent trigger rules` *(Implement #130 after approval)*
6. `feat(api): expose stored leaderboard history` *(Implement #131 after approval)*
7. `feat(social): rank feed using approved signals` *(Implement #132 after approval)*
8. `feat(notifications): cover approved order lifecycle transitions` *(Implement #133 after approval)*
9. `feat(sentiment): aggregate votes by approved windows` *(Implement #134 after approval)*
10. `test(task-47): cover cross-feature regressions`
11. `docs(task-47): document approved APIs and operations`
12. `docs(task-47): record final verification`
