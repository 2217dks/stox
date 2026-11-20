# 🎨 Frontend Architecture

> **Next.js frontend for stox.**

---

## 📌 Table of Contents

- [Overview](#-overview)
- [Page Structure](#-page-structure)
- [Component Hierarchy](#-component-hierarchy)
- [State Management](#-state-management)
- [Real-Time Hook](#-real-time-hook)
- [Folder Structure](#-folder-structure)

---

## 📖 Overview

The frontend uses **Next.js 16** (App Router), **Tailwind CSS 4**, and React 19. It handles:

- Authentication (login/register)
- Real-time price displays
- Trading interface (order forms, charts)
- Portfolio analytics (P&L heatmap, allocation charts)
- Social features (feed, leaderboard, copy trading)
- Admin panel

---

## 📄 Page Structure

```
/                           → Landing page (public)
/login                      → Login page
/register                   → Registration page
/dashboard                  → Main dashboard (protected)
/market                     → Market overview
/market/[symbol]            → Individual asset view
/trade                      → Trading interface
/portfolio                  → Portfolio overview
/portfolio/[id]             → Specific portfolio
/orders                     → Order management
/alerts                     → Price alerts
/social                     → Social feed
/leaderboard                → Leaderboard
/leagues                    → Trading leagues
/achievements               → User achievements
/settings                   → User settings
/admin                      → Admin panel (admin only)
```

---

## 🧩 Component Hierarchy

```typescript
<App>
  <AuthProvider>
    <SocketProvider>
      <ThemeProvider>
        <Layout>
          <Sidebar />
          <Header />
          <MainContent>
            {/* Page-specific content */}
          </MainContent>
        </Layout>
      </ThemeProvider>
    </SocketProvider>
  </AuthProvider>
</App>
```

**Key component groups:**

- `ui/` — Button, Input, Card, Modal, Table, Badge
- `charts/` — PriceChart, PortfolioChart, PnLHeatmap, AllocationPie
- `trading/` — OrderForm, OrderBook, TradeTape, PositionCard
- `social/` — FeedItem, FollowButton, CopyTraderCard
- `layout/` — Sidebar, Header, Footer

---

## 🧠 State Management

| State Type          | Solution               | Example                       |
| ------------------- | ---------------------- | ----------------------------- |
| **Server State**    | React Query / SWR      | Portfolio data, trade history |
| **Real-time State** | Socket.IO + Context    | Live prices, notifications    |
| **UI State**        | Zustand                | Modal open/close, theme       |
| **Form State**      | React Hook Form        | Login, order placement        |
| **Auth State**      | Context + localStorage | User session, tokens          |

---

## ⚡ Real-Time Hook

```typescript
// hooks/useMarketData.ts
import { useEffect, useState } from "react";
import { io, Socket } from "socket.io-client";

interface PriceData {
    symbol: string;
    price: number;
    volume: number;
    timestamp: number;
}

export function useMarketData(symbols: string[]) {
    const [prices, setPrices] = useState<Record<string, PriceData>>({});
    const [socket, setSocket] = useState<Socket | null>(null);
    const [isConnected, setIsConnected] = useState(false);

    useEffect(() => {
        const newSocket = io(`${process.env.NEXT_PUBLIC_API_URL}/market`, {
            transports: ["websocket"],
            reconnection: true,
            reconnectionDelay: 1000,
            reconnectionAttempts: 10,
        });

        newSocket.on("connect", () => {
            setIsConnected(true);
            symbols.forEach((symbol) => newSocket.emit("subscribe", symbol));
        });

        newSocket.on("price-update", (data: PriceData) => {
            setPrices((prev) => ({ ...prev, [data.symbol]: data }));
        });

        newSocket.on("disconnect", () => setIsConnected(false));

        newSocket.on("reconnect", () => {
            symbols.forEach((symbol) => newSocket.emit("subscribe", symbol));
        });

        setSocket(newSocket);

        return () => {
            symbols.forEach((symbol) => newSocket.emit("unsubscribe", symbol));
            newSocket.disconnect();
        };
    }, [symbols.join(",")]);

    return { prices, isConnected, socket };
}
```

---

## 📁 Folder Structure

```
frontend/
├── src/
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx
│   │   ├── (auth)/
│   │   │   ├── login/page.tsx
│   │   │   └── register/page.tsx
│   │   ├
```
