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

  holdings        Holding[]
  orders          Order[]
  trades          Trade[]
  performance     PerformanceSnapshot[]

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

  limitPrice      Decimal? @db.Decimal(18, 8)
  stopPrice       Decimal? @db.Decimal(18, 8)
  executedPrice   Decimal? @db.Decimal(18, 8)

  executedAt      DateTime?
  expiresAt       DateTime?

  notes           String?
  source          OrderSource @default(MANUAL)

  trade           Trade?

  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@index([portfolioId])
  @@index([status])
  @@index([symbol])
  @@index([createdAt])
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

  @@index([portfolioId])
  @@index([symbol])
  @@index([executedAt])
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

  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@index([userId, status])
  @@index([status, symbolId])
  @@index([symbolId])
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

  createdAt       DateTime @default(now())

  @@index([userId, isRead])
  @@index([createdAt])
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

  allocationPct   Decimal  @default(100) @db.Decimal(5, 2)
  maxTradeSize    Decimal? @db.Decimal(18, 8)

  isActive        Boolean @default(true)

  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@unique([copierId, copiedId])
  @@index([copierId])
  @@index([copiedId])
}
```

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
