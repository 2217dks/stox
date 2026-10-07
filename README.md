# 📈 stox

> **A realistic paper-trading platform for US stocks and cryptocurrency — built to make trading feel real without risking real money.**

---

## 🎯 What is stox?

**stox** is a full-stack paper trading platform that lets users practice trading with virtual money while working with real market data.

Users can:

- Build and manage virtual portfolios
- Buy and sell stocks and cryptocurrency
- Place market, limit, stop-loss, and take-profit orders
- Track live positions and profit/loss
- Follow other traders
- Copy trading strategies
- Compete on leaderboards and trading leagues
- Set price alerts
- Analyze portfolio performance and risk
- Receive real-time notifications
- Earn achievements through trading milestones

Every account starts with virtual funds. No real money is involved.

---

# 🌟 Why stox?

Traditional paper-trading platforms often focus only on placing orders.

stox is designed to simulate a much broader trading experience:

```text
Real Market Data
       +
Realistic Order Execution
       +
Portfolio Management
       +
Risk & Performance Analytics
       +
Real-Time Updates
       +
Social Trading
       +
Competition & Gamification
```

The goal is to make learning and experimenting with trading engaging without financial risk.

---

# 💰 Trading Experience

Users receive a virtual starting balance and can build their own portfolios.

The platform supports:

### Orders

- Market orders
- Limit orders
- Stop-loss orders
- Take-profit orders

### Position Management

- Long positions
- Short positions
- Multiple portfolios
- Portfolio-level cash balances
- Holdings and average entry prices

### Order Execution

Orders are evaluated against live market prices and executed according to their conditions.

The platform maintains consistency between:

```text
Order
  ↓
Trade
  ↓
Holding
  ↓
Cash Balance
  ↓
Portfolio Value
```

---

# 📊 Live Markets

stox combines multiple market-data sources to provide a single trading experience.

### Stocks

US stock market data including:

- Prices
- Historical candles
- Company information
- News
- Market activity

### Cryptocurrency

Cryptocurrency market data including:

- Live prices
- Market trades
- Order-book depth
- Historical prices

The application normalizes market data internally so the rest of the platform does not need to care which provider supplied it.

---

# ⚡ Real-Time Experience

The application is designed around real-time updates.

Users can see:

- Live market prices
- Portfolio-value changes
- Order execution updates
- Price-alert events
- Notifications
- Social activity

Socket.IO provides the real-time communication layer while Redis supports scaling across multiple backend instances.

---

# 📈 Portfolio Analytics

Every portfolio provides detailed performance information.

Users can view:

- Total portfolio value
- Cash balance
- Holdings value
- Realized P&L
- Unrealized P&L
- Daily P&L
- Return percentage
- Win rate
- Asset allocation
- Historical performance
- Maximum drawdown
- Volatility
- Sharpe ratio
- Performance against benchmarks
- P&L heatmaps

---

# 👥 Social Trading

stox includes a social trading layer.

Users can:

- Follow other traders
- View public trader profiles
- See activity from followed traders
- Copy traders
- Control copy-trading allocation
- Set maximum copied trade sizes

Copy trading is executed through the same core order and portfolio engine as normal trading.

---

# 🏆 Competition & Gamification

Trading becomes competitive through:

### Leaderboards

Rank traders using performance metrics such as portfolio return.

### Trading Leagues

Users can participate in time-limited competitions with:

- Starting virtual capital
- Defined start/end dates
- Rankings
- Final returns
- Participant limits

### Achievements

Users unlock achievements for milestones such as:

- First trade
- First profitable trade
- Portfolio milestones
- Trading streaks
- League performance
- Strategy milestones

---

# 🔔 Alerts & Notifications

Users can configure price alerts such as:

```text
AAPL > $250
BTCUSDT < $100,000
```

Supported alert conditions include:

- Price above target
- Price below target
- Percentage increase
- Percentage decrease

Notifications can be delivered through:

- In-app notifications
- Email
- Push notifications

Users control their notification preferences.

---

# 🔐 Security

stox uses a layered security model.

### Authentication

- JWT access tokens
- Secure refresh-token rotation
- Password hashing
- Google authentication
- Session tracking

### Authorization

Role-based permissions support:

```text
TRADER
MODERATOR
ADMIN
```

Resource ownership is enforced server-side.

### Protection

The platform includes:

- Request validation
- Rate limiting
- Security headers
- Centralized error handling
- CORS protection
- Audit logging
- Sensitive-data sanitization

---

# 🛡️ Admin Platform

