# 🏗️ System Architecture

> Final target architecture for the completed stox platform.

---

# 🧭 Architecture Overview

```text
                         ┌──────────────────────┐
                         │     Next.js App      │
                         │   Web Application    │
                         └──────────┬───────────┘
                                    │
                         REST / WebSocket
                                    │
                                    ▼
                         ┌──────────────────────┐
                         │     API Gateway      │
                         │       Express        │
                         └──────────┬───────────┘
                                    │
        ┌───────────────────────────┼──────────────────────────┐
        │                           │                          │
        ▼                           ▼                          ▼
┌───────────────┐          ┌────────────────┐         ┌────────────────┐
│ Authentication│          │ Trading Domain │         │ Market Domain  │
│ Authorization │          │                │         │                │
└───────────────┘          └───────┬────────┘         └───────┬────────┘
                                   │                          │
                                   │                          │
                                   ▼                          ▼
                            ┌──────────────┐           ┌──────────────┐
                            │ PostgreSQL   │           │ Redis Cache  │
                            └──────────────┘           └──────┬───────┘
                                                             │
                                                             ▼
                                                    Market Data Providers
```

---

# 🧩 Core Domains

The backend is divided conceptually into:

```text
Authentication
Users
Portfolios
Trading
Market Data
Analytics
Social
Gamification
Notifications
Administration
```

---

# 🔐 Authentication Domain

Responsible for:

- registration
- login
- Google OAuth
- JWT access tokens
- refresh tokens
- session management
- logout
- password security

---

# 📋 Trading Domain

Responsible for:

- portfolios
- orders
- order validation
- order execution
- holdings
- trades
- P&L
- cash management

The trading domain is the financial source of truth.

---

# 📊 Market Data Domain

Responsible for:

- symbol metadata
- quotes
- historical prices
- market streams
- provider abstraction
- normalization
- provider health
- caching

---

# ⚡ Real-Time Domain

Socket.IO handles:

```text
Market Updates
Order Events
Portfolio Events
Notifications
Social Events
```

Namespaces:

```text
/market
/trading
/notifications
/social
```

Rooms:

```text
stock:<symbol>
portfolio:<portfolioId>
user:<userId>
league:<leagueId>
```

---

# ⚙️ Background Processing

BullMQ workers handle:

```text
Order Execution
Price Alerts
Notifications
Copy Trading
Achievements
League Processing
Analytics Snapshots
Reports
```

---

# 🗄️ Persistence

PostgreSQL stores durable business state.

Redis stores:

- hot market data
- cache entries
- queues
- rate-limit state
- real-time coordination

---

# 🔄 Order Execution Architecture

```text
User
 │
 ▼
POST /orders
 │
 ▼
Validation
 │
 ▼
Order Created
 │
 ▼
BullMQ
 │
 ▼
Execution Worker
 │
 ▼
Market Data
 │
 ▼
Execution Conditions
 │
 ├── Not Met → remain pending
 │
 └── Met
       │
       ▼
  Database Transaction
       │
       ├── Update Order
       ├── Update Cash
       ├── Update Holding
       └── Create Trade
               │
               ▼
       Publish Event
               │
        ┌──────┼───────┐
        ▼      ▼       ▼
    Socket.IO Queue   Analytics
```

---

# 💰 Financial Consistency

The following must remain synchronized:

```text
Portfolio Cash
+
Holdings
+
Orders
+
Trades
+
Portfolio Value
```

Order execution must therefore use database transactions.

---

# 📡 Market Data Flow

```text
Finnhub / Binance
        │
        ▼
Provider Adapter
        │
        ▼
Normalization
        │
        ├───────────────┐
        ▼               ▼
      Redis          PostgreSQL
        │
        ▼
    Socket.IO
        │
        ▼
      Clients
```

---

# 🔔 Notification Flow

```text
Business Event
      │
      ▼
Event Bus
      │
      ▼
BullMQ
      │
      ▼
Notification Worker
      │
      ├── In-App
      ├── Email
      └── Push
```

---

# 📊 Analytics Flow

```text
Trades
  │
  ▼
Performance Engine
  │
  ├── Returns
  ├── P&L
  ├── Drawdown
  ├── Volatility
  ├── Sharpe Ratio
  └── Benchmarks
         │
         ▼
Performance Snapshots
         │
         ▼
Analytics API
         │
         ▼
Frontend
```

---

# 👥 Social Architecture

```text
User
 │
 ├── Follow
 ├── Social Feed
 └── Copy Trader
        │
        ▼
   Copy Trade Engine
        │
        ▼
   Order Service
        │
        ▼
   Normal Trading Flow
```

Copy trading therefore reuses the core trading engine instead of creating a separate financial state system.

---

# 🏟️ League Architecture

```text
League
  │
  ├── Participants
  ├── Start / End
  └── League Portfolio
          │
          ▼
      Performance
          │
          ▼
       Rankings
```

---

# 🛡️ Security Architecture

```text
Request
  │
  ▼
Rate Limiter
  │
  ▼
Authentication
  │
  ▼
RBAC / Ownership
  │
  ▼
Input Validation
  │
  ▼
Controller
  │
  ▼
Service
  │
  ▼
Database
```

---

# 🚀 Production Architecture

```text
                    ┌──────────────────────┐
                    │       Vercel         │
                    │     Next.js App      │
                    └──────────┬───────────┘
                               │
                               ▼
                    ┌──────────────────────┐
                    │  Backend Platform    │
                    │ Express + Socket.IO  │
                    └──────────┬───────────┘
                               │
              ┌────────────────┼────────────────┐
              ▼                ▼                ▼
        PostgreSQL           Redis            Workers
        / Supabase          / Upstash        BullMQ
              │                │                │
              └────────────────┼────────────────┘
                               ▼
                       Market Providers
```
