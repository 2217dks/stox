# 🗄️ Database Architecture

> Final target PostgreSQL schema for stox.

---

# 🎯 Database Responsibilities

PostgreSQL is the durable source of truth for:

- users
- authentication sessions
- portfolios
- holdings
- orders
- trades
- market metadata
- price history
- alerts
- notifications
- social relationships and posts
- leaderboard snapshots
- copy trading
- achievements
- leagues
- sentiment
- performance analytics
- audit logs
- system metrics

Redis is used for temporary/high-speed state rather than replacing PostgreSQL as the source of truth.

---

# 🧩 Core Entity Model

```text
User
 ├── Sessions
 ├── RefreshTokens
 ├── Portfolios
 ├── Alerts ───────── Symbol
 ├── Notifications
 ├── Followers / Following
 ├── Posts
 ├── LeaderboardEntries
 ├── Copy Trading
 ├── Achievements
 ├── League Memberships
 └── Sentiment Votes

Portfolio
 ├── Holdings
 ├── Orders
 ├── Trades
 └── PerformanceSnapshots

Symbol
 ├── PriceHistory
 ├── Alerts
 └── SentimentVotes
```

---

# 👤 User

```prisma
model User {
  id              String    @id @default(uuid())
  email           String    @unique
  passwordHash    String
  name            String
  avatarUrl       String?

  role            Role      @default(TRADER)
  isVerified      Boolean   @default(false)
  isSuspended     Boolean   @default(false)

  emailAlerts     Boolean   @default(true)
  emailDigest     Boolean   @default(true)
  pushEnabled     Boolean   @default(false)
  pushToken       String?

  portfolios      Portfolio[]
  refreshTokens   RefreshToken[]
  alerts          Alert[]
  achievements    UserAchievement[]
  followers       Follow[]       @relation("UserFollowers")
  following       Follow[]       @relation("UserFollowing")
  copyTraders     CopyTrader[]   @relation("Copier")
  copiedBy        CopyTrader[]   @relation("Copied")
  votes           SentimentVote[]
  leagueMembers   LeagueMember[]
  notifications   Notification[]
  posts           Post[]
  leaderboardEntries LeaderboardEntry[]
  sessions        Session[]

  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  lastLoginAt     DateTime?

  @@index([email])
  @@index([role])
}
```

---

# 🔑 Authentication

## RefreshToken

```prisma
model RefreshToken {
  id          String   @id @default(uuid())
  token       String   @unique
  userId      String

  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  expiresAt   DateTime
  createdAt   DateTime @default(now())
  revokedAt   DateTime?

  userAgent   String?
  ipAddress   String?

  @@index([userId])
  @@index([token])
}
```

## Session

```prisma
model Session {
  id          String   @id @default(uuid())
  userId      String

  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  socketId    String?
  isOnline    Boolean  @default(false)
  lastSeenAt  DateTime @default(now())

  @@index([userId])
}
```

---

# 💼 Portfolio

```prisma
model Portfolio {
  id              String   @id @default(uuid())
  userId          String

  user            User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  name            String   @default("Main Portfolio")
  description     String?

  startingBalance Decimal  @default(10000) @db.Decimal(18, 8)
  cashBalance     Decimal  @default(10000) @db.Decimal(18, 8)

  isDefault       Boolean  @default(false)
  isActive        Boolean  @default(true)

  holdings             Holding[]
  orders               Order[]
  trades               Trade[]
  performanceSnapshots PerformanceSnapshot[]

  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@index([userId])
  @@unique([userId, name])
}
```

---

# 📦 Holdings

```prisma
model Holding {
  id              String   @id @default(uuid())
  portfolioId     String

  portfolio       Portfolio @relation(fields: [portfolioId], references: [id], onDelete: Cascade)

  symbol          String
  assetType       AssetType

  quantity        Decimal @db.Decimal(18, 8)
  averageBuyPrice Decimal @db.Decimal(18, 8)
  totalInvested   Decimal @db.Decimal(18, 8)

  isShort         Boolean @default(false)

  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@unique([portfolioId, symbol])
  @@index([portfolioId])
  @@index([symbol])
}
```

---

# 📋 Orders

