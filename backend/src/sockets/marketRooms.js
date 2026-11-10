const cacheService = require("../services/cacheService");
const marketDataService = require("../services/marketData");
const {
  normalizeAssetClass,
  normalizeSymbol,
} = require("../services/marketDataService");
const logger = require("../utils/logger");

const DEFAULT_POLL_INTERVAL_MS = 5000;

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

/**
 * Per-symbol subscription registry for the `/market` namespace.
 *
 * A room can have many sockets but only one upstream poll. The first subscriber
 * starts the poller, the last one to leave stops it, and a later subscriber gets
 * the most recent cached quote immediately instead of waiting for the next tick.
 *
 * The polling implementation is deliberately behind the `priceSource` seam:
 * when the streaming provider lands, it replaces `getQuote` polling without the
 * namespace or the room logic changing.
 */
function createMarketRoomRegistry({
  io,
  priceSource = marketDataService,
  cache = cacheService,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
} = {}) {
  if (!io) {
    throw new TypeError("createMarketRoomRegistry requires a Socket.IO server.");
  }

  const namespace = io.of("/market");
  const subscriptions = new Map();

  function stopPolling(entry) {
    if (entry?.timer) {
      clearInterval(entry.timer);
      entry.timer = null;
    }
  }

  function startPolling(symbol, entry) {
    entry.timer = setInterval(() => {
      publish(symbol).catch((error) => {
        logger.warn("Market price poll failed", {
          symbol,
          code: error.code,
          message: error.message,
        });
      });
    }, pollIntervalMs);

    // Polling must not keep the process (or a Jest run) alive on its own.
    if (typeof entry.timer.unref === "function") {
      entry.timer.unref();
    }
  }

  async function publish(symbol) {
    const entry = subscriptions.get(symbol);

    if (!entry) {
      return null;
    }

    const quote = await priceSource.getQuote(symbol, {
      assetClass: entry.assetClass,
    });

    const update = {
      symbol,
      price: quote.price,
      volume: quote.volume ?? null,
      timestamp: quote.timestamp,
    };

    await cache.setPrice(entry.assetClass, symbol, update);
    namespace.to(stockRoom(symbol)).emit("price-update", update);

    return update;
  }

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
      const symbol = normalizeSymbol(raw);

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

  async function subscribe(socket, payload) {
    const normalized = normalize(payload);

    if (normalized.error) {
      return normalized.error;
    }

    const { symbol, assetClass } = normalized;

    let entry = subscriptions.get(symbol);
    const isFirstSubscriber = !entry;

    if (!entry) {
      entry = {
        assetClass,
        sockets: new Set(),
        timer: null,
      };
      subscriptions.set(symbol, entry);
    }

    entry.sockets.add(socket.id);
    await socket.join(stockRoom(symbol));

    try {
      if (isFirstSubscriber) {
        // Fetch immediately so the subscriber gets a price without waiting for
        // the first interval tick, and so an unknown symbol fails the ack.
        await publish(symbol);
        startPolling(symbol, entry);
      } else {
        const cached = await cache.getPrice(entry.assetClass, symbol);

        if (cached) {
          socket.emit("price-update", cached);
        }
      }
    } catch (error) {
      entry.sockets.delete(socket.id);
      await socket.leave(stockRoom(symbol));

      if (entry.sockets.size === 0) {
        stopPolling(entry);
        subscriptions.delete(symbol);
      }

      return {
        ok: false,
        code: error.code || "MARKET_DATA_PROVIDER_UNAVAILABLE",
        message: error.message,
      };
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
        stopPolling(entry);
        subscriptions.delete(symbol);
      }
    }

    return { ok: true, symbol };
  }

  /**
   * Socket.IO removes a socket from its rooms on disconnect, but the poller is
   * ours to release. Without this, a disconnected client would keep the
   * upstream poll alive forever.
   */
  function removeSocket(socketId) {
    for (const [symbol, entry] of subscriptions) {
      if (!entry.sockets.delete(socketId)) {
        continue;
      }

      if (entry.sockets.size === 0) {
        stopPolling(entry);
        subscriptions.delete(symbol);
      }
    }
  }

  function stop() {
    for (const entry of subscriptions.values()) {
      stopPolling(entry);
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
  DEFAULT_POLL_INTERVAL_MS,
};
