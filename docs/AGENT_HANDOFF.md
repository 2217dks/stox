# Agent handoff — Phase 2 completion (PR #150)

> **Audience:** the next coding agent picking up `stox` on
> `feature/phase1-remaining-tasks` (or from `main` after PR #150 merges).
> **Status:** Phase 2 implementation complete. PR #150 is open, mergeable,
> CI-green, and awaiting maintainer re-review/merge. The blocking review fix is
> committed. No active code work remains. This file is intentionally **not
> committed**.
> **Last updated:** 2026-11-17.

---

## 1. Where the work stands

| Item | Value |
| --- | --- |
| Repo | `/Users/dhruv/Documents/stox` |
| Current branch | `feature/phase1-remaining-tasks` |
| Base | `upstream/main` @ `148e7c1` (PR #149 merge) |
| PR #147 | **MERGED** (`0ff7f7e`) |
| PR #148 | **MERGED** (`b8e02f8`, `CopyTrader` data model) |
| PR #149 | **MERGED** (`148e7c1`, competitions/social engagement) |
| PR #150 | **OPEN**, `MERGEABLE`/`CLEAN`, CI green, awaiting re-review |
| Active work | **None** — implementation and review fix are complete |
| Commits | `63746e7` (implementation), `8c69932` (merge), `a6416b8` (review fix) |
| Test baseline | **138 suites / 1715 tests** (unit + integration, all green) |
| Migrations | **25**, all applied locally |
| Local services | Postgres.app on `:5432` (DB `stox`), Redis on `:6379` |

### Verification commands

```bash
cd /Users/dhruv/Documents/stox/backend
npx prisma validate
npx prisma migrate deploy
npm test -- --runInBand
```

Last verified: `138 suites, 1715 tests passed`; `prisma migrate status` reports
the database is up to date.

### Maintainer review follow-up (2026-11-17)

PR #150 received `CHANGES_REQUESTED` with one blocking issue and one
non-blocking clarification:

1. **Blocking — recovery before retry exhaustion.** `attemptFollower()` checked
   the retry budget before looking for an existing copied order. If the order
   committed on the final attempt and the worker crashed before marking the
   execution `PLACED`, the retry marked the execution `FAILED` while the order
   existed. Fixed by moving the `Order.copyTradeExecutionId` lookup ahead of the
   budget check. Regression test added in
   `tests/integration/copyTradeExecution.integration.test.js`
   (`recovers an existing copied order even after the attempt budget is
   exhausted`).
2. **Non-blocking — `maxTradeSize` contract.** Documented explicitly: it is a
   notional sizing cap applied at fan-out using the **source trade price**. It
   bounds the copied quantity, not the follower's final executed notional,
   because copied orders are `MARKET`. A strict execution-notional guarantee is
   a documented non-goal.

Merge conflict resolution with `upstream/main` @ `148e7c1`:

- `orderService.js`: kept the copied-order idempotency fast path and
  `expiresAt` validation alongside upstream's league portfolio restrictions.
- `orderExpired` notifications: upstream introduced `ORDER_EXPIRED` rows in
  `processOrder`; the expiry sweep bypasses that path, so the sweep now creates
  the same notification itself.
- `docs/API.md`: kept the `expiresAt` contract and upstream's competition/league
  constraints.

Commits on the PR: `63746e7` (implementation), `8c69932` (merge),
`a6416b8` (review fix + regression test + sizing docs).

---

## 2. What was completed on this branch

### Batch E — advanced orders (#90, #91, #92, #93, #94, #95)

The execution engine already supported `MARKET`, `LIMIT`, `STOP_LOSS`, and
`TAKE_PROFIT`. This branch added the missing proof and the missing expiry API:

- `tests/integration/advancedOrders.integration.test.js` covers take-profit,
  stop-loss, and limit boundaries; price gaps through the trigger; duplicate
  processing; unfundable triggers → `REJECTED`; reservation release; lifecycle
  events; and cancellation for every advanced order type.
- `POST /orders` now accepts optional `expiresAt` (ISO instant with an explicit
  UTC offset, must be in the future). It is persisted on the order and in the
  `CREATED` event metadata.
- `orderService.createOrder` validates `expiresAt` again for internal callers
  and accepts `source` / `copyTradeExecutionId`.
- `tradeService.executeOrder` rejects an expired order with `ORDER_EXPIRED`
  even if a quote was fetched just before the deadline. The worker then records
  `EXPIRED`.
- `expireOverdueOrders` sweeps overdue `PENDING` rows, including rows in
  inactive portfolios, releases their reservations, records `EXPIRED`, and
  publishes the realtime `order-status` event.
- The polling pass and BullMQ `scan-pending` job run the sweep before the
  execution batch, so expired rows cannot starve active work.
- `tests/integration/orderExpiry.integration.test.js` covers the API contract,
  exact-boundary expiry, inactive-portfolio expiry, idempotent sweeps, and
  concurrent cancel/expiry and execute/expiry races.

**Issues safe to close:** #90, #91, #93, #94, #95. **#92 is a duplicate of
#91** and should be closed as such.

### Batch F — copy trading (#118, #119)

The data model from PR #148 was extended:

- `CopyTrader.copyPortfolioId` (nullable, `ON DELETE SET NULL`) stores the
  destination portfolio. New rows always store the copier's default active
  portfolio when the API omits an explicit choice.
- `CopyTradeExecution` is the durable `(sourceTradeId, copierId)` guard with
  `PENDING|PLACED|FAILED|SKIPPED`, attempt count, and failure details.
- `Order.copyTradeExecutionId` is unique, making copied-order creation
  idempotent even if the execution-row update is lost.
- `Trade.copyFanOutAt` marks a completed fan-out pass; the
  `copy-trades:scan-pending` scheduler recovers an enqueue lost during a Redis
  outage.

Configuration API (`#119`):

- `GET /copy-trading` (pagination, `isActive` filter)
- `POST /copy-trading`
- `PATCH /copy-trading/:id`
- `DELETE /copy-trading/:id` (soft delete: `isActive=false`)

Validation mirrors the database CHECK constraints: `0 < allocationPct <= 100`
with at most 2 decimals; positive `maxTradeSize` with at most 8 decimals;
self-copy rejected; target user must exist and not be suspended; destination
portfolio must belong to the caller and be active; duplicate pair is `409`.

Execution pipeline (`#118`):

- `tradeService.executeOrder` enqueues `fan-out-copy-trades` after commit
  (best-effort, never rolls back the source trade).
- `services/copyTradeService.js` pages active followers in id-ordered batches of
  200, sizes each order as
  `sourceQuantity × allocationPct / 100`, caps by
  `maxTradeSize / sourcePrice` (notional cap), rounds down to 8 decimals, and
  places a `MARKET` order through `orderService.createOrder` with
  `source:"COPY_TRADE"`.
- Per-follower isolation: permanent failures are recorded on that follower;
  transient failures leave the row `PENDING` and throw `COPY_TRADE_RETRY` for
  BullMQ. After the attempt budget the row becomes `FAILED` with
  `MAX_ATTEMPTS_EXCEEDED`.
- A trade whose source order is already `COPY_TRADE` is not copied again,
  preventing chains.
- Tests cover sizing/cap/rounding, destination fallback, inactive config,
  insufficient balance, inactive portfolio, duplicate replay, retry budget,
  chain prevention, and the recovery marker.

**Issues safe to close:** #118, #119.

### 49.3 — SQL/query safety (#139)

- `tests/unit/security/sqlSafety.test.js` fails on `$queryRawUnsafe`,
  `$executeRawUnsafe`, `Prisma.raw`, or a raw call that is not a tagged
  template / `Prisma.sql` composition.
- `docs/DATABASE.md` now contains a query-safety review: raw SQL inventory,
  user-controlled filter/order-clause audit, bounded-read audit, residual
  risks, and every index added.
- New indexes: `Order(status, expiresAt)`,
  `Notification(deliveryStatus, createdAt)`,
  `CopyTrader(copiedId, isActive)`, `CopyTrader(copierId, isActive)`,
  `CopyTrader(copyPortfolioId)`, the `CopyTradeExecution` indexes, the unique
  `Order(copyTradeExecutionId)`, and `Trade(copyFanOutAt, executedAt)`.
- The single-column `CopyTrader` indexes were replaced by the composite
  `(…, isActive)` indexes.

**Issue safe to close:** #139.

---

## 3. Decisions made (and why)

1. **`expiresAt` is a public `POST /orders` field.** The issue asks for order
   expiry; without an API field, no client could set one. It requires an
   explicit UTC offset so the server timezone cannot change its meaning.
2. **Expiry is a separate sweep, not part of the execution query.** The
   execution query must keep excluding inactive portfolios to avoid starvation.
   The sweep handles overdue rows in every portfolio, so reservations are not
   stranded.
3. **`copyPortfolioId` is stored on the relationship.** The docs say copied
   trades enter "the copier's portfolio"; storing the resolved default makes
   the destination explicit and stable. It stays nullable for legacy rows and
   portfolio deletion, with a runtime fallback.
4. **`maxTradeSize` is a notional (quote-currency) cap.** This is the safer
   interpretation for a risk limit and matches the field name. It is converted
   to quantity at the source trade price and rounded down.
5. **Copied orders are `MARKET` only.** This keeps sizing deterministic and
   reuses the normal execution path. Mirroring limit/stop triggers is a larger
   design and is documented as a gap.
6. **Fan-out uses a queue plus a durable execution row.** This matches the
   documented `copy-trades` queue, isolates followers, supports retries, and
   does not rely on a BullMQ `jobId` for idempotency.
7. **A completed fan-out pass is marked on the trade.** The recovery scan is
   finite, and a follower added later does not receive historical trades.
8. **`DELETE /copy-trading/:id` is a soft delete.** History is retained and the
   unique pair prevents accidental duplicates; re-enable with
   `PATCH { isActive: true }`.
9. **Copied trades are not copied again.** Prevents chains and feedback loops.
10. **The SQL review adds indexes and a static guard, not a rewrite.** All raw
    SQL already used parameterized tagged templates.

---

## 4. Files added or changed

### New source files

- `backend/src/services/copyTradingService.js` — configuration CRUD.
- `backend/src/controllers/copyTradingController.js`
- `backend/src/routes/copyTradingRoutes.js`
- `backend/src/validators/copyTradingValidator.js`
- `backend/src/services/copyTradeService.js` — sizing, fan-out, recovery scan.
- `backend/src/queues/copyTradeQueue.js` — fan-out/scan enqueue + scheduler.
- `backend/src/workers/copyTradeWorker.js` — fan-out and scan handlers.

### Changed source files

- `backend/prisma/schema.prisma` — `CopyTrader.copyPortfolioId`,
  `CopyTradeExecution`, `Order.copyTradeExecutionId`,
  `Trade.copyFanOutAt`, indexes.
- `backend/src/services/orderService.js` — `expiresAt`, `source`,
  `copyTradeExecutionId`, copied-order fast path.
- `backend/src/services/tradeService.js` — expiry guard + post-commit fan-out
  enqueue.
- `backend/src/validators/orderValidator.js` — `expiresAt`.
- `backend/src/workers/orderWorker.js` — `expireOverdueOrders`, sweep-first
  polling, realtime expiry publish.
- `backend/src/workers/orderQueueWorker.js` — sweep-first scan, inactive
  portfolio rows still reach the processor.
- `backend/src/queues/definitions.js` — `copy-trades` queue/jobs/policy.
- `backend/src/workers/index.js` — copy-trade worker + scan scheduler.
- `backend/src/routes/index.js` — mounts `/copy-trading`.
- `backend/.env.example` — `QUEUE_COPY_TRADE_CONCURRENCY`,
  `COPY_TRADE_SCAN_INTERVAL_MS`.

### Migrations (3 new, 21 total)

- `20261116120000_add_copy_trading_pipeline` — destination column + backfill,
  execution table, order link, indexes.
- `20261116130000_add_copy_trade_fanout_marker` — `Trade.copyFanOutAt`.
- `20261116130500_backfill_copy_fanout_marker` — marks pre-existing trades so
  the recovery scan does not replay history.

### Tests added

- `tests/integration/advancedOrders.integration.test.js`
- `tests/integration/orderExpiry.integration.test.js`
- `tests/integration/copyTradingConfig.integration.test.js`
- `tests/integration/copyTradeExecution.integration.test.js`
- `tests/unit/services/copyTradeService.test.js`
- `tests/unit/validators/copyTradingValidator.test.js`
- `tests/unit/workers/copyTradeWorker.test.js`
- `tests/unit/security/sqlSafety.test.js`

### Docs updated

- `docs/PHASE1_API_HANDOVER.md` — `expiresAt`, order events, copy-trading
  contract and execution semantics.
- `docs/API.md` — same contract.
- `docs/TRADE_EXECUTION.md` — reservations, expiry sweep, copy fan-out,
  recovery scan, error codes, current test summary.
- `docs/BACKGROUND_JOBS.md` — `copy-trades` queue/jobs/scheduler/recovery,
  updated retry table and gaps.
- `docs/DATABASE.md` — new models/fields/indexes and the 49.3 review.

---

## 5. What remains

The PR is open and CI-green. Remaining steps are maintainer re-review/merge,
then post-merge cleanup:

1. Wait for the maintainer to re-review PR #150 (the review response is posted).
2. After merge, sync `main`, delete the branch, and update this handoff.

Post-merge commands:

```bash
cd /Users/dhruv/Documents/stox
git checkout main
git fetch --all --prune
git merge --ff-only upstream/main
git push origin main
git branch -d feature/phase1-remaining-tasks
git push origin --delete feature/phase1-remaining-tasks
```

Do **not** commit `docs/AGENT_HANDOFF.md`; it is intentionally untracked.

---

## 6. Testing playbook

```bash
cd backend

npm test -- --runInBand                         # full suite (138/1715)
npm test -- --runInBand tests/unit              # unit only
npm test -- --runInBand tests/integration       # integration only
npx jest --runInBand tests/integration/advancedOrders.integration.test.js
npx jest --runInBand tests/integration/orderExpiry.integration.test.js
npx jest --runInBand tests/integration/copyTradingConfig.integration.test.js
npx jest --runInBand tests/integration/copyTradeExecution.integration.test.js
npx jest --runInBand tests/unit/security/sqlSafety.test.js
```

- `tests/setupEnv.js` sets `RATE_LIMIT_ENABLED=false` and
  `QUEUES_ENABLED=false` for every suite. Queue suites must set
  `process.env.QUEUES_ENABLED = "true"` at module top and a unique
  `QUEUE_PREFIX`.
- Integration tests use the real local Postgres/Redis. Create unique
  users/rows and clean up in `afterAll`.
- Close every BullMQ worker **and** its ioredis connection, or Jest hangs.
- CI (`.github/workflows/backend-ci.yml`) runs Prisma validate, unit, then
  integration with Postgres 16 + Redis 7 on Node 26.

---

## 7. Pitfalls discovered

1. BullMQ requires `maxRetriesPerRequest: null`; never reuse
   `src/config/redis.js` (it uses `1`).
2. `queue.add` never settles with a disconnected Redis; always use the bounded
   enqueue helper.
3. BullMQ does not close a caller-supplied ioredis instance; close
   `worker.queueConnection` explicitly.
4. The execution query must keep excluding inactive portfolios, but expiry
   must not. The separate sweep is the resolution; do not fold it back into
   `pendingOrderWhere` without a starvation plan.
5. `expireOverdueOrders` bypasses `processOrder`, so it must publish the
   realtime `order-status` event itself. The realtime integration test catches
   this.
6. `Order.copyTradeExecutionId` is the durable idempotency key. Do not rely on
   the BullMQ `jobId` alone.
7. `CopyTradeExecution` is the per-follower guard. A retry must load the
   existing row, not create a second one.
8. The recovery scan marks trades with zero followers too; otherwise it would
   scan them forever.
9. The backfill migration must mark pre-existing trades; otherwise the first
   scan would replay historical trades to current followers.
10. `maxTradeSize` is notional. Round the copied quantity **down** so the
    notional cannot exceed the cap.
11. Copied orders are `MARKET` only. Do not mirror source limit/stop triggers
    without a deliberate sizing/execution design.
12. `CopyTrader` has no database `copyPortfolioId` NOT NULL constraint; new
    rows set it, legacy rows fall back at fan-out time.
13. Soft-deleted copy relationships keep the unique `[copierId, copiedId]`
    pair; re-create attempts return `409`.
14. `orderService.createOrder` fast-paths an existing `copyTradeExecutionId`
    before calling the quote provider; keep that ordering to avoid unnecessary
    provider calls on retries.
15. The static SQL test is intentionally strict: use tagged templates or
    `Prisma.sql`, never `$queryRawUnsafe`/`Prisma.raw`.

---

## 8. Compaction checklist

If context is lost, these are the only facts needed to resume:

1. Branch: `feature/phase1-remaining-tasks`, merged with `upstream/main` @
   `148e7c1`.
2. PR #150 is open, `MERGEABLE`/`CLEAN`, CI green, awaiting re-review.
3. Baseline: **138 suites / 1715 tests**, **25 migrations** applied.
4. The blocking review fix is committed as `a6416b8`; the merge is `8c69932`.
5. Issues to close on merge: #90, #91, #92, #93, #94, #95, #118, #119, #139;
   #92 is a duplicate of #91.
6. Key files: `backend/src/services/copyTradeService.js`,
   `backend/src/services/copyTradingService.js`,
   `backend/src/services/orderService.js`,
   `backend/src/services/tradeService.js`,
   `backend/src/workers/orderWorker.js`,
   `backend/src/workers/copyTradeWorker.js`,
   `backend/src/queues/copyTradeQueue.js`,
   `backend/prisma/schema.prisma`.
7. Read `docs/PHASE1_API_HANDOVER.md`, `docs/TRADE_EXECUTION.md`,
   `docs/BACKGROUND_JOBS.md`, and `docs/DATABASE.md` before changing code.