```prisma
model Order {
  id              String   @id @default(uuid())
  portfolioId     String

  portfolio       Portfolio @relation(fields: [portfolioId], references: [id], onDelete: Cascade)

  symbol          String
  assetType       AssetType
  side            OrderSide
  type            OrderType
  status          OrderStatus @default(PENDING)

  quantity        Decimal @db.Decimal(18, 8)
  reservedCash    Decimal @default(0) @db.Decimal(18, 8)

  limitPrice      Decimal? @db.Decimal(18, 8)
  stopPrice       Decimal? @db.Decimal(18, 8)
  executedPrice   Decimal? @db.Decimal(18, 8)

  executedAt      DateTime?
  expiresAt       DateTime?

  executionAttempts      Int       @default(0)
  lastExecutionAttemptAt DateTime?

  notes           String?
  source          OrderSource @default(MANUAL)

  trade           Trade?
  events          OrderEvent[]

  copyTradeExecutionId String? @unique
  copyTradeExecution   CopyTradeExecution? @relation(fields: [copyTradeExecutionId], references: [id], onDelete: SetNull)

  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@index([portfolioId])
  @@index([portfolioId, status])
  @@index([status, createdAt])
  @@index([status, expiresAt])
  @@index([symbol, status])
}
```

`reservedCash` holds this order's share of the portfolio's cash reservation.
`Portfolio.reservedCash` is the aggregate; both are decremented in the same
transaction on execution, cancellation, expiry, or terminal rejection.
`status, expiresAt` supports the overdue sweep, which runs before the
execution batch and includes inactive portfolios.

## OrderEvent

Persistent, monotonic audit log for the order lifecycle (`CREATED`, `EXECUTED`, `CANCELLED`, `EXPIRED`, `REJECTED`). Every transition is recorded inside the exact same database transaction that updates the order status. Sequence numbers are strictly incremented per order using pessimistic row locking.

```prisma
model OrderEvent {
  id             String         @id @default(uuid())
  orderId        String
  order          Order          @relation(fields: [orderId], references: [id], onDelete: Cascade)

  sequence       Int            @default(1)
  eventType      OrderEventType
  previousStatus OrderStatus?
  newStatus      OrderStatus

  metadata       Json?

  createdAt      DateTime       @default(now())

  @@unique([orderId, sequence])
  @@index([orderId, createdAt])
}
```

---

# 💱 Trades

```prisma
model Trade {
  id              String   @id @default(uuid())
  portfolioId     String
  orderId         String   @unique

  portfolio       Portfolio @relation(fields: [portfolioId], references: [id], onDelete: Cascade)
  order           Order     @relation(fields: [orderId], references: [id], onDelete: Cascade)

  symbol          String
  assetType       AssetType
  side            OrderSide

  quantity        Decimal @db.Decimal(18, 8)
  price           Decimal @db.Decimal(18, 8)
  totalValue      Decimal @db.Decimal(18, 8)
  fees            Decimal @default(0) @db.Decimal(18, 8)

  realizedPnl     Decimal? @db.Decimal(18, 8)
  realizedPnlPct  Decimal? @db.Decimal(18, 8)

  executedAt      DateTime @default(now())

  // Set when the copy-trade fan-out pass completes (including a trade with no
  // followers). The recovery scan only picks trades where this is null.
  copyFanOutAt    DateTime?

  copyExecutions  CopyTradeExecution[]

  @@index([portfolioId])
  @@index([symbol])
  @@index([executedAt])
  @@index([portfolioId, executedAt])
  @@index([copyFanOutAt, executedAt])
}
```

---

# 📊 Market Data

## Symbol

```prisma
model Symbol {
  id              String   @id @default(uuid())
  symbol          String   @unique
  name            String
  assetType       AssetType
  exchange        String?
  currency        String   @default("USD")

  sector          String?
  industry        String?
  logoUrl         String?
  description     String?

  isActive        Boolean @default(true)
  isTradable      Boolean @default(true)

  priceHistory    PriceHistory[]
  alerts          Alert[]
  sentimentVotes  SentimentVote[]

  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@index([symbol])
  @@index([assetType])
}
```

## PriceHistory

```prisma
model PriceHistory {
  id              String   @id @default(uuid())
  symbolId        String

  symbol          Symbol   @relation(fields: [symbolId], references: [id], onDelete: Cascade)

  price           Decimal @db.Decimal(18, 8)
  open            Decimal? @db.Decimal(18, 8)
  high            Decimal? @db.Decimal(18, 8)
  low             Decimal? @db.Decimal(18, 8)
  close           Decimal? @db.Decimal(18, 8)
  volume          Decimal? @db.Decimal(18, 8)

  interval        String   @default("1m")
  timestamp       DateTime

  @@index([symbolId, timestamp])
  @@index([symbolId, interval, timestamp])
}
```

