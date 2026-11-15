# 📈 Analytics Performance & Caching Architecture (Task 40)

> Baseline performance analysis, query profiling, caching architecture, and optimization roadmap for Issues #114 and #115.

---

## 📌 Table of Contents

- [Executive Summary](#executive-summary)
- [Baseline Query Profiling & Hotspots](#baseline-query-profiling--hotspots)
  - [1. Portfolio Risk Analytics](#1-portfolio-risk-analytics)
  - [2. Benchmark & Benchmark Comparison](#2-benchmark--benchmark-comparison)
  - [3. Portfolio Monthly Performance](#3-portfolio-monthly-performance)
  - [4. User Trading Statistics & Monthly Breakdown](#4-user-trading-statistics--monthly-breakdown)
- [Caching Architecture (#114)](#caching-architecture-114)
  - [Isolation & Key Structure](#isolation--key-structure)
  - [Configurable TTL Strategy](#configurable-ttl-strategy)
  - [Generation-Guarded Invalidation & In-Flight Race Protection](#generation-guarded-invalidation--in-flight-race-protection)
  - [Mutation Invalidation Triggers](#mutation-invalidation-triggers)
  - [Fail-Open & Reliability Guarantee](#fail-open--reliability-guarantee)
- [Query Optimization Roadmap (#115)](#query-optimization-roadmap-115)
  - [Monthly Aggregation in Database](#monthly-aggregation-in-database)
  - [Consolidation of User Statistics Queries](#consolidation-of-user-statistics-queries)
  - [Index Profiling & Plan Evidence](#index-profiling--plan-evidence)
- [Execution & Verification Plan](#execution--verification-plan)

---

## Executive Summary

Phase 2 Task 38 and Task 39 introduced comprehensive portfolio risk analytics, calendar P&L heatmaps, benchmark comparisons, and monthly trading statistics. However, prior to Task 40:
1. **Zero Caching on Analytics**: Every analytics endpoint recalculated financial metrics, executed multiple database queries, and fetched external market candles on every request.
2. **Unbounded In-Memory Aggregation**: Monthly trade statistics (`userStatisticsService` and `portfolioMonthlyService`) queried all individual trade records within the date filter into Node.js application memory and grouped/calculated metrics in JavaScript loops.
3. **Repeated Database Round-Trips**: `getUserStatistics` issued 5 separate parallel queries (`aggregate`, two `count` calls, two `findFirst` calls) plus a 6th query for monthly breakdown when `includeMonthly=true`.
4. **Missing Composite Index**: Range queries on `Trade` filtering by `portfolioId` and `executedAt` required sequential scans or separate index lookups with explicit in-memory sorting.

Task 40 addresses these bottlenecks with an enterprise-grade Redis cache-aside layer, generation-guarded race prevention, database-level aggregations, and evidence-backed composite indexing.

---

## Baseline Query Profiling & Hotspots

| Endpoint / Operation | DB Queries per Call | Application Overhead | Cache Layer | Hotspot / Bottleneck |
| :--- | :--- | :--- | :--- | :--- |
| **`GET /portfolios/:id/pnl-heatmap`** | 2 (`Portfolio`, `PerformanceSnapshot`) | Daily return & P&L iteration | None | Repeated snapshot scans on every visit. |
| **`GET /portfolios/:id/risk-metrics`** | 2 (`Portfolio`, `PerformanceSnapshot`) | Sample std-dev, drawdown, Sharpe | None | Recomputes statistical math on unchanged historical series. |
| **`GET /portfolios/:id/benchmark`** | 1-2 DB + Provider API | Daily return mapping | Partial (Market) | Redundant benchmark normalization and DB boundary queries. |
| **`GET /portfolios/:id/benchmark-comparison`** | 2 DB + Provider API | Mutual date alignment, Cov/Beta/Alpha | None | Re-aligns series and computes regressions on identical dates. |
| **`GET /portfolios/:id/monthly-performance`** | 3-4 DB | In-memory grouping of all trade rows | None | Fetches all trade rows in date range just to sum realized P&L. |
| **`GET /users/me/statistics`** | 5-7 DB | High DB round-trip concurrency | None | 5 queries in `Promise.all` (`_sum`, counts, ordered finds). |
| **`GET /users/me/statistics/monthly`** | 2-3 DB | Loads all user trades into memory | None | Memory pressure and latency scale with trade volume. |

### Measured Query Plans (Baseline)
For trade range queries (`portfolioId` + `executedAt`):
```sql
EXPLAIN SELECT * FROM "Trade"
WHERE "portfolioId" = '...' AND "executedAt" >= NOW() - INTERVAL '30 days'
ORDER BY "executedAt" ASC;
```
**Baseline Output:**
- `Sort Key: "executedAt"`
- `Seq Scan on "Trade"` (or Bitmap Heap Scan merging two single-column indexes)
- `Filter: ("portfolioId" = ... AND "executedAt" >= ...)`

---

## Caching Architecture (#114)

### Isolation & Key Structure
All analytics cache keys follow the established `stox:v1` prefix and enforce strict ownership isolation:

1. **Portfolio Scoped Analytics**:
   - Must include authenticated user ID, portfolio ID, and all normalized options.
   - Format: `stox:v1:analytics:portfolio:<portfolioId>:u:<userId>:<metric>:<paramsHash>`
     - Heatmap: `...:heatmap:p:<period>:y:<year>`
     - Risk Metrics: `...:risk-metrics:p:<period>:rf:<riskFreeRate>`
     - Benchmark: `...:benchmark:s:<symbol>:p:<period>`
     - Benchmark Comparison: `...:benchmark-comparison:s:<symbol>:p:<period>:rf:<riskFreeRate>`
     - Monthly Performance: `...:monthly:y:<year>:from:<from>:to:<to>`
2. **User Scoped Statistics**:
   - Format: `stox:v1:analytics:user:<userId>:stats:<paramsHash>`
   - Format: `stox:v1:analytics:user:<userId>:monthly:<paramsHash>`
   - Parameters normalized: `from`, `to`, `symbol` (uppercased), `side` (uppercased), `assetType` (uppercased), `portfolioId`, `includeMonthly`.

### Configurable TTL Strategy
TTLs are loaded via `cacheConfig.js` with positive safe-integer validation:
- `CACHE_TTL_ANALYTICS_HEATMAP_SECONDS` (default: 300s / 5 minutes)
- `CACHE_TTL_ANALYTICS_RISK_METRICS_SECONDS` (default: 300s / 5 minutes)
- `CACHE_TTL_ANALYTICS_BENCHMARK_SECONDS` (default: 3600s / 1 hour)
- `CACHE_TTL_ANALYTICS_BENCHMARK_COMPARISON_SECONDS` (default: 300s / 5 minutes)
- `CACHE_TTL_ANALYTICS_MONTHLY_PERFORMANCE_SECONDS` (default: 300s / 5 minutes)
- `CACHE_TTL_USER_STATISTICS_SECONDS` (default: 120s / 2 minutes)

### Generation-Guarded Invalidation & In-Flight Race Protection
To prevent stale in-flight database calculations from overwriting freshly invalidated cache entries:
1. Maintain generation keys in Redis:
   - `stox:v1:analytics:generation:portfolio:<portfolioId>`
   - `stox:v1:analytics:generation:user:<userId>`
2. When a loader begins, it reads the current `generation`.
3. When saving the calculated result, a Lua script evaluates:
   ```lua
   if redis.call("GET", KEYS[1]) == ARGV[1] then
     redis.call("SET", KEYS[2], ARGV[2], "EX", ARGV[3])
     return 1
   end
   return 0
   ```
4. On invalidation, `redis.call("INCR", generationKey)` atomically increments the generation. Any write attempt from an in-flight loader with the prior generation is rejected.

### Mutation Invalidation Triggers
Invalidations are executed strictly **after committed database transactions**:
1. **Trade Execution** (`tradeService.executeOrderTrade`):
   - Increments portfolio analytics generation (`portfolioId`).
   - Increments user analytics generation (`userId`).
   - Invalidates portfolio summary and leaderboards.
2. **Snapshot Upsert / Batch Workers** (`portfolioSnapshotService`, `portfolioSnapshotRepository`):
   - Increments portfolio analytics generation for each affected portfolio.
3. **Portfolio Deactivation / Update** (`portfolioService`):
   - Increments portfolio analytics generation and user analytics generation.

### Fail-Open & Reliability Guarantee
All cache operations are wrapped in safe error handlers. If Redis encounters network partitions, connection errors, or downtime:
- The error is logged as a warning.
- Endpoints fail open and compute the fresh result directly from PostgreSQL.
- Under zero circumstances does a Redis failure result in a user-facing HTTP 500 error on analytics routes.

---

## Query Optimization Roadmap (#115)

### Monthly Aggregation in Database
Instead of fetching all individual trade entities into Node.js:
- Group and aggregate trades in PostgreSQL by `TO_CHAR("executedAt" AT TIME ZONE 'UTC', 'YYYY-MM')`.
- Compute counts, sums (`totalValue`, `realizedPnl`), and return sums (`realizedPnlPct`) within the database engine.
- Drastically reduces row transfer, deserialization overhead, and garbage collection churn.

### Consolidation of User Statistics Queries
- Combine overall trade counts, realized P&L filters, and volume sums into optimized Prisma aggregate / conditional queries where supported.
- Maintain Decimal precision and exact formatting compatibility.

### Index Profiling & Plan Evidence
- Add composite index on `Trade (portfolioId, executedAt)` in `schema.prisma`.
- Covers date-bounded trade lookups and chronological ordering, transforming `Seq Scan + Sort` into direct `Index Scan`.

---

## Execution & Verification Plan

1. Document architecture and baseline plan.
2. Extend `cacheConfig.js` and `cacheKeys.js` with analytics TTLs and isolated keys.
3. Implement generation-safe cache helpers in `cacheService.js`.
4. Wrap analytics endpoints with cache-aside and ownership pre-validation.
5. Wire post-commit cache invalidation across trade execution, holding mutations, and snapshot creation.
6. Optimize database queries for monthly performance and trading statistics.
7. Add composite index migration and verify before/after query plans.
8. Validate 100% of test suites serially (`npm test -- --runInBand`).
