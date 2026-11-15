# 🚀 Caching Strategy

> **Redis caching for stox with measurable performance wins.**

---

## 📌 Table of Contents

- [Overview](#-overview)
- [Cache Layers](#-cache-layers)
- [What We Cache](#-what-we-cache)
- [Cache Implementation](#-cache-implementation)
- [Invalidation Strategy](#-invalidation-strategy)
- [Performance Benchmarks](#-performance-benchmarks)
- [Metrics & Monitoring](#-metrics--monitoring)

---

## 📖 Overview

Redis is used as a caching layer in front of PostgreSQL for hot data. The goal: **reduce database load** and **improve response times** for frequently accessed data.

**Key wins:**

- 95% latency improvement on cached endpoints
- 94%+ cache hit rate on hot paths
- Reduced database CPU load

---

## 📊 Cache Layers

| Layer             | Data                            | TTL        | Invalidation |
| ----------------- | ------------------------------- | ---------- | ------------ |
| **L1: In-Memory** | Symbol metadata                 | 1 hour     | Manual       |
| **L2: Redis**     | Prices, portfolios, leaderboard | 5s - 5min  | On write     |
| **L3: Database**  | Everything                      | Persistent | —            |

---

## 🎯 What We Cache

| Data                          | Key Pattern                                                              | TTL        | Invalidation            |
| ----------------------------- | ------------------------------------------------------------------------ | ---------- | ----------------------- |
| Stock prices                  | `price:{symbol}`                                                         | 5 seconds  | On new tick             |
| Portfolio summary             | `portfolio:{id}`                                                         | 30 seconds | On trade                |
| Leaderboard                   | `leaderboard:{type}`                                                     | 60 seconds | On trade                |
| User session                  | `session:{userId}`                                                       | 7 days     | On logout               |
| Historical candles            | `history:{symbol}:{interval}:{from}:{to}`                                | 1 hour     | On new candle           |
| Symbol metadata               | `symbol:{symbol}`                                                        | 24 hours   | Manual                  |
| Portfolio P&L Heatmap         | `analytics:v1:user:{ownerId}:portfolio:{id}:heatmap:gen:{gen}`           | 5 minutes  | On trade / position chg |
| Portfolio Risk Metrics        | `analytics:v1:user:{ownerId}:portfolio:{id}:risk:gen:{gen}:{filters}`    | 5 minutes  | On snapshot capture     |
| Portfolio Benchmark           | `analytics:v1:user:{ownerId}:portfolio:{id}:benchmark:{sym}:gen:{gen}`   | 1 hour     | On benchmark update     |
| Benchmark Comparison          | `analytics:v1:user:{ownerId}:portfolio:{id}:comparison:{sym}:gen:{gen}`  | 5 minutes  | On snapshot / benchmark |
| Portfolio Monthly Performance | `analytics:v1:user:{ownerId}:portfolio:{id}:monthly:gen:{gen}:{filters}` | 5 minutes  | On snapshot / trade     |
| User Trading Statistics       | `analytics:v1:user:{userId}:statistics:gen:{gen}:{filters}`             | 2 minutes  | On trade execution      |
| User Monthly Statistics       | `analytics:v1:user:{userId}:statistics:monthly:gen:{gen}:{filters}`     | 2 minutes  | On trade execution      |

---

## 🛠️ Cache Implementation

```javascript
// services/cacheService.js
import Redis from "ioredis";

class CacheService {
    constructor() {
        this.redis = new Redis(process.env.REDIS_URL);
    }

    // ═══════════════════════════════════════════════════════════
    // PRICE CACHE (TTL: 5 seconds)
    // ═══════════════════════════════════════════════════════════
    async getPrice(symbol) {
        const key = `price:${symbol}`;
        const cached = await this.redis.get(key);

        if (cached) {
            await this.redis.incr("metrics:cache:hits");
            return JSON.parse(cached);
        }

        await this.redis.incr("metrics:cache:misses");
        return null;
    }

    async setPrice(symbol, data) {
        await this.redis.setex(`price:${symbol}`, 5, JSON.stringify(data));
    }

    // ═══════════════════════════════════════════════════════════
    // PORTFOLIO CACHE (TTL: 30 seconds)
    // ═══════════════════════════════════════════════════════════
    async getPortfolio(portfolioId) {
        const cached = await this.redis.get(`portfolio:${portfolioId}`);
        return cached ? JSON.parse(cached) : null;
    }

    async setPortfolio(portfolioId, data) {
        await this.redis.setex(
            `portfolio:${portfolioId}`,
            30,
            JSON.stringify(data),
        );
    }

    async invalidatePortfolio(portfolioId) {
        await this.redis.del(`portfolio:${portfolioId}`);
    }

    // ═══════════════════════════════════════════════════════════
    // LEADERBOARD CACHE (TTL: 60 seconds)
    // ═══════════════════════════════════════════════════════════
    async getLeaderboard(type = "global") {
        const cached = await this.redis.get(`leaderboard:${type}`);
        return cached ? JSON.parse(cached) : null;
    }

    async setLeaderboard(type, data) {
        await this.redis.setex(`leaderboard:${type}`, 60, JSON.stringify(data));
    }

    // ═══════════════════════════════════════════════════════════
    // HISTORICAL DATA CACHE (TTL: 1 hour)
    // ═══════════════════════════════════════════════════════════
    async getHistorical(symbol, interval, from, to) {
        const key = `history:${symbol}:${interval}:${from}:${to}`;
        const cached = await this.redis.get(key);
        return cached ? JSON.parse(cached) : null;
    }

    async setHistorical(symbol, interval, from, to, data) {
        const key = `history:${symbol}:${interval}:${from}:${to}`;
        await this.redis.setex(key, 3600, JSON.stringify(data));
    }

    // ═══════════════════════════════════════════════════════════
    // METRICS
    // ═══════════════════════════════════════════════════════════
    async getMetrics() {
        const hits = (await this.redis.get("metrics:cache:hits")) || 0;
        const misses = (await this.redis.get("metrics:cache:misses")) || 0;
        const total = parseInt(hits) + parseInt(misses);

        return {
            hits: parseInt(hits),
            misses: parseInt(misses),
            hitRate: total > 0 ? ((hits / total) * 100).toFixed(2) + "%" : "0%",
        };
    }
}

export default new CacheService();
```

---

## 🔄 Invalidation Strategy

**Cache invalidation is triggered on writes:**

| Action                  | Invalidates                                                                                                                   |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Trade executed          | `portfolio:{id}`, `leaderboard:global`, `leaderboard:friends:{userId}`, portfolio analytics generation, user stats generation |
| Snapshot captured       | Portfolio analytics generation for affected portfolio (`portfolio:{id}`)                                                     |
| Position/holding update | `portfolio:{id}`, portfolio analytics generation                                                                              |
| Portfolio updated       | `portfolio:{id}`, portfolio analytics generation                                                                              |
| New price tick          | `price:{symbol}` (overwritten, not deleted)                                                                                   |
| User logs out           | `session:{userId}`                                                                                                            |
| Alert triggered         | (No cache to invalidate)                                                                                                      |

### 🛡️ Generation-Guarded Invalidation & Race Protection

Analytics calculations (e.g. risk metrics, Sharpe ratio, benchmark beta/alpha, monthly aggregation) can take tens to hundreds of milliseconds on large datasets. If a trade executes while an analytics computation is in flight, a naive cache-aside pattern would allow the stale in-flight loader to write its obsolete data back into the cache after the trade has committed, serving stale analytics for the full duration of the TTL.

Stox solves this using **atomic generation counters** paired with a Lua check-and-set script:

1. **Atomic Generation Tracking:**
   - Each portfolio maintains `analytics:generation:portfolio:{portfolioId}`.
   - Each user maintains `analytics:generation:user:{userId}`.
2. **Read Path:**
   - Reader captures current generation $G_0$ before starting the database computation.
3. **Write Path (Atomic Lua Script):**
   ```lua
   if redis.call("GET", KEYS[1]) == ARGV[1] then
     redis.call("SET", KEYS[2], ARGV[2], "EX", ARGV[3])
     return 1
   end
   return 0
   ```
4. **Invalidation on Mutation:**
   - Post-commit database hooks atomically increment the generation via `INCR`.
   - Any in-flight loader holding generation $G_0$ fails the check ($G_0 \ne G_0 + 1$) and its stale result is discarded.
5. **Fail-Open Resilience:**
   - If Redis is unavailable, requests bypass the cache and compute fresh values directly from PostgreSQL without raising errors.

**Example:**

```javascript
// After trade execution
await cache.invalidatePortfolio(portfolioId);
await cache.redis.del("leaderboard:global");
await cache.redis.del(`leaderboard:friends:${userId}`);
```

**Cache-aside pattern:**

```javascript
async function getPortfolio(id) {
    // 1. Try cache
    let portfolio = await cache.getPortfolio(id);
    if (portfolio) return portfolio;

    // 2. Miss — query DB
    portfolio = await prisma.portfolio.findUnique({
        where: { id },
        include: { holdings: true },
    });

    // 3. Set cache
    if (portfolio) {
        await cache.setPortfolio(id, portfolio);
    }

    return portfolio;
}
```

---

## 📈 Performance Benchmarks

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          CACHE PERFORMANCE BENCHMARK                        │
├─────────────────────────────────────────────────────────────────────────────┤
│  Endpoint: GET /api/v1/portfolios/:id                                       │
│                                                                             │
│  Without Cache:                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  Database Query:  245ms                                              │   │
│  │  Response Time:   245ms                                              │   │
│  │  DB Load:         1 query per request                                │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  With Redis Cache:                                                          │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  Redis GET:       2ms                                                │   │
│  │  Response Time:   12ms                                               │   │
│  │  DB Load:         0 queries (cache hit)                              │   │
│  │  Improvement:     95% faster                                         │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  Cache Hit Rate: 94.3%                                                      │
│  (measured over 10,000 requests)                                            │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 📊 Metrics & Monitoring

**Expose metrics endpoint:**

```javascript
// routes/adminRoutes.js
router.get("/admin/cache-metrics", async (req, res) => {
    const metrics = await cacheService.getMetrics();
    const memory = await cacheService.redis.info("memory");
    const keys = await cacheService.redis.dbsize();

    res.json({
        hits: metrics.hits,
        misses: metrics.misses,
        hitRate: metrics.hitRate,
        totalKeys: keys,
        memoryUsage: memory,
    });
});
```

**Dashboard display:**

- Cache hit rate (live)
- Total cached keys
- Memory usage
- Response time comparison (with/without cache)
- Top cached symbols
