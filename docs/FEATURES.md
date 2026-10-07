# ✨ Features

> Complete end-state feature specification for stox.

---

# 🎯 Core Trading

## User Accounts

- Email/password registration
- JWT authentication
- Google authentication
- Secure session management
- Profile management
- Notification preferences

---

## Virtual Capital

Every user receives virtual starting capital.

Users can:

- Deposit virtual starting capital through supported portfolio creation
- Maintain multiple portfolios
- Track cash independently per portfolio
- Compare strategies across portfolios

---

## Market Orders

Market orders execute against the latest available market price.

Supported:

- BUY
- SELL
- Stocks
- Crypto
- Forex where market-data support exists

---

## Limit Orders

Users define a maximum/minimum acceptable execution price.

Examples:

```text
BUY AAPL at ≤ $250
SELL AAPL at ≥ $300
```

---

## Stop-Loss Orders

Automatically trigger when an asset reaches the defined stop condition.

---

## Take-Profit Orders

Automatically trigger when an asset reaches the desired profit level.

---

## Short Selling

Users can open short positions and profit from downward price movement.

The system tracks:

- Short quantity
- Entry price
- Current value
- Unrealized P&L
- Realized P&L

---

## Multiple Portfolios

Users can maintain separate strategies such as:

```text
Long Term
Day Trading
Crypto
Experimental
```

Each portfolio maintains independent:

- cash
- holdings
- orders
- trades
- performance

---

# 📊 Portfolio Management

Each portfolio displays:

- Total value
- Cash
- Holdings value
- Daily change
- Total return
- Realized P&L
- Unrealized P&L
- Allocation

Each holding includes:

- Symbol
- Asset type
- Quantity
- Average price
- Current price
- Invested value
- Current value
- P&L
- P&L percentage

---

# 📈 Analytics

## Performance

- Daily return
- Cumulative return
- Portfolio value history
- Benchmark comparison

## Risk

- Volatility
- Maximum drawdown
- Sharpe ratio
- Risk-adjusted performance

## Trading Statistics

- Win rate
- Winning trades
- Losing trades
- Average trade return
- Best trade
- Worst trade
- Total trading volume

---

# 📅 P&L Heatmap

A calendar-style visualization displays daily portfolio performance.

Each day represents:

```text
date
+
daily P&L
+
daily return
```

---

# 📡 Market Data

## Stocks

- Live quotes
- Historical candles
- Company metadata
- News
- Trading status

## Crypto

- Live quotes
- Trade tape
- Order-book depth
- Historical data

---

# ⚡ Real-Time Features

Live updates include:

- market prices
- order execution
- portfolio value
- holdings
- notifications
- price alerts
- social activity

---

# 🔔 Price Alerts

Users can create alerts based on:

- Price above
- Price below
- Percentage increase
- Percentage decrease

Alerts can automatically expire or become triggered.

---

# 👥 Social Features

## Profiles

Users can publish selected trading information through a public profile.

## Following

Users can:

- Follow traders
- Unfollow traders
- View followers
- View following

## Social Feed

The feed can include events such as:

```text
New trade
Achievement unlocked
League result
Portfolio milestone
```

---

# 🔄 Copy Trading

Users can choose another trader to copy.

Copy settings include:

- Allocation percentage
- Maximum trade size
- Active/inactive state

A copied trade enters the copier's portfolio through the normal order execution system.

---

# 🏆 Leaderboards

Global leaderboards rank traders according to configurable performance metrics.

Examples:

- Total return
- Monthly return
- League performance
- Win rate

---

# 🏟️ Trading Leagues

Users can join time-bound competitions.

Each league defines:

- Name
- Description
- Start date
- End date
- Starting balance
- Participant limit
- Status

League statuses:

```text
UPCOMING
ACTIVE
COMPLETED
CANCELLED
```

Each participant receives a league-specific portfolio.

---

# 🏅 Achievements

Achievements are defined using configurable criteria.

Examples:

- First Trade
- First Profit
- 10 Successful Trades
- Portfolio Milestone
- League Winner
- Consistent Trader

Achievement unlocking is processed asynchronously.

---

# 📊 Market Sentiment

Users can vote:

```text
BULLISH
BEARISH
NEUTRAL
```

for supported symbols.

Aggregated sentiment can be displayed alongside market information.

---

# 🔔 Notifications

Notification types include:

- Order executed
- Price alert
- Achievement unlocked
- Copy trade executed
- League updates
- System notifications

Channels:

- In-app
- Email
- Push

---

# 🛡️ Administration

Administrators can:

- List users
- Search users
- Filter users
- Suspend users
- Review account information
- View platform analytics
- Monitor market-data providers
- Inspect system health
- Generate reports
- Inspect audit logs

---

# 📈 Platform Analytics

Admin analytics include:

- Total users
- Active users
- Total portfolios
- Total orders
- Executed trades
- Trading volume
- Most traded symbols
- Platform-wide returns
- Active leagues
- Notification volume

---

# 🧪 Reliability Features

The completed system should support:

- Database transactions
- Idempotent background jobs
- Retry handling
- Real-time reconnection
- Cache invalidation
- Market-data fallback
- Error recovery
- Health monitoring

---

# 🚀 Stretch Features

Potential extensions:

- Backtesting
- Strategy simulation
- Webhook alerts
- External API access
- User API keys
- Mobile application
- Advanced trading bots
