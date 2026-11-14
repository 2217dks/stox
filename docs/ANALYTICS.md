# 📊 Portfolio Risk Analytics & Performance Engine

> **Architecture, mathematical specifications, contracts, and operating rules for Phase 2 Task 38.**

---

## 📌 Table of Contents

- [Overview & Invariants](#-overview--invariants)
- [Mathematical Formulas & Conventions](#-mathematical-formulas--conventions)
  - [Daily & Cumulative Returns](#daily--cumulative-returns)
  - [Annualized Volatility](#annualized-volatility)
  - [Portfolio Drawdown](#portfolio-drawdown)
  - [Sharpe-Like Ratio](#sharpe-like-ratio)
  - [Benchmark Statistics (Alpha, Beta, Correlation)](#benchmark-statistics-alpha-beta-correlation)
- [Temporal & Observation Rules](#-temporal--observation-rules)
  - [UTC Day Boundary](#utc-day-boundary)
  - [Observation Frequency & Annualization Factor](#observation-frequency--annualization-factor)
  - [Risk-Free Rate](#risk-free-rate)
- [Data Sources & Missing Data Semantics](#-data-sources--missing-data-semantics)
  - [No Fabricated Prices or Returns](#no-fabricated-prices-or-returns)
  - [Mutual Date Alignment](#mutual-date-alignment)
  - [Handling Missing or Stale Asset Prices](#handling-missing-or-stale-asset-prices)
- [Snapshots & Baseline Strategy](#-snapshots--baseline-strategy)
  - [PerformanceSnapshot Schema](#performancesnapshot-schema)
  - [Snapshot Creation & Baseline Invariants](#snapshot-creation--baseline-invariants)
- [API Contracts & Endpoints](#-api-contracts--endpoints)
  - [1. P&L Heatmap (`GET /portfolios/:id/pnl-heatmap`)](#1-pl-heatmap-get-portfoliosidpnl-heatmap)
  - [2. Benchmark Data (`GET /portfolios/:id/benchmark`)](#2-benchmark-data-get-portfoliosidbenchmark)
  - [3. Risk Metrics (`GET /portfolios/:id/risk-metrics`)](#3-risk-metrics-get-portfoliosidrisk-metrics)
  - [4. Benchmark Comparison (`GET /portfolios/:id/benchmark-comparison`)](#4-benchmark-comparison-get-portfoliosidbenchmark-comparison)

---

## 📖 Overview & Invariants

Stox provides quantitative risk and performance analytics for user portfolios.
Analytics must adhere strictly to these principles:

1. **Truth in Data:** Absent observations are never treated as zero performance. Benchmark prices, portfolio values, and returns are never synthesized or fabricated.
2. **Owner Isolation:** All portfolio analytics endpoints require authentication and verify ownership (`portfolio.userId === req.user.userId`). Foreign or missing portfolios return HTTP 404 `PORTFOLIO_NOT_FOUND`.
3. **Decimal Precision:** All monetary amounts are handled with high-precision arithmetic (`Prisma.Decimal`) and serialized as strings.
4. **Deterministic Math:** Pure statistical functions with zero external dependencies, verifiable via reproducible fixtures and boundary test suites.

---

## 🧮 Mathematical Formulas & Conventions

### Daily & Cumulative Returns

- **Daily Simple Return ($R_t$):**
  $$R_t = \frac{V_t - V_{t-1}}{V_{t-1}}$$
  where $V_t$ is the portfolio total valuation at the close of date $t$, and $V_{t-1}$ is the valuation at date $t-1$.
  - If $V_{t-1} \le 0$, $R_t$ is undefined (`null`).
- **Cumulative Return over window $[0, T]$:**
  $$\text{CumulativeReturn} = \frac{V_T - V_0}{V_0}$$

### Annualized Volatility

- **Daily Sample Standard Deviation ($\sigma_{\text{daily}}$):**
  $$\bar{R} = \frac{1}{N} \sum_{t=1}^N R_t$$
  $$\sigma_{\text{daily}} = \sqrt{\frac{1}{N - 1} \sum_{t=1}^N (R_t - \bar{R})^2}$$
- **Annualized Volatility ($\sigma_{\text{ann}}$):**
  $$\sigma_{\text{ann}} = \sigma_{\text{daily}} \times \sqrt{F}$$
  where $F = 252$ (standard trading days annualization factor).
  - Requires $N \ge 2$ observations. For $N < 2$, volatility returns `null`.
  - For zero-variance series (all returns identical), $\sigma = 0$.

### Portfolio Drawdown

For an ordered valuation series $\{V_t\}_{t=0}^T$:
- **Running High-Water Mark (Peak $P_t$):**
  $$P_t = \max_{0 \le s \le t} V_s$$
- **Drawdown at time $t$ ($DD_t$):**
  $$DD_t = \frac{V_t - P_t}{P_t}$$
  *(Always $\le 0$; represented as a decimal fraction, e.g. `-0.1550` for -15.5%).*
- **Maximum Drawdown ($MDD$):**
  $$MDD = \min_{0 \le t \le T} DD_t$$
- **Current Drawdown:** $DD_T$ (drawdown at the latest observation).
- **Peak Value & Peak Date:**
  - `peakValue`: $\max_{0 \le t \le T} V_t$
  - `peakDate`: First date (or latest date) where peak value was achieved.

### Sharpe-Like Ratio

- **Formula:**
  $$\text{Sharpe} = \frac{\bar{R}_{\text{ann}} - R_f}{\sigma_{\text{ann}}}$$
  where:
  - $\bar{R}_{\text{ann}} = \bar{R} \times F$
  - $R_f$ is the annualized risk-free rate (default $0.02$, i.e. 2.0%).
  - $\sigma_{\text{ann}}$ is the annualized volatility.
  - If $\sigma_{\text{ann}} = 0$ or $N < 2$, Sharpe ratio is undefined and returns `null`.

### Benchmark Statistics (Alpha, Beta, Correlation)

For mutually aligned daily return pairs $\{(R_{p,t}, R_{b,t})\}_{t=1}^M$:
- **Covariance & Variances:**
  $$\text{Cov}(R_p, R_b) = \frac{1}{M - 1} \sum_{t=1}^M (R_{p,t} - \bar{R}_p)(R_{b,t} - \bar{R}_b)$$
  $$\text{Var}(R_b) = \sigma_b^2 = \frac{1}{M - 1} \sum_{t=1}^M (R_{b,t} - \bar{R}_b)^2$$
- **Beta ($\beta$):**
  $$\beta = \frac{\text{Cov}(R_p, R_b)}{\text{Var}(R_b)}$$
  *(If $\text{Var}(R_b) = 0$ or $M < 2$, $\beta$ returns `null`).*
- **Correlation ($\rho$):**
  $$\rho = \frac{\text{Cov}(R_p, R_b)}{\sigma_p \sigma_b}$$
  *(Bounded in $[-1.0, 1.0]$; returns `null` if either variance is zero).*
- **Alpha ($\alpha$, annualized excess return):**
  $$\alpha = (\bar{R}_{p,\text{ann}} - R_f) - \beta \times (\bar{R}_{b,\text{ann}} - R_f)$$

---

## ⏱️ Temporal & Observation Rules

1. **UTC Calendar:** All date buckets, timestamps, and queries use strictly UTC (`Z`).
   - Daily snapshots represent the portfolio valuation as of `23:59:59.999Z` on date `YYYY-MM-DD`.
2. **Annualization Factor ($F$):** $F = 252$ (trading days per year).
3. **Risk-Free Rate ($R_f$):** Default is $0.02$ ($2.0\%$ annual). Supported as query override: `?riskFreeRate=0.025`.
4. **Periods Supported:**
   - `1W` (7 calendar days)
   - `1M` (30 calendar days, default)
   - `3M` (90 calendar days)
   - `6M` (180 calendar days)
   - `1Y` (365 calendar days)
   - `ALL` (from earliest recorded snapshot)

---

## 📡 Data Sources & Missing Data Semantics

### No Fabricated Prices or Returns
- If no trade or valuation occurred on a non-trading day (weekend/holiday), portfolio valuation is carried forward from the last verified snapshot **only when the last valuation source was authentic and reliable**.
- Gaps in benchmark data (e.g. stock market closed on weekends while crypto trades) are **never filled with fake prices**.
- **Initial & Gap Returns:** In benchmark series and benchmark comparisons, missing returns (e.g. the first observation where no prior close/valuation exists, or gaps caused by exchange closures/trading halts) are represented explicitly as `null` rather than substituted with zero (`"0.0000"`).

### Mutual Date Alignment & Statistical Rigor
- Benchmark comparisons compare performance **only on mutually active trading dates**.
- Non-overlapping dates are excluded from the comparison timeline.
- **Statistical Metrics ($\alpha, \beta, \rho$):** Return statistics are computed strictly over dates where **both** portfolio and benchmark returns are defined numbers. Dates where either return is `null` are excluded from covariance and sample variance calculations to guarantee that $\Delta = 0$ is not spuriously injected into risk parameters.
- If fewer than 2 mutually defined return observations exist ($M < 2$) or benchmark variance is zero, $\beta$, $\alpha$, and $\rho$ gracefully return `null`.

---

## 💾 Snapshots & Scheduled Capture Strategy

### PerformanceSnapshot Schema
```prisma
model PerformanceSnapshot {
  id            String    @id @default(uuid())
  portfolioId   String
  portfolio     Portfolio @relation(fields: [portfolioId], references: [id], onDelete: Cascade)

  totalValue    Decimal   @db.Decimal(18, 8)
  cashBalance   Decimal   @db.Decimal(18, 8)
  holdingsValue Decimal   @db.Decimal(18, 8)

  dailyPnl      Decimal   @db.Decimal(18, 8)
  dailyPnlPct   Decimal   @db.Decimal(10, 4)

  snapshotDate  DateTime  @db.Date
  createdAt     DateTime  @default(now())

  @@unique([portfolioId, snapshotDate])
  @@index([portfolioId])
  @@index([snapshotDate])
}
```

### Scheduled Daily Capture & On-Demand Fallback
1. **Background Snapshot Worker:** The `portfolioSnapshotWorker` runs in `npm run workers` alongside `orderWorker`. It checks for newly started UTC days and executes `captureAllPortfolioSnapshots()` across all active portfolios.
2. **Dedicated CLI Script:** Standalone daily capture can be triggered independently via `npm run portfolio:snapshot` (`scripts/generate-portfolio-snapshots.js`), matching the pattern of `npm run leaderboard:snapshot`.
3. **On-Demand Fallback:** If an analytics endpoint is requested before the worker completes its daily run, the engine computes today's valuation using live market quotes and cash balance, persisting it idempotently for `snapshotDate = today`.
4. **No Speculative Backfills:** Historical snapshots are never retroactively invented for periods where neither trades nor prices were captured.
5. **Clean Baselines:** When a portfolio has only 1 snapshot ($N=1$), single-point performance is reported (`totalValue`, cumulative return $0$), while sample variance-dependent metrics (`volatility`, `sharpeRatio`, `beta`) gracefully return `null`.

---

## 🚀 API Contracts & Endpoints

### 1. P&L Heatmap (`GET /portfolios/:id/pnl-heatmap`)
Returns daily P&L and percentage return records across the requested period or year.

```json
{
  "success": true,
  "data": {
    "portfolioId": "uuid",
    "period": "1Y",
    "heatmap": [
      {
        "date": "2026-11-01",
        "pnl": "120.00000000",
        "pnlPercent": "0.0120",
        "totalValue": "10120.00000000"
      }
    ],
    "summary": {
      "totalPnl": "120.00000000",
      "winDays": 1,
      "lossDays": 0,
      "flatDays": 0
    }
  }
}
```

### 2. Benchmark Data (`GET /portfolios/:id/benchmark`)
Returns historical price and return series for a selected benchmark symbol (default `SPY`).

```json
{
  "success": true,
  "data": {
    "benchmark": "SPY",
    "period": "1M",
    "prices": [
      {
        "date": "2026-11-01",
        "price": "570.25",
        "dailyReturn": "0.0050"
      }
    ]
  }
}
```

### 3. Risk Metrics (`GET /portfolios/:id/risk-metrics`)
Returns computed volatility, drawdown, and Sharpe ratio.

```json
{
  "success": true,
  "data": {
    "portfolioId": "uuid",
    "period": "1M",
    "metrics": {
      "annualizedVolatility": "0.1852",
      "maxDrawdown": "-0.0825",
      "currentDrawdown": "-0.0120",
      "peakValue": "10500.00000000",
      "peakDate": "2026-11-05",
      "sharpeRatio": "1.42",
      "observationCount": 22
    }
  }
}
```

### 4. Benchmark Comparison (`GET /portfolios/:id/benchmark-comparison`)
Returns aligned comparative performance, alpha, beta, and correlation against the benchmark.

```json
{
  "success": true,
  "data": {
    "portfolioId": "uuid",
    "benchmark": "SPY",
    "period": "1M",
    "summary": {
      "portfolioReturn": "0.0450",
      "benchmarkReturn": "0.0210",
      "alpha": "0.0240",
      "beta": "1.15",
      "correlation": "0.85"
    },
    "comparison": [
      {
        "date": "2026-11-01",
        "portfolioValue": "10450.00000000",
        "portfolioReturn": "0.0450",
        "benchmarkPrice": "570.25",
        "benchmarkReturn": "0.0210"
      }
    ]
  }
}
```