---

# 🔔 Alerts

```prisma
model Alert {
  id              String   @id @default(uuid())
  userId          String
  symbolId        String

  user            User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  symbol          Symbol   @relation(fields: [symbolId], references: [id], onDelete: Cascade)

  condition       AlertCondition
  targetPrice     Decimal @db.Decimal(18, 8)
  status          AlertStatus @default(ACTIVE)

  sendEmail       Boolean @default(true)
  sendPush        Boolean @default(false)

  triggeredAt     DateTime?
  message         String?

  // Request-time reference for PERCENT_CHANGE_UP/DOWN. `targetPrice` is a
  // percentage for those conditions and an absolute price otherwise.
  baselinePrice   Decimal? @db.Decimal(18, 8)
  baselineAt      DateTime?

  // Rotation cursor for the alert scan (oldest attempt first). Advanced even
  // when a quote fetch fails transiently, so failing symbols cannot starve
  // deferred ones.
  lastEvaluatedAt DateTime?

  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@index([userId, status])
  @@index([status, symbolId])
  @@index([symbolId])
  @@index([status, lastEvaluatedAt])
}
```

---

# 🔔 Notifications

```prisma
model Notification {
  id              String   @id @default(uuid())
  userId          String

  user            User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  type            NotificationType
  title           String
  message         String
  data            Json?

  isRead          Boolean  @default(false)
  readAt          DateTime?

  // Outbound delivery lifecycle. The row itself is the in-app record.
  deliveryStatus   NotificationDeliveryStatus @default(PENDING)
  deliveredAt      DateTime?
  deliveryAttempts Int @default(0)
  deliveryStartedAt DateTime?
  deliveryChannels Json?

  createdAt       DateTime @default(now())

  @@index([userId, isRead])
  @@index([createdAt])
  @@index([deliveryStatus, createdAt])
}
```

---

# 👥 Social

## Follow

```prisma
model Follow {
  id           String   @id @default(uuid())
  followerId   String
  followingId  String

  follower     User     @relation("UserFollowing", fields: [followerId], references: [id], onDelete: Cascade)
  following    User     @relation("UserFollowers", fields: [followingId], references: [id], onDelete: Cascade)

  createdAt    DateTime @default(now())

  @@unique([followerId, followingId])
  @@index([followerId])
  @@index([followingId])
}
```

## Post

```prisma
model Post {
  id String @id @default(uuid())

  authorId String
  author User @relation(
    fields: [authorId],
    references: [id],
    onDelete: Cascade
  )

  content  String
  symbol   String?
  metadata Json?

  isHidden  Boolean  @default(false)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([authorId, createdAt])
  @@index([createdAt])
}
```

## CopyTrader

```prisma
model CopyTrader {
  id              String   @id @default(uuid())
  copierId        String
  copiedId        String

  copier          User     @relation("Copier", fields: [copierId], references: [id], onDelete: Cascade)
  copied          User     @relation("Copied", fields: [copiedId], references: [id], onDelete: Cascade)

  copyPortfolioId String?
  copyPortfolio   Portfolio? @relation("CopyDestination", fields: [copyPortfolioId], references: [id], onDelete: SetNull)

  allocationPct   Decimal  @default(100) @db.Decimal(5, 2)
  maxTradeSize    Decimal? @db.Decimal(18, 8)

  isActive        Boolean @default(true)

  executions      CopyTradeExecution[]

  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@unique([copierId, copiedId])
  @@index([copierId, isActive])
  @@index([copiedId, isActive])
  @@index([copyPortfolioId])
}
```

PostgreSQL CHECK constraints require `allocationPct` to be greater than `0` and
at most `100`, reject self-copy relationships where `copierId = copiedId`, and
require a provided `maxTradeSize` to be greater than `0`.

`copyPortfolioId` is the destination for copied orders. The API stores the
copier's default active portfolio when the request omits it. The column stays
nullable so deleting a portfolio does not erase the relationship; fan-out
resolves the default again in that case.

`maxTradeSize` is a notional (quote-currency) sizing cap. Fan-out converts it
to a quantity at the source trade price and rounds the copied quantity down to
the 8-decimal column scale. Copied orders are `MARKET` orders, so the follower's
actual fill price can differ and the final executed notional is not guaranteed
to be at or below the cap; the cap bounds the quantity sized from the source
price.

## CopyTradeExecution

