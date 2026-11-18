"use client";

import { io } from "socket.io-client";

const SOCKET_URL =
  process.env.NEXT_PUBLIC_SOCKET_URL || "http://localhost:8000";

const sockets = new Map();
/** symbol -> { count, assetClass } */
const marketSubscriptions = new Map();

function namespaceUrl(namespace) {
  return `${SOCKET_URL.replace(/\/$/, "")}${namespace}`;
}

export function getSocket(namespace, { token } = {}) {
  const existing = sockets.get(namespace);

  if (existing) {
    if (token && existing.auth?.token !== token) {
      existing.auth = { ...existing.auth, token };
      if (existing.connected) existing.disconnect();
      existing.connect();
    }
    return existing;
  }

  const socket = io(namespaceUrl(namespace), {
    transports: ["websocket", "polling"],
    autoConnect: true,
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 800,
    reconnectionDelayMax: 8000,
    timeout: 10000,
    auth: token ? { token } : {},
  });

  if (namespace === "/market") {
    // Rooms are not restored after a reconnect; replay every retained symbol
    // once, from a single authoritative list. Skip the first connect: any
    // symbols retained before it are already buffered by Socket.IO.
    let connectedOnce = false;
    socket.on("connect", () => {
      if (!connectedOnce) {
        connectedOnce = true;
        return;
      }

      marketSubscriptions.forEach((entry, symbol) => {
        if (entry.count > 0) {
          socket.emit("subscribe", {
            symbol,
            assetClass: entry.assetClass,
          });
        }
      });
    });
  }

  sockets.set(namespace, socket);
  return socket;
}

/**
 * Reference-count market subscriptions. Several components can watch the same
 * symbol (e.g. portfolio cards); only the last release unsubscribes upstream.
 */
export function retainMarketSymbol(symbol, assetClass) {
  const normalized = String(symbol).toUpperCase();
  const existing = marketSubscriptions.get(normalized);

  if (!existing || existing.count === 0) {
    marketSubscriptions.set(normalized, {
      count: 1,
      assetClass,
    });
    getSocket("/market").emit("subscribe", {
      symbol: normalized,
      assetClass,
    });
    return;
  }

  marketSubscriptions.set(normalized, {
    ...existing,
    count: existing.count + 1,
  });
}

export function releaseMarketSymbol(symbol) {
  const normalized = String(symbol).toUpperCase();
  const existing = marketSubscriptions.get(normalized);

  if (!existing) return;

  if (existing.count <= 1) {
    marketSubscriptions.delete(normalized);
    getSocket("/market").emit("unsubscribe", { symbol: normalized });
    return;
  }

  marketSubscriptions.set(normalized, {
    ...existing,
    count: existing.count - 1,
  });
}

export function disconnectSocket(namespace) {
  const socket = sockets.get(namespace);
  if (!socket) return;
  socket.removeAllListeners();
  socket.disconnect();
  sockets.delete(namespace);
}

export function disconnectAllSockets() {
  [...sockets.keys()].forEach(disconnectSocket);
}