Administrators have access to platform-level management tools.

Admin capabilities include:

- User management
- User suspension
- Platform analytics
- System health monitoring
- Market-data monitoring
- Report generation
- Audit-log inspection

Administrative operations are protected by RBAC.

---

# 🧠 High-Level Architecture

```text
                         ┌─────────────────────┐
                         │     Next.js Web App  │
                         └──────────┬──────────┘
                                    │
                              REST / WebSocket
                                    │
                                    ▼
                         ┌─────────────────────┐
                         │     Express API     │
                         └──────────┬──────────┘
                                    │
             ┌──────────────────────┼──────────────────────┐
             │                      │                      │
             ▼                      ▼                      ▼
      ┌──────────────┐       ┌──────────────┐       ┌──────────────┐
      │ PostgreSQL   │       │ Redis/BullMQ │       │  Socket.IO   │
      │   Database   │       │ Queue/Cache  │       │ Real-Time    │
      └──────────────┘       └──────┬───────┘       └──────────────┘
                                    │
                                    ▼
                             ┌──────────────┐
                             │   Workers    │
                             └──────┬───────┘
                                    │
                                    ▼
                         ┌─────────────────────┐
                         │  Market Data APIs   │
                         └─────────────────────┘
```

---

# 🛠️ Technology

| Layer           | Technology        |
| --------------- | ----------------- |
| Frontend        | Next.js + React   |
| Styling         | Tailwind CSS      |
| Backend         | Node.js + Express |
| Database        | PostgreSQL        |
| ORM             | Prisma            |
| Cache           | Redis             |
| Background Jobs | BullMQ            |
| Real-Time       | Socket.IO         |
| Authentication  | JWT + OAuth       |
| Validation      | Zod               |
| Market Data     | Finnhub + Binance |
| Testing         | Jest + Supertest  |

---

# 🏗️ Major Product Modules

```text
Authentication
        │
        ├── Users
        ├── Sessions
        └── Authorization

Trading
        │
        ├── Portfolios
        ├── Orders
        ├── Trades
        └── Holdings

Market Data
        │
        ├── Quotes
        ├── History
        ├── News
        └── Order Book

Analytics
        │
        ├── P&L
        ├── Risk
        ├── Performance
        └── Benchmarks

Social
        │
        ├── Follow
        ├── Feed
        └── Copy Trading

Competition
        │
        ├── Leaderboards
        ├── Leagues
        └── Achievements

Notifications
        │
        ├── Alerts
        ├── Email
        ├── Push
        └── In-App

Administration
        │
        ├── Users
        ├── Analytics
        ├── Monitoring
        └── Reports
```

---

# 🌎 Target User Journey

```text
Create Account
      ↓
Receive Virtual Capital
      ↓
Explore Markets
      ↓
Build Portfolio
      ↓
Place Orders
      ↓
Orders Execute Against Market Data
      ↓
Track Portfolio Performance
      ↓
Analyze Risk & P&L
      ↓
Follow / Copy Traders
      ↓
Compete in Leagues
      ↓
Earn Achievements
```

---

# 📚 Documentation

| Document                                      | Description                     |
| --------------------------------------------- | ------------------------------- |
| [ARCHITECTURE.md](docs/ARCHITECTURE.md)       | Complete technical architecture |
| [FEATURES.md](docs/FEATURES.md)               | Complete product feature set    |
| [DATABASE.md](docs/DATABASE.md)               | Final database architecture     |
| [API.md](docs/API.md)                         | REST API specification          |
| [REALTIME.md](docs/REALTIME.md)               | Real-time architecture          |
| [BACKGROUND_JOBS.md](docs/BACKGROUND_JOBS.md) | Background job system           |
| [CACHING.md](docs/CACHING.md)                 | Redis caching architecture      |
| [NOTIFICATIONS.md](docs/NOTIFICATIONS.md)     | Notification pipeline           |
| [MARKET_DATA.md](docs/MARKET_DATA.md)         | Market-data architecture        |
| [SECURITY.md](docs/SECURITY.md)               | Security architecture           |
| [FRONTEND.md](docs/FRONTEND.md)               | Frontend architecture           |
| [SETUP.md](docs/SETUP.md)                     | Project setup                   |
| [DEPLOYMENT.md](docs/DEPLOYMENT.md)           | Deployment architecture         |
| [PROJECT_PLAN.md](docs/PROJECT_PLAN.md)       | Development roadmap             |

---

# 📈 stox

### **Trade. Analyze. Compete. Learn.**

A realistic trading simulator without the financial risk.
