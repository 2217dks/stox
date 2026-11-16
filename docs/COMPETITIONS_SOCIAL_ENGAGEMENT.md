# 🏆 Task 47: Competition, Social & Engagement Architecture

> Approved specifications, data input tracing, and implementation roadmap for Issues #128, #129, #130, #131, #132, #133, and #134.

---

## 📌 Table of Contents

- [Executive Summary](#executive-summary)
- [Verification Evidence](#verification-evidence)
- [Maintainer Approved Product Decisions](#maintainer-approved-product-decisions)
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

All ambiguous product rules have been formally reviewed and approved by the maintainer. This document records the finalized specifications, data input tracing, consistency policies, and implementation sequence.

---

## Verification Evidence

The complete test suite was executed locally on `feature/task-47-competition-social-engagement`:

1. **Targeted Invariant Test Suite**:
   * Command: `cd backend && npm test -- tests/unit/services/leaderboardSnapshotService.test.js tests/integration/leaderboard.integration.test.js`
   * Result: **2 passed, 2 total** (35 tests passed, 0 failures, 0 snapshots).
   * Verifies: UTC date normalization across boundaries, leap days, multi-level tie-breaking, negative return rankings, transaction rollback isolation, and suspended user exclusion.
2. **Full Backend Test Suite**:
   * Command: `cd backend && npm test -- --runInBand`
   * Result: **108 passed, 108 total** (1,426 tests passed, 0 failures, 0 snapshots in 58.462s).
3. **Cross-Feature End-to-End Integration Suite**:
   * Command: `cd backend && npm test -- tests/integration/task47Integration.test.js`
   * Result: **1 passed, 1 total** (4 tests passed, 0 failures in 2.234s).
   * Verifies: End-to-end trade execution triggers achievements and notifications, limit order cancellation emits notifications, sentiment aggregation across windows, and league registration, scoring, and tie-breaking.

---

## Maintainer Approved Product Decisions

### 47.1 Competition Scoring Rules & Portfolio Isolation (#128, PR #149)

#### Approved & Implemented Behavior
* **Dedicated League Portfolio Isolation**:
  * Every competition participant receives a brand new, dedicated league portfolio initialized with `league.startingBalance` (`isLeague: true`, `startingBalance: league.startingBalance`, `cashBalance: league.startingBalance`).
  * Reusing or linking pre-existing personal portfolios is strictly disallowed (`portfolioId` in join request is rejected with `400 PORTFOLIO_ASSIGNMENT_NOT_SUPPORTED`). This guarantees complete isolation between personal and competition assets and ensures a level playing field.
  * **Atomic Capacity Enforcement**: League membership checks capacity inside a database transaction with an exclusive row lock (`SELECT ... FOR UPDATE` on `League`), preventing concurrent race conditions from exceeding `maxParticipants` (`400 LEAGUE_FULL`).
* **Trading Restrictions for League Portfolios**:
  * **Pre-Start Protection**: Orders placed on league portfolios prior to `startDate` are rejected (`400 LEAGUE_NOT_ACTIVE`).
  * **Post-End Protection**: Orders placed on league portfolios after `endDate` are rejected (`400 LEAGUE_ENDED`).
  * **Prohibition on Short Selling**: Naked short selling is disallowed in league portfolios; sell orders exceeding current held long quantity are rejected with `400 SHORT_SELLING_DISALLOWED`.
* **Scoring Formula & Mark-to-Market Valuation**:
  $$\text{Return \%} = \frac{\text{Current Valuation} - \text{startingBalance}}{\text{startingBalance}} \times 100$$
  * *Fee Deduction*: Portfolio cash balance strictly accounts for trade transaction fees by summing the `Trade.fees` column across all trades.
  * *Position Valuation & Liability*: Long holdings add `quantity * marketPrice`; any existing short position liability is properly deducted from total portfolio valuation (`quantity * marketPrice` where `quantity < 0`).
  * *Strict Market Data Failure Handling*: Live and historical market prices are strictly enforced. If live quotes or historical candle closes cannot be resolved or the provider fails, the service throws `503 MARKET_DATA_PROVIDER_UNAVAILABLE`. Silently falling back to trade execution prices (`lastPrice`) is strictly prohibited, guaranteeing that unverified or corrupted valuations are never presented or persisted.
  * *Arbitrary Precision Arithmetic*: All valuations, return percentages, and leaderboard sorting logic are evaluated using `Prisma.Decimal`, preventing IEEE-754 precision loss.
  * *End-Date Valuation & Finalization*: When $T \ge \text{endDate}$ (or status is `COMPLETED`), holdings are frozen and valued using historical candle close as of `endDate` 23:59:59.999Z. Upon completion, final rankings and returns are persisted to `LeagueMember.rank` and `LeagueMember.finalReturn` inside an atomic `SELECT ... FOR UPDATE` transaction, making final outcomes permanent and immutable.
* **Late-Join Policy**: Late joining after the competition starts is disallowed (`joinedAt <= startDate` required; joining requires status `UPCOMING` and `now < startDate`; returns `400 LEAGUE_ALREADY_STARTED`).
* **Status Lifecycle & UTC Transitions**: League statuses dynamically synchronize at UTC boundaries across all endpoints (`GET /leagues`, `GET /leagues/:id`, `POST /leagues/:id/join`, and `GET /leagues/:id/leaderboard`): `UPCOMING` transitions to `ACTIVE` when $now \ge \text{startDate}$, and `ACTIVE` transitions to `COMPLETED` when $now \ge \text{endDate}$.
* **Tie-Breaker Hierarchy**:
  1. `returnPct DESC`
  2. `totalValue DESC`
  3. `tradeCount DESC`
  4. `joinedAt ASC`
  5. `userId ASC`
* **Zero-Trade Ranking**: No special ranking demotion for zero-trade participants; all participants are ranked strictly by the approved score and tie-breakers.
* **Prisma Schema Scope**: `LeagueStatus` enum (`UPCOMING`, `ACTIVE`, `COMPLETED`, `CANCELLED`), `League`, and `LeagueMember` models.

---

### 47.2 Leaderboard Refresh Job (#129, PR #149)

#### Existing Generator Data Inputs Tracing
* Tracing `backend/src/services/leaderboardService.js#generateLeaderboardSnapshots`:
  * **Input 1**: Queries `portfolio.startingBalance`, `portfolio.cashBalance`, and `holding.totalInvested` (cost basis) directly from `Portfolio` and `Holding` tables for active users (`user.isSuspended: false`).
  * **Input 2**: Queries `trade.realizedPnl` from `Trade` table where `executedAt >= periodStart && executedAt < nextDay`.
  * **Finding**: The existing generator computes rankings directly from `Trade.realizedPnl` and portfolio cost basis. It does **not** consume `PerformanceSnapshot`.

#### Approved Behavior & Consistency Policy
* **Scheduler Architecture**: One daily in-process scheduler running at **02:00 UTC** targeting yesterday ($T - 1$).
* **Distributed Locking with Fail-Closed Semantics**:
  * Guarded by a distributed Redis lock (`leaderboard:snapshot:lock`) with an in-process lease owner.
  * **Fail-Closed on Redis Outage**: If Redis is unreachable or returns an error, the worker aborts snapshot execution (fails closed) rather than proceeding without a lock, eliminating the risk of split-brain concurrent snapshot runs across worker replicas.
  * **Atomic Lease Release**: Releases the lock via a Redis Lua script comparing the stored owner token with the worker's unique ID, guaranteeing that a worker cannot accidentally release another instance's lease.
  * **Heartbeat Renewal**: An automatic lease renewal timer runs during execution (every 10 seconds, extending lease TTL by 30 seconds) to ensure long-running batch refreshes do not expire prematurely while active.
* **Consistency Policy**:
  * Because the current generator reads directly from immutable historical `Trade` records and portfolio balances, it is decoupled from `PerformanceSnapshot`.
  * If future EOD portfolio snapshots are integrated: verify snapshot coverage at 02:00 UTC; retry missing snapshots up to 3 times at 15-minute intervals (02:15, 02:30, 02:45 UTC). If still missing at 03:00 UTC, skip that date's refresh and log an actionable error. Never publish a partial or mixed-source snapshot.
* **Rerun Idempotency**: Uses `upsert` on `LeaderboardSnapshot` and replaces entries in `prisma.$transaction`.

---

### 47.3 Achievement Trigger Rules (#130, PR #149)

#### Approved Behavior
* **Initial Catalog**:
  1. `FIRST_TRADE`: First trade executed (`totalTrades >= 1`).
  2. `FIRST_PROFIT`: First trade with `realizedPnl > 0`.
  3. `TEN_SUCCESSFUL_TRADES`: 10 trades with `realizedPnl > 0`.
  4. `PORTFOLIO_MILESTONE`: Reaching twice the portfolio's starting balance (`totalValue >= portfolio.startingBalance * 2`), evaluated per portfolio using real-time market quotes via `calculatePortfolioValuation()`. No cost-basis fallback is permitted; if market data fails, evaluation safely defers to prevent granting unearned milestone badges.
* **Deferred Achievements**:
  * `LEAGUE_WINNER`: Deferred until leagues can be completed.
  * `CONSISTENT_TRADER`: Deferred until its rule is specified.
* **Durable Post-Commit Mechanism & Crash Recovery**:
  * Does NOT rely on `setImmediate` or an untracked callback.
  * Invoked post-commit in `tradeService.js` (`await evaluateAndGrantAchievements(userId, { trade, order, portfolio })`).
  * Scheduled durable reconciliation job (`reconcileAchievements`) runs on worker startup and on a recurring schedule to catch any unrecorded achievements if a process crashes mid-flight.
  * Transaction boundary: Core trade financial settlement commits independently.
  * Idempotency boundary: `UserAchievement` has `@@unique([userId, achievementId])`. Grants execute via `create` catching duplicate key `P2002` or `upsert`. Notification is emitted once per newly awarded achievement.

---

### 47.4 Leaderboard History API (#131)

#### Approved Behavior
* **Scope Support**: Supports stored `GLOBAL` snapshots only (`scope: "GLOBAL"`).
* **Endpoint & Query Parameters**:
  * `GET /api/v1/leaderboard/history`
  * Parameters:
    * `period`: `DAILY`, `WEEKLY`, `MONTHLY`, `ALL_TIME` (default: `ALL_TIME`).
    * `date`: optional `YYYY-MM-DD` (exact single snapshot date).
    * `from` & `to`: optional `YYYY-MM-DD` (date range).
    * `page`: default 1 (bounded $\ge 1$).
    * `limit`: default 20 (bounded $1 \le \text{limit} \le 100$).
* **Stored Ranks & Visibility Preservation**:
  * Returns historical ranked entries (`LeaderboardEntry`) from stored snapshots.
  * Preserves stored `rank` values verbatim.
  * When suspended users (`author.isSuspended: true`) are filtered out for visibility, their rows are omitted, but the remaining users' stored `rank` values are preserved verbatim with gaps (e.g. Rank 1, Rank 3). Ranks are never re-calculated or shifted.
* **Ordering**:
  * Range: `snapshotDate DESC, rank ASC, userId ASC`.
  * Single date: `rank ASC, userId ASC`.

---

### 47.5 Social Feed Ranking (#132)

#### Approved Behavior
* **Default Ordering**: Preserves chronological ordering (`sort=latest`, ordered by `createdAt: 'desc'`).
* **Trending Mode**: Explicit `sort=trending` mode.
* **Candidate Window & Bound**:
  * Bounded to a candidate window capped at **200 posts** from the last 7 days (`createdAt >= NOW() - INTERVAL '7 days'`).
  * Uses existing `@@index([createdAt])` on `Post`.
* **Scoring Formula**:
  $$\text{Score} = \frac{\text{likes} + 1 + (\text{isFollowing} ? 2 : 0)}{(\text{ageHours} + 2)^{1.2}}$$
* **Pagination & Engagement Shift Disclosure**:
  * Freezing `asOf` freezes recency age decay only. Concurrent engagement changes (new likes or follow relationship changes) can shift post scores during browsing. This behavior is documented as expected for trending feeds.
  * Tie-breaking sort: `score DESC, createdAt DESC, id ASC`.
* **Visibility**: Strictly filters `isHidden: false` and `author.isSuspended: false`.

---

### 47.6 Order-Execution Notifications (#133)

#### Approved Behavior
* **Enum Migration**: Add explicit `ORDER_CANCELLED`, `ORDER_REJECTED`, and `ORDER_EXPIRED` to `NotificationType` enum with an additive Prisma migration.
* **Emission Lifecycle**: Emitted strictly post-commit from `orderService.js` (cancellations) and `orderQueueWorker.js` / `orderWorker.js` (rejections and expirations).
* **Exactly-Once Guarantee**: Guarded by state transitions from `PENDING` to terminal states; retries or duplicate events cannot create duplicate notifications.
* **Payload Context**: Context stored in `Notification.data: Json` (`orderId`, `symbol`, `side`, `quantity`, `price`, `reason`/`notes`).

---

### 47.7 Sentiment Aggregation (#134)

#### Approved Behavior
* **Fixed Minimum Sample Threshold**: Exactly **$N_{\min} = 5$** across every environment.
* **Sample Categorization**:
  * `T = 0`: `classification = "NO_DATA"`, `status = "ZERO_VOTES"`, `sampleThresholdMet = false`.
  * `0 < T < 5`: `classification = "NO_DATA"`, `status = "INSUFFICIENT_SAMPLE"`, `sampleThresholdMet = false`, reports exact vote count $T$.
  * `T >= 5`: `sampleThresholdMet = true`.
* **Vote Values & Classification**:
  * Includes `BULLISH`, `BEARISH`, and `NEUTRAL` votes in total denominator $T = B + R + N$.
  * Percentages: $p_B = \frac{B}{T} \times 100, \quad p_R = \frac{R}{T} \times 100, \quad p_N = \frac{N}{T} \times 100$.
  * Consensus classification:
    * **`BULLISH`**: $p_B > 50\%$ and $B > R$.
    * **`BEARISH`**: $p_R > 50\%$ and $R > B$.
    * **`NEUTRAL`**: Neither Bullish nor Bearish exceeds 50% of all votes once threshold is met.
* **Time Windows & Recency**:
  * Windows: `24h`, `7d`, `30d`, `ALL`.
  * Bounded windows filter by `updatedAt >= windowStart`. Changing a vote updates `updatedAt = now()`, immediately refreshing its recency into active windows.

---

## Commit Sequence & Execution Roadmap

### Phase 1: Core Feature Implementation
1. `docs(task-47): record current behavior and open product decisions` *(Committed: 34fad5a)*
2. `test(leaderboard): cover snapshot refresh invariants` *(Committed: 6a8381b)*
3. `docs(task-47): revise product decision sheet with recommendations and impact analysis` *(Committed: ce5c641)*
4. `docs(task-47): update decision sheet with implementation evidence and fallback specifications` *(Committed: 64a45e5 / 0e25743)*
5. `docs(task-47): record maintainer approved product specifications` *(Committed: 98ba8ff)*
6. `feat(workers): schedule leaderboard snapshot refreshes with distributed locking` *(Committed: b5aa21f - #129)*
7. `feat(api): expose stored global leaderboard history with date range queries` *(Committed: 938e50a - #131)*
8. `feat(social): add trending feed ranking mode with bounded candidate scoring` *(Committed: 35f5e98 - #132)*
9. `feat(notifications): add notifications for terminal order transitions` *(Committed: 6d20695 - #133)*
10. `feat(sentiment): aggregate market sentiment votes across time windows` *(Committed: bbcb9e8 - #134)*
11. `feat(achievements): implement durable achievement trigger and reconciliation rules` *(Committed: bc08dae - #130)*
12. `feat(competitions): implement approved league scoring and membership rules` *(Committed: a3a8a4b - #128)*
13. `test(task-47): cover cross-feature regressions and end-to-end integration` *(Committed: 000a7cc)*
14. `docs(task-47): finalize API and operational documentation` *(Committed: 5084931)*

### Phase 2: PR #149 Correctness Fixes
15. `fix(competitions): correct fee and position valuation` *(Committed: 2c45331)*
16. `fix(competitions): isolate league portfolios and guard join capacity` *(Committed: 4b1cf39)*
17. `fix(achievements): value portfolio milestones at market prices` *(Committed: e0a1760)*
18. `fix(workers): prevent concurrent leaderboard refreshes` *(Committed: 18c2713)*
19. `fix(competitions): transition league status at UTC boundaries` *(Committed: 85ef197)*
20. `test(task-47): cover scoring and lifecycle regressions` *(Committed: f0ec2c8)*
21. `docs(task-47): document corrected competition and worker behavior` *(Current commit)*
