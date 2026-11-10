const cacheService = require("../services/cacheService");
const {
  normalizeAssetClass,
  normalizeSymbol,
} = require("../services/marketDataService");
const logger = require("../utils/logger");

function stockRoom(symbol) {
  return `stock:${symbol}`;
}

function readSymbol(payload) {
  // `docs/REALTIME.md` shows both `{ symbol }` and a bare string; accept both
  // and treat the object form as canonical.
  if (typeof payload === "string") {
    return payload;
  }

  return payload?.symbol;
}

function toInternalSymbol(symbol) {
  return symbol.replace(/^BINANCE:/, "");
}

/**
 * Per-symbol subscription registry for the `/market` namespace.
 *
 * A room can have many sockets but only one upstream subscription. The registry
 * owns no transport of its own: it calls whichever `priceStream` it was given
 * (WebSocket in production, polling as a fallback), which keeps this module
 * testable without opening a network connection.
 */
function createMarketRoomRegistry({
  io,
  priceStream,
  cache = cacheService,
  logger: log = logger,
} = {}) {
  if (!io) {
    throw new TypeError("createMarketRoomRegistry requires a Socket.IO server.");
  }

  if (!priceStream || typeof priceStream.subscribe !== "function") {
    throw new TypeError(
      "createMarketRoomRegistry requires a priceStream with subscribe().",
    );
  }

  const namespace = io.of("/market");
  const subscriptions = new Map();

  function normalize(payload) {
    const raw = readSymbol(payload);

    if (typeof raw !== "string" || raw.trim() === "") {
      return {
        error: {
          ok: false,
          code: "VALIDATION_ERROR",
          message: "symbol is required.",
        },
      };
    }

    try {
      const symbol = toInternalSymbol(normalizeSymbol(raw));

      return {
        symbol,
        assetClass: normalizeAssetClass(undefined, symbol),
      };
    } catch (error) {
      return {
        error: {
          ok: false,
          code: "VALIDATION_ERROR",
          message: error.message,
        },
      };
    }
  }

  function listenerFor(symbol) {
    return (tick) => {
      const entry = subscriptions.get(symbol);

      if (!entry) {
        return;
      }

      const update = {
        symbol,
        price: String(tick.price),
        volume: tick.volume ?? null,
        timestamp: tick.timestamp,
      };

      Promise.resolve(
        cache.setPrice(entry.assetClass, symbol, update),
      ).catch((error) => {
        log.warn("Price cache write failed", {
          symbol,
          message: error.message,
        });
      });

      namespace.to(stockRoom(symbol)).emit("price-update", update);
    };
  }

  async function subscribe(socket, payload) {
    const normalized = normalize(payload);

    if (normalized.error) {
      return normalized.error;
    }

    const { symbol, assetClass } = normalized;

    let entry = subscriptions.get(symbol);

    if (!entry) {
      entry = {
        assetClass,
        sockets: new Set(),
      };

      subscriptions.set(symbol, entry);
      priceStream.subscribe(symbol, listenerFor(symbol));
    }

    entry.sockets.add(socket.id);
    await socket.join(stockRoom(symbol));

    // Replay the last cached tick so a late subscriber sees a price immediately
    // instead of waiting for the next tick.
    const cached = await cache.getPrice(assetClass, symbol);

    if (cached) {
      socket.emit("price-update", cached);
    }

    return { ok: true, symbol, assetClass };
  }

  async function unsubscribe(socket, payload) {
    const normalized = normalize(payload);

    if (normalized.error) {
      return normalized.error;
    }

    const { symbol } = normalized;

    await socket.leave(stockRoom(symbol));

    const entry = subscriptions.get(symbol);

    if (entry) {
      entry.sockets.delete(socket.id);

      if (entry.sockets.size === 0) {
        priceStream.unsubscribe(symbol);
        subscriptions.delete(symbol);
      }
    }

    return { ok: true, symbol };
  }

  /**
   * Socket.IO removes the socket from its rooms on disconnect, but the upstream
   * subscription is ours to release. Without this, a disconnected client would
   * keep the provider stream alive forever.
   */
  function removeSocket(socketId) {
    for (const [symbol, entry] of subscriptions) {
      if (!entry.sockets.delete(socketId)) {
        continue;
      }

      if (entry.sockets.size === 0) {
        priceStream.unsubscribe(symbol);
        subscriptions.delete(symbol);
      }
    }
  }

  function stop() {
    for (const symbol of subscriptions.keys()) {
      priceStream.unsubscribe(symbol);
    }

    subscriptions.clear();
  }

  return {
    subscribe,
    unsubscribe,
    removeSocket,
    stop,
    subscriptions,
  };
}

module.exports = {
  createMarketRoomRegistry,
};
