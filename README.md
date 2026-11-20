# stox

**A paper trading platform for US stocks and cryptocurrency, built around real market data and realistic trading workflows.**

stox lets users explore financial markets, build virtual portfolios, and test trading strategies without using real money.

## What is stox?

stox is a full-stack paper trading application that combines market data, order execution, portfolio tracking, analytics, and social trading in one platform.

Users can:

- Create and manage virtual portfolios
- Buy and sell stocks and cryptocurrencies
- Place market, limit, stop-loss, and take-profit orders
- Track open positions and portfolio performance
- Follow other traders and copy their strategies
- Participate in leaderboards and trading leagues
- Set custom price alerts
- Analyze portfolio performance and risk
- Receive real-time notifications
- Unlock achievements through trading milestones

Every account starts with virtual capital. All trading takes place within the simulator, so no real money is involved.

---

## Why stox?

Most paper trading applications focus primarily on placing trades and tracking their results.

stox takes a broader approach by bringing together the different parts of a trading platform:

- Market data from external providers
- Order management and execution
- Portfolio and position tracking
- Performance and risk analytics
- Real-time updates
- Social and copy trading
- Leaderboards and competitions

The idea is to give users a place to experiment with trading strategies, understand market movements, and evaluate their decisions without financial risk.

---

## Trading

Users receive a virtual starting balance and can use it to build and manage their portfolios.

### Order types

The platform supports:

- Market orders
- Limit orders
- Stop-loss orders
- Take-profit orders

### Position management

- Long and short positions
- Multiple portfolios
- Portfolio-level cash balances
- Holdings and average entry prices

### Order execution

Orders are evaluated against available market prices and executed when their conditions are met.

The trading engine maintains consistency across orders, trades, holdings, cash balances, and portfolio valuations.

```text
Order
  |
  v
Trade
  |
  v
Holding
  |
  v
Cash Balance
  |
  v
Portfolio Value
```

---

## Market Data

stox integrates multiple market data providers to support both stock and cryptocurrency trading.

### Stocks

US stock market data includes:

- Current prices and quotes
- Historical price candles
- Company information
- Financial news
- Market activity

### Cryptocurrency

Cryptocurrency market data includes:

- Live prices
- Recent market trades
- Order book depth
- Historical prices

Market data from different providers is normalized internally through a common interface. This keeps provider-specific implementation details separate from the rest of the application.

---

## Real-Time Updates

Several parts of the application depend on timely updates rather than repeated manual requests.

Users can receive updates for:

- Market prices
- Portfolio value changes
- Order execution
- Price alerts
- Notifications
- Social activity

Socket.IO handles real-time communication between the server and clients. Redis is used to support communication and coordination across backend instances.

---

## Portfolio Analytics

Each portfolio includes performance and risk metrics to help users understand how their investments are performing.

Available metrics include:

- Total portfolio value
- Available cash balance
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
- Benchmark comparisons
- P&L heatmaps

---

## Social Trading

stox also includes features that let users interact with other traders.

Users can:

- Follow other traders
- View public trader profiles
- Browse activity from followed users
- Copy other traders' activity
- Configure copy-trading allocation
- Set maximum copied trade sizes

Copy trading uses the same underlying order execution and portfolio management systems as regular trades.

---

## Leaderboards and Trading Leagues

### Leaderboards

Leaderboards rank traders based on portfolio performance and other supported metrics.

### Trading leagues

Users can join time-limited trading competitions with:

- Virtual starting capital
- Defined start and end dates
- Participant limits
- Rankings
- Final performance calculations

### Achievements

The platform includes achievements for different trading milestones, including:

- First trade
- First profitable trade
- Portfolio milestones
- Trading streaks
- League performance
- Strategy milestones

---

## Alerts and Notifications

Users can create price alerts for specific assets.

Examples:

```text
AAPL > $250
BTCUSDT < $100,000
```

Supported conditions include:

- Price above a target
- Price below a target
- Percentage increase
- Percentage decrease

Notifications can be delivered through:

- In-app notifications
- Email
- Push notifications

Users can configure their notification preferences.

---

## Security

Security is handled across authentication, authorization, request validation, and application-level protection.

### Authentication

- JWT access tokens
- Refresh-token rotation
- Password hashing
- Google authentication
- Session tracking

### Authorization

Role-based access control supports three roles:

```text
TRADER
MODERATOR
ADMIN
```

Resource ownership and permissions are enforced on the server.

### Application protection

- Request validation
- Rate limiting
- Security headers
- Centralized error handling
- CORS configuration
- Audit logging
- Sensitive-data sanitization

