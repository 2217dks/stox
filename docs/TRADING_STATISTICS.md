# 📈 Trading Statistics & Monthly Performance Contracts

> **Architecture, mathematical specifications, contracts, and operating rules for Phase 2 Task 39 (Issues #111, #112, #113).**

---

## 📌 Table of Contents

- [Overview & Invariants](#overview--invariants)
- [1. Trade Statistics API (#111)](#1-trade-statistics-api-111)
  - [Endpoint & Authentication](#endpoint--authentication)
  - [Supported Query Filters](#supported-query-filters)
  - [Trade Counting & Volume Invariants](#trade-counting--volume-invariants)
  - [Response Envelope & Decimal Serialization](#response-envelope--decimal-serialization)
- [2. Win-Rate Calculation (#112)](#2-win-rate-calculation-112)
  - [Unit of Counting](#unit-of-counting)
  - [Decided Trades & Breakeven Treatment](#decided-trades--breakeven-treatment)
  - [Open Positions & Null P&L](#open-positions--null-pl)
  - [Empty History & Edge Cases](#empty-history--edge-cases)
  - [Formula & Precision](#formula--precision)
- [3. Monthly Performance Aggregation (#113)](#3-monthly-performance-aggregation-113)
  - [Portfolio Performance vs Trade Performance](#portfolio-performance-vs-trade-performance)
  - [A. Portfolio Monthly Performance API](#a-portfolio-monthly-performance-api)
  - [B. User Monthly Trade Breakdown](#b-user-monthly-trade-breakdown)
  - [UTC Calendar Month Rules & Boundaries](#utc-calendar-month-rules--boundaries)
  - [Missing & Empty Months Policy](#missing--empty-months-policy)
- [Backward Compatibility & Verification](#backward-compatibility--verification)

---

## Overview & Invariants

Task 39 establishes comprehensive trading performance analytics for the Stox platform:
1. **Self-Scoped Security:** Statistics queries are strictly scoped to the authenticated caller's own portfolios (`portfolio.userId === req.user.userId`). An arbitrary `userId` is never accepted in request parameters or query strings.
2. **Numeric Fidelity:** Financial values (`totalVolume`, `realizedPnl`, `realizedPnlPct`, `averageReturn`) use high-precision decimals (`Prisma.Decimal` @ `Decimal(18, 8)`) and are serialized to JSON as strings to avoid floating-point loss.
3. **Truth in Data:** Missing observations or non-trading periods are never fabricated as zero returns. Breakeven trades do not dilute win rate.
4. **Backward Compatibility:** Preserves existing response shapes and key contracts for `GET /api/v1/users/me/statistics` while adding validated filtering and monthly aggregation capabilities.

---

## 1. Trade Statistics API (#111)

### Endpoint & Authentication
* **Path:** `GET /api/v1/users/me/statistics`
* **Authentication:** Required (Bearer JWT access token).
* **Authorization:** Self-scoped via `req.user.userId`.
  - Missing token $\to$ `401 UNAUTHORIZED`
  - Invalid/expired token $\to$ `401 INVALID_ACCESS_TOKEN`
  - Suspended user $\to$ `403 ACCOUNT_SUSPENDED`
  - Deleted user $\to$ `404 USER_NOT_FOUND`

### Supported Query Filters
The endpoint supports validated optional query parameters:
* `portfolioId` (`UUID`, optional): Limits statistics to a specific portfolio owned by the user. If the portfolio does not exist or belongs to another user, returns `404 PORTFOLIO_NOT_FOUND`.
* `symbol` (`string`, 1–20 chars, optional): Asset ticker filter (normalized to uppercase, e.g. `AAPL`).
* `side` (`BUY` | `SELL`, optional): Filters trades by execution side.
* `from` (`dateBoundSchema(0)`, optional): Lower bound on `executedAt` (inclusive). Accepts `YYYY-MM-DD` or ISO 8601 with UTC offset.
* `to` (`dateBoundSchema(1)`, optional): Upper bound on `executedAt` (exclusive). Must be strictly later than `from`.
* `includeMonthly` (`boolean`, optional, default `false`): If true, includes the monthly trade statistics breakdown array under `statistics.monthly`.

### Trade Counting & Volume Invariants
* **`totalTrades`:** Counts all eligible `Trade` rows matching the active filters (both BUY and SELL executions).
* **`totalVolume`:** Sum of `totalValue` across all eligible `Trade` rows matching the filters. If no trades exist, returns `"0"`.
* **`averageReturn`:** SQL average (`_avg`) of `realizedPnlPct`. SQL `AVG()` ignores `NULL`s automatically, ensuring open positions and BUY trades do not drag down the average return.

### Response Envelope & Decimal Serialization
Standard response envelope:
```json
{
  "success": true,
  "data": {
    "statistics": {
      "totalTrades": 5,
      "winningTrades": 2,
      "losingTrades": 1,
      "winRate": 0.6667,
      "totalVolume": "5400",
      "averageReturn": "5.5",
      "bestTrade": {
        "symbol": "MSFT",
        "realizedPnl": "500",
        "realizedPnlPct": "20"
      },
      "worstTrade": {
        "symbol": "TSLA",
        "realizedPnl": "-300",
        "realizedPnlPct": "-8"
      }
    }
  }
}
```

---

## 2. Win-Rate Calculation (#112)

### Unit of Counting
* In Stox, each `Trade` record represents an executed trade fill.
* Realized P&L is recorded upon execution of `SELL` orders, matching the proportional cost basis removed from the holding.
* The atomic unit of a realized outcome is the **individual realized trade execution** (`Trade` row where `realizedPnl != null`).

### Decided Trades & Breakeven Treatment
* **Winning Trade:** A trade where `realizedPnl > 0`.
* **Losing Trade:** A trade where `realizedPnl < 0`.
* **Breakeven Trade:** A trade where `realizedPnl == 0`.
* **Decided Trades:** Trades with a definitive profit or loss:
  $$\text{Decided Trades} = \text{winningTrades} + \text{losingTrades}$$
* **Breakeven Policy:** Breakeven trades do not count as winning or losing trades and are excluded from the win-rate denominator. This ensures that trades exited at exact cost basis do not penalize trader performance.

### Open Positions & Null P&L
* Trades with `realizedPnl === null` (e.g. `BUY` orders, accumulating open positions) do not have a realized outcome.
* They are counted in `totalTrades` and `totalVolume`, but excluded from `winningTrades`, `losingTrades`, and `winRate`.

### Empty History & Edge Cases
* If `decidedTrades === 0` (e.g., no trades, only BUY trades, or only breakeven trades), `winRate` returns `0` (or `0.0`).
* If all decided trades are wins, `winRate` returns `1` (or `1.0`).
* If all decided trades are losses, `winRate` returns `0` (or `0.0`).

### Formula & Precision
$$\text{Win Rate} = \begin{cases} 0 & \text{if } (\text{winningTrades} + \text{losingTrades}) = 0 \\ \operatorname{round}_4\left(\frac{\text{winningTrades}}{\text{winningTrades} + \text{losingTrades}}\right) & \text{otherwise} \end{cases}$$
Bounded in $[0.0000, 1.0000]$ and rounded to 4 decimal places.

---

## 3. Monthly Performance Aggregation (#113)

### Portfolio Performance vs Trade Performance
Task 39 reconciles both perspectives:
1. **Portfolio Monthly Performance:** Evaluates end-of-month vs start-of-month portfolio valuation changes from `PerformanceSnapshot` records (reflecting cash, realized trade P&L, and unrealized open position valuation changes).
2. **User Monthly Trade Statistics:** Evaluates trade execution history bucketed by the calendar month of `executedAt`.

### A. Portfolio Monthly Performance API
* **Path:** `GET /api/v1/portfolios/:portfolioId/analytics/monthly-performance`
* **Authentication:** Required (Bearer JWT).
* **Authorization:** Scoped to portfolio owner (`portfolio.userId === req.user.userId`). Non-owner/non-existent returns `404 PORTFOLIO_NOT_FOUND`.
* **Supported Query Parameters:**
  - `year` (`number`, e.g. `2026`, optional): Limits aggregation to the given calendar year.
  - `from` (`string` YYYY-MM or YYYY-MM-DD, optional): Lower month boundary (inclusive).
  - `to` (`string` YYYY-MM or YYYY-MM-DD, optional): Upper month boundary (inclusive).
* **Response DTO:**
```json
{
  "success": true,
  "data": {
    "portfolioId": "port-uuid",
    "months": [
      {
        "month": "2026-10",
        "startValue": "10000.00000000",
        "endValue": "10800.00000000",
        "netPnl": "800.00000000",
        "returnPct": "8.0000",
        "realizedPnl": "500.00000000",
        "unrealizedPnl": "300.00000000",
        "snapshotCount": 31
      }
    ]
  }
}
```
* **Field Definitions:**
  - `month`: UTC calendar month string (`YYYY-MM`).
  - `startValue`: Portfolio valuation at the start of the month (valuation from prior month-end snapshot if available, or first recorded snapshot of this month).
  - `endValue`: Portfolio valuation from the latest recorded snapshot in the month.
  - `netPnl`: $V_{\text{end}} - V_{\text{start}}$.
  - `returnPct`: $\frac{V_{\text{end}} - V_{\text{start}}}{V_{\text{start}}} \times 100$, rounded to 4 decimals (or `null` if $V_{\text{start}} \le 0$).
  - `realizedPnl`: Sum of `realizedPnl` from all trades executed in that portfolio during the month.
  - `unrealizedPnl`: Net unrealized valuation shift ($netPnl - realizedPnl$).
  - `snapshotCount`: Number of daily snapshot observations recorded in the month.

### B. User Monthly Trade Breakdown
* **Path:** `GET /api/v1/users/me/statistics/monthly` (or `?includeMonthly=true` on `/me/statistics`)
* **Response DTO:**
```json
{
  "success": true,
  "data": {
    "monthly": [
      {
        "month": "2026-11",
        "totalTrades": 5,
        "winningTrades": 2,
        "losingTrades": 1,
        "winRate": 0.6667,
        "totalVolume": "5400",
        "realizedPnl": "400",
        "averageReturn": "5.5"
      }
    ]
  }
}
```

### UTC Calendar Month Rules & Boundaries
* All monthly buckets are grouped strictly by **UTC calendar month** (`YYYY-MM`).
* Month boundaries start at `YYYY-MM-01T00:00:00.000Z` and end at the final millisecond of the month in UTC.
* Leap years (e.g. February 29) are handled natively via standard UTC date arithmetic.

### Missing & Empty Months Policy
* Months without recorded snapshots or trade executions are **omitted** (or explicitly empty without fabricated data).
* Zero returns or artificial valuations are never synthesized for unobserved periods.

---

## Backward Compatibility & Verification
* Standard calls to `GET /api/v1/users/me/statistics` with no query parameters continue to return the exact 8 keys expected by existing clients and test scripts (`totalTrades`, `winningTrades`, `losingTrades`, `winRate`, `totalVolume`, `averageReturn`, `bestTrade`, `worstTrade`).
* Verified against `backend/scripts/test-user-statistics-api.js` and comprehensive Jest unit/integration test suites.

---

## Verification & Implementation Notes

### Delivered Components & Files

1. **Validators & Schemas:**
   - `backend/src/validators/userValidator.js`: Added `tradeStatisticsQuerySchema` supporting `portfolioId`, `symbol`, `side`, `from`, `to`, and `includeMonthly`.
   - `backend/src/validators/portfolioValidator.js`: Added `monthlyPerformanceQuerySchema` supporting `year`, `from`, `to`.
   - `backend/tests/unit/validators/userValidator.test.js`: Black-box unit tests for query parameter coercion, symbol casing, UUID validation, and date bounds.
   - `backend/tests/unit/validators/portfolioAnalyticsValidator.test.js`: Added tests for `monthlyPerformanceQuerySchema`.

2. **Services & Helpers:**
   - `backend/src/services/userStatisticsService.js`:
     - Isolated pure helper functions: `computeWinRate`, `toDecimalString`, `serializeTradeSummary`, `buildTradeFilter`.
     - Added portfolio ownership validation (`PORTFOLIO_NOT_FOUND` when foreign portfolio requested).
     - Added `getMonthlyTradeStatistics(userId, filters)` for calendar-month trade statistics breakdown.
     - Enforced deterministic ordering for best/worst trade tie-breaking (`[{ realizedPnl: "desc" }, { executedAt: "desc" }]`).
   - `backend/src/services/portfolioMonthlyService.js`:
     - Added `getPortfolioMonthlyPerformance(portfolioId, userId, options)`.
     - Handles month starting valuations $V_{\text{start}}$ (using prior month's ending snapshot or initial snapshot), ending valuations $V_{\text{end}}$, net PnL, simple return percentage, realized trade P&L, and unrealized valuation changes.
     - Pure UTC month boundary helpers (`toUtcYearMonth`, `getUtcMonthStart`, `getUtcMonthEnd`) with leap year handling.

3. **Controllers & Routes:**
   - `backend/src/controllers/userController.js`: Added `getMyMonthlyStatistics` and wired `filters` to `getMyStatistics`.
   - `backend/src/routes/userRoutes.js`: Registered validated `GET /me/statistics` and `GET /me/statistics/monthly`.
   - `backend/src/controllers/portfolioController.js`: Added `getMonthlyPerformance`.
   - `backend/src/routes/portfolioRoutes.js`: Registered `GET /:portfolioId/analytics/monthly-performance` and `GET /:portfolioId/monthly-performance`.

4. **Integration & Regression Testing:**
   - `backend/tests/integration/monthlyPerformance.integration.test.js`: Real PostgreSQL integration test testing unauthenticated rejection (401), cross-user portfolio isolation (404), owner success (200), year filtering, invalid ranges, and monthly trade statistics.
   - `backend/tests/unit/services/userStatisticsService.test.js`: Unit tests covering zero trades, only BUY trades, breakeven trades, 100% win rate, 0% win rate, high-precision decimals, and multi-month rollover.
   - `backend/tests/unit/services/portfolioMonthlyService.test.js`: Unit tests for monthly portfolio performance aggregation and boundary helpers.