```prisma
enum CopyExecutionStatus {
  PENDING
  PLACED
  FAILED
  SKIPPED
}

model CopyTradeExecution {
  id             String   @id @default(uuid())

  sourceTradeId  String
  sourceTrade    Trade    @relation(fields: [sourceTradeId], references: [id], onDelete: Cascade)

  copierId       String
  copier         User     @relation("CopyExecutions", fields: [copierId], references: [id], onDelete: Cascade)

  copyTraderId   String?
  copyTrader     CopyTrader? @relation(fields: [copyTraderId], references: [id], onDelete: SetNull)

  status         CopyExecutionStatus @default(PENDING)
  attempts       Int @default(0)
  failureCode    String?
  failureMessage String?

  order          Order?

  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  @@unique([sourceTradeId, copierId])
  @@index([copierId, createdAt])
  @@index([status, createdAt])
  @@index([copyTraderId])
}
```

One row per `(source trade, copier)` is the durable idempotency guard for the
copy-trade fan-out. `PLACED` means the copied order was created (not
necessarily filled); `FAILED` and `SKIPPED` are terminal for that follower;
`PENDING` means a transient failure may be retried up to the attempt budget.
`Order.copyTradeExecutionId` is unique, so a replay cannot create a second
order for the same execution row even if the status update was lost.

---

# 🏆 Leaderboards

```prisma
model LeaderboardEntry {
  id String @id @default(uuid())

  userId String
  user User @relation(
    fields: [userId],
    references: [id],
    onDelete: Cascade
  )

  scope  LeaderboardScope
  period LeaderboardPeriod

  rank         Int
  totalValue   Decimal @db.Decimal(18, 8)
  returnPct    Decimal @db.Decimal(10, 4)
  snapshotDate DateTime @db.Date
  createdAt    DateTime @default(now())

  @@unique([scope, period, snapshotDate, userId])
  @@index([scope, period, snapshotDate, rank])
}
```

---

# 🏅 Achievements

```prisma
model Achievement {
  id              String   @id @default(uuid())
  code            String   @unique
  name            String
  description     String
  iconUrl         String?
  category        String
  criteria        Json

  createdAt       DateTime @default(now())

  userAchievements UserAchievement[]
}
```

```prisma
model UserAchievement {
  id              String   @id @default(uuid())
  userId          String
  achievementId   String
  reason          String   // Snapshot of Achievement.description at grant time.

  user            User @relation(fields: [userId], references: [id], onDelete: Cascade)
  achievement     Achievement @relation(fields: [achievementId], references: [id], onDelete: Cascade)

  unlockedAt      DateTime @default(now())

  @@unique([userId, achievementId])
  @@index([userId])
}
```

---

# 🏟️ Leagues

```prisma
model League {
  id              String   @id @default(uuid())
  name            String
  description     String?

  startDate       DateTime
  endDate         DateTime

  startingBalance Decimal  @default(10000) @db.Decimal(18, 8)
  maxParticipants Int?

  status          LeagueStatus @default(UPCOMING)

  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  members         LeagueMember[]

  @@index([status])
  @@index([startDate])
}
```

```prisma
model LeagueMember {
  id              String   @id @default(uuid())
  leagueId        String
  userId          String
  portfolioId     String   @unique

  league          League    @relation(fields: [leagueId], references: [id], onDelete: Cascade)
  user            User      @relation(fields: [userId], references: [id], onDelete: Cascade)

  rank            Int?
  finalReturn     Decimal? @db.Decimal(10, 4)

  joinedAt        DateTime @default(now())

  @@unique([leagueId, userId])
  @@index([leagueId])
  @@index([userId])
}
```

---

# 📊 Sentiment

```prisma
model SentimentVote {
  id          String   @id @default(uuid())
  userId      String
  symbolId    String

  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  symbol      Symbol   @relation(fields: [symbolId], references: [id], onDelete: Cascade)

  sentiment   Sentiment
  createdAt   DateTime @default(now())

  @@unique([userId, symbolId])
  @@index([symbolId])
}
```

---

# 📈 Performance

```prisma
model PerformanceSnapshot {
  id              String   @id @default(uuid())
  portfolioId     String

  portfolio       Portfolio @relation(fields: [portfolioId], references: [id], onDelete: Cascade)

  totalValue      Decimal @db.Decimal(18, 8)
  cashBalance     Decimal @db.Decimal(18, 8)
  holdingsValue   Decimal @db.Decimal(18, 8)

  dailyPnl        Decimal @db.Decimal(18, 8)
  dailyPnlPct     Decimal @db.Decimal(10, 4)

  snapshotDate    DateTime @db.Date

  createdAt       DateTime @default(now())

  @@unique([portfolioId, snapshotDate])
  @@index([portfolioId])
  @@index([snapshotDate])
}
```