---

## Admin Platform

The platform includes administrative tools for managing users and monitoring application activity.

Implemented admin capabilities include read-only user, portfolio, and order
inspection plus user suspension controls. User account state changes are
recorded in a dedicated durable audit table. Analytics, reports, system and
market-data dashboards, and audit-log browsing are not currently mounted.

Administrative operations are protected through role-based access control.

---

## Architecture

The application follows a client-server architecture, with separate components for API handling, data storage, background processing, and real-time communication.

```text
                         +---------------------+
                         |    Next.js Web App  |
                         +----------+----------+
                                    |
                              REST / WebSocket
                                    |
                                    v
                         +---------------------+
                         |     Express API     |
                         +----------+----------+
                                    |
              +---------------------+---------------------+
              |                     |                     |
              v                     v                     v
       +--------------+      +--------------+      +--------------+
       | PostgreSQL   |      | Redis/BullMQ |      |  Socket.IO   |
       | Database     |      | Queue/Cache  |      | Real-Time    |
       +--------------+      +------+-------+      +--------------+
                                    |
                                    v
                             +--------------+
                             |   Workers    |
                             +------+-------+
                                    |
                                    v
                         +---------------------+
                         |  Market Data APIs   |
                         +---------------------+
```

---

## Technology Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js, React |
| Styling | Tailwind CSS |
| Backend | Node.js, Express |
| Database | PostgreSQL |
| ORM | Prisma |
| Cache | Redis |
| Background Jobs | BullMQ |
| Real-Time Communication | Socket.IO |
| Authentication | JWT, OAuth |
| Validation | Zod |
| Market Data | Finnhub, Binance |
| Testing | Jest, Supertest |

---

## Major Modules

The application is divided into the following functional modules:

```text
Authentication
    |
    +-- Users
    +-- Sessions
    +-- Authorization

Trading
    |
    +-- Portfolios
    +-- Orders
    +-- Trades
    +-- Holdings

Market Data
    |
    +-- Quotes
    +-- History
    +-- News
    +-- Order Book

Analytics
    |
    +-- P&L
    +-- Risk
    +-- Performance
    +-- Benchmarks

Social
    |
    +-- Follow
    +-- Feed
    +-- Copy Trading

Competition
    |
    +-- Leaderboards
    +-- Leagues
    +-- Achievements

Notifications
    |
    +-- Alerts
    +-- Email
    +-- Push
    +-- In-App

Administration
    |
    +-- Users
    +-- Analytics
    +-- Monitoring
    +-- Reports
```

---

## User Journey

A typical user workflow looks like this:

```text
Create Account
      |
      v
Receive Virtual Capital
      |
      v
Explore Markets
      |
      v
Build Portfolio
      |
      v
Place Orders
      |
      v
Orders Execute Against Market Data
      |
      v
Track Portfolio Performance
      |
      v
Analyze Risk and P&L
      |
      v
Follow or Copy Traders
      |
      v
Participate in Leagues
      |
      v
Unlock Achievements
```

---

## Documentation

The `docs/` directory contains detailed documentation covering the application's architecture, APIs, individual services, and development setup.

| Document | Description |
|---|---|
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | Technical architecture |
| [FEATURES.md](docs/FEATURES.md) | Product features |
| [DATABASE.md](docs/DATABASE.md) | Database architecture |
| [API.md](docs/API.md) | REST API specification |
| [REALTIME.md](docs/REALTIME.md) | Real-time communication |
| [BACKGROUND_JOBS.md](docs/BACKGROUND_JOBS.md) | Background job system |
| [CACHING.md](docs/CACHING.md) | Redis caching architecture |
| [NOTIFICATIONS.md](docs/NOTIFICATIONS.md) | Notification pipeline |
| [MARKET_DATA.md](docs/MARKET_DATA.md) | Market data architecture |
| [MARKET_DATA_SERVICE.md](docs/MARKET_DATA_SERVICE.md) | Market data service contract |
| [SECURITY.md](docs/SECURITY.md) | Security architecture |
| [FRONTEND.md](docs/FRONTEND.md) | Frontend architecture |
| [SETUP.md](docs/SETUP.md) | Development setup |
| [DEPLOYMENT.md](docs/DEPLOYMENT.md) | Deployment architecture |
| [PROJECT_PLAN.md](docs/PROJECT_PLAN.md) | Development roadmap |

---

# stox

**Trade. Analyze. Compete. Learn.**

A paper trading platform built to bring market data, trading, analytics, and social competition together in one place.