---

# 🛡️ Administration

## AuditLog

```prisma
model AuditLog {
  id           String   @id @default(uuid())
  userId       String?

  action       String
  resource     String
  resourceId   String?
  changes      Json?

  ipAddress    String?
  userAgent    String?

  createdAt    DateTime @default(now())

  @@index([userId])
  @@index([action])
  @@index([createdAt])
}
```

## SystemMetric

```prisma
model SystemMetric {
  id          String   @id @default(uuid())
  metric      String
  value       Decimal  @db.Decimal(18, 8)
  metadata    Json?

  recordedAt  DateTime @default(now())

  @@index([metric])
  @@index([recordedAt])
}
```

---

# 🔢 Enums

```prisma
enum Role {
  TRADER
  ADMIN
  MODERATOR
}

enum AssetType {
  STOCK
  CRYPTO
  FOREX
}

enum OrderSide {
  BUY
  SELL
}

enum OrderType {
  MARKET
  LIMIT
  STOP_LOSS
  TAKE_PROFIT
}

enum OrderStatus {
  PENDING
  EXECUTED
  CANCELLED
  EXPIRED
  REJECTED
}

enum OrderEventType {
  CREATED
  EXECUTED
  CANCELLED
  EXPIRED
  REJECTED
}

enum OrderSource {
  MANUAL
  COPY_TRADE
  DCA_BOT
  LEAGUE
}

enum AlertCondition {
  PRICE_ABOVE
  PRICE_BELOW
  PERCENT_CHANGE_UP
  PERCENT_CHANGE_DOWN
}

enum AlertStatus {
  ACTIVE
  TRIGGERED
  EXPIRED
  CANCELLED
}

enum NotificationType {
  ORDER_EXECUTED
  PRICE_ALERT
  ACHIEVEMENT_UNLOCKED
  COPY_TRADE_EXECUTED
  LEAGUE_UPDATE
  NEW_FOLLOWER
  SYSTEM
}

enum NotificationDeliveryStatus {
  PENDING
  SENDING
  DELIVERED
  SKIPPED
  FAILED
}

enum LeaderboardScope {
  GLOBAL
  FRIENDS
}

enum LeaderboardPeriod {
  DAILY
  WEEKLY
  MONTHLY
  ALL_TIME
}

enum LeagueStatus {
  UPCOMING
  ACTIVE
  COMPLETED
  CANCELLED
}

enum Sentiment {
  BULLISH
  BEARISH
  NEUTRAL
}
```

---

# 🔗 Core Relationship Map

```text
User
 │
 ├── RefreshToken
 ├── Session
 ├── Portfolio
 │    ├── Holding
 │    ├── Order
 │    │    └── Trade
 │    └── PerformanceSnapshot
 │
 ├── Alert ───── Symbol
 ├── Notification
 ├── Follow
 ├── Post
 ├── LeaderboardEntry
 ├── CopyTrader
 ├── UserAchievement ─── Achievement
 ├── LeagueMember ────── League
 └── SentimentVote ───── Symbol

Symbol
 └── PriceHistory
```

---

# 🎯 Design Principles

### Financial precision

Monetary and quantity values use `Decimal`.

### Transactional consistency

Order execution updates related financial state atomically.

### Ownership isolation

User-owned data is linked to the owning user or portfolio.

### Durable state vs temporary state

PostgreSQL stores durable business state.

Redis handles temporary/high-speed workloads.

### Auditability

Administrative and sensitive actions are recorded through `AuditLog`.

---

# 🛡️ Query safety review (49.3)

This review covers raw SQL, user-controlled filters, unbounded reads, and the
indexes added for the order-expiry and copy-trade paths.

## Raw SQL inventory

Every raw query uses Prisma's tagged-template API or `Prisma.sql` composition,
which binds every interpolation as a parameter. There are no calls to
`$queryRawUnsafe`, `$executeRawUnsafe`, `Prisma.raw`, or string-built SQL.

| File | Raw operation | Why raw | Safety |
| --- | --- | --- | --- |
| `workers/orderWorker.js` | `SELECT ... FROM "Portfolio" ... FOR UPDATE` | Row lock before a status/reservation change | Tagged template |
| `services/orderService.js` | Portfolio `FOR UPDATE` on create/cancel | Serialize cash-affecting writes | Tagged template |
| `services/tradeService.js` | `INSERT ... ON CONFLICT` holding upsert | Atomic quantity/cost-basis update | Tagged template |
| `services/tradeService.js` | `SELECT ... FOR UPDATE` on the holding | Atomic sell quantity/basis read | Tagged template |
| `services/tradeService.js` | Portfolio `FOR UPDATE` | Serialize execution against deactivation/cancel | Tagged template |
| `services/orderEventService.js` | Order `FOR UPDATE` + latest-sequence read | Gap-free event sequence allocation | Tagged template |
| `services/portfolioMonthlyService.js` | Monthly realized-P&L aggregate | `TO_CHAR`/`GROUP BY` aggregation | `Prisma.sql` + `Prisma.join` |
| `services/userStatisticsService.js` | Monthly/overall trade aggregates | CTEs and conditional counts | `Prisma.sql` + `Prisma.join` |
| `controllers/healthController.js` | `SELECT 1` | Liveness probe | Tagged template |

`tests/unit/security/sqlSafety.test.js` fails the build if an unsafe raw API
appears or if a `$queryRaw`/`$executeRaw` call is not a tagged template or
`Prisma.sql` composition.

## User-controlled filters and ordering

- `GET /orders` and `GET /trades` validate enums, UUIDs, symbols, and date
  windows with Zod. `GET /trades` additionally restricts `sort` to
  `TRADE_SORT_FIELDS` (`executedAt`, `totalValue`) and `order` to `asc|desc`;
  the service never interpolates a raw sort string into SQL.
- `GET /orders` uses a fixed `createdAt desc` order.
- Admin list endpoints validate `status`, `role`, `isActive`, `isSuspended`,
  `isVerified`, date bounds, and pagination before building a Prisma `where`.
- Copy-trading list/filter inputs are enums/UUIDs/booleans, and the fan-out
  query uses a fixed id ordering.
- Raw aggregate queries bind `portfolioId`, `symbol`, `side`, and date bounds
  through `Prisma.sql` parameters, including enum casts
  (`${filters.side}::"OrderSide"`).

## Bounded reads

- Every paginated API uses `skip`/`take` and a `count` for pagination.
- Worker scans are bounded: pending orders (`limit`), overdue expiry
  (`limit`), notifications (`batchSize`), and alerts (`limit` plus
  `ALERT_SCAN_MAX_SYMBOLS`).
- Copy-trade fan-out pages followers in id-ordered batches of 200 instead of
  loading an unbounded following into memory.

### Residual risks

- `GET /social/followers` and `GET /social/following` return the full list.
  A user with a very large following can produce a large response; adding
  pagination is a contract change and is left as a follow-up.
- `listUserPortfolios` and `getHoldings` return all rows for one portfolio.
  The row counts are naturally small, but they are not hard-capped.
- The portfolio-snapshot worker loads all active portfolios and builds an
  `in` list. Very large deployments should batch that job.
- The per-order worker and alert evaluator still perform per-row/provider
  calls. They are bounded by the batch limit, not parallelized, so a slow
  provider delays the pass rather than exhausting the database.

## Indexes added by this review

| Index | Supports |
| --- | --- |
| `Order(status, expiresAt)` | Overdue-expiry sweep |
| `Notification(deliveryStatus, createdAt)` | Pending-delivery scan |
| `CopyTrader(copiedId, isActive)` | Active-follower fan-out |
| `CopyTrader(copierId, isActive)` | Owner-scoped configuration list |
| `CopyTrader(copyPortfolioId)` | Portfolio relation / destination cleanup |
| `CopyTradeExecution(sourceTradeId, copierId)` (unique) | Fan-out idempotency |
| `CopyTradeExecution(copierId, createdAt)` | Copier execution history |
| `CopyTradeExecution(status, createdAt)` | Retry/failure inspection |
| `CopyTradeExecution(copyTraderId)` | Relationship relation |
| `Order(copyTradeExecutionId)` (unique) | Copied-order idempotency |
| `Trade(copyFanOutAt, executedAt)` | Recovery scan for a fan-out enqueue lost during a Redis outage |

The single-column `CopyTrader(copierId)` and `CopyTrader(copiedId)` indexes
were replaced by the composite `(…, isActive)` indexes, which serve the same
lookups and the fan-out/list filters without duplicate write overhead.
