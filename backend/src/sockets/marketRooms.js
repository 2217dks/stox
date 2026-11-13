const cacheService = require("../services/cacheService");
const {
  normalizeAssetClass,
  normalizeSymbol,
} = require("../services/marketDataService");
const logger = require("../utils/logger");
const { toInternalSymbol } = require("../utils/symbolUtils");

const DEFAULT_MAX_SUBSCRIPTIONS_PER_SOCKET = 25;
const DEFAULT_MAX_TOTAL_SUBSCRIPTIONS = 200;
const DEFAULT_SUBSCRIPTION_RATE_LIMIT = 30;
const DEFAULT_SUBSCRIPTION_RATE_WINDOW_MS = 10000;

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

function readAssetClass(payload) {
  return typeof payload === "object" && payload !== null
    ? payload.assetClass
    : undefined;
}

function positiveInteger(value, fallback) {
  const number = Number(value);

  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function readPositiveIntegerFromEnv(name, fallback) {
  return positiveInteger(process.env[name], fallback);
}

/**
 * Per-symbol subscription registry for the `/market` namespace.
 *
 * A room can have many sockets but only one upstream subscription. The registry
 * owns no transport of its own: it calls whichever `priceStream` it was given
 * (WebSocket in production, polling as a fallback), which keeps this module
 * testable without opening a network connection.
 *
 * `/market` is public, so subscriptions are bounded per socket and globally,
 * and subscribe events are rate limited. Without those limits a single client
 * could create an unbounded number of provider subscriptions and polling
 * timers.
 */
function createMarketRoomRegistry({
  io,
  priceStream,
  cache = cacheService,
  logger: log = logger,
  maxSubscriptionsPerSocket = readPositiveIntegerFromEnv(
    "MARKET_MAX_SUBSCRIPTIONS_PER_SOCKET",
    DEFAULT_MAX_SUBSCRIPTIONS_PER_SOCKET,
  ),
  maxTotalSubscriptions = readPositiveIntegerFromEnv(
    "MARKET_MAX_TOTAL_SUBSCRIPTIONS",
    DEFAULT_MAX_TOTAL_SUBSCRIPTIONS,
  ),
  subscriptionRateLimit = readPositiveIntegerFromEnv(
    "MARKET_SUBSCRIPTION_RATE_LIMIT",
    DEFAULT_SUBSCRIPTION_RATE_LIMIT,
  ),
  subscriptionRateWindowMs = readPositiveIntegerFromEnv(
    "MARKET_SUBSCRIPTION_RATE_WINDOW_MS",
    DEFAULT_SUBSCRIPTION_RATE_WINDOW_MS,
  ),
  now = () => Date.now(),
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
  const sockets = new Map();

  function socketState(socketId) {
    let state = sockets.get(socketId);

    if (!state) {
      state = { symbols: new Set(), events: [] };
      sockets.set(socketId, state);
    }

    return state;
  }

  function enforceRateLimit(socketId) {
    const state = socketState(socketId);
    const current = now();

    state.events = state.events.filter(
      (timestamp) => current - timestamp < subscriptionRateWindowMs,
    );

    if (state.events.length >= subscriptionRateLimit) {
      const oldest = state.events[0];

      return {
        ok: false,
        code: "RATE_LIMITED",
        message: "Too many subscription requests. Try again shortly.",
        retryAfterMs: Math.max(1, subscriptionRateWindowMs - (current - oldest)),
      };
    }

    state.events.push(current);
    return null;
  }

  function limitReached(limit) {
    return {
      ok: false,
      code: "SUBSCRIPTION_LIMIT_REACHED",
      message: `The maximum of ${limit} active symbol subscriptions was reached.`,
      limit,
    };
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
      const symbol = toInternalSymbol(normalizeSymbol(raw));

      return {
        symbol,
        // `assetClass` is optional. Supplying it resolves genuinely ambiguous
        // tickers; omitting it falls back to provider-agnostic inference.
        assetClass: normalizeAssetClass(readAssetClass(payload), symbol),
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

  function writeCachedPrice(entry, symbol, update) {
    try {
      // Wrap the call itself so a synchronous cache failure cannot prevent the
      // room broadcast below. Cache writes are best-effort.
      Promise.resolve(cache.setPrice(entry.assetClass, symbol, update)).catch(
        (error) => {
          log.warn("Price cache write failed", {
            symbol,
            message: error.message,
          });
        },
      );
    } catch (error) {
      log.warn("Price cache write failed", {
        symbol,
        message: error.message,
      });
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

      writeCachedPrice(entry, symbol, update);
      namespace.to(stockRoom(symbol)).emit("price-update", update);
    };
  }

  async function subscribe(socket, payload) {
    const rateLimited = enforceRateLimit(socket.id);

    if (rateLimited) {
      return rateLimited;
    }

    const normalized = normalize(payload);

    if (normalized.error) {
      return normalized.error;
    }

    const { symbol, assetClass } = normalized;

    if (
      typeof priceStream.supportsAssetClass === "function" &&
      !priceStream.supportsAssetClass(assetClass)
    ) {
      return {
        ok: false,
        code: "MARKET_DATA_UNAVAILABLE",
        message: `Market streaming is unavailable for ${assetClass} symbols.`,
      };
    }

    const state = socketState(socket.id);
    const alreadySubscribed = state.symbols.has(symbol);

    if (!alreadySubscribed) {
      if (state.symbols.size >= maxSubscriptionsPerSocket) {
        return limitReached(maxSubscriptionsPerSocket);
      }

      // Sharing an existing symbol does not create another upstream
      // subscription, so it is allowed even when the global cap is reached.
      if (
        !subscriptions.has(symbol) &&
        subscriptions.size >= maxTotalSubscriptions
      ) {
        return limitReached(maxTotalSubscriptions);
      }
    }

    let entry = subscriptions.get(symbol);

    if (!entry) {
      entry = {
        assetClass,
        sockets: new Set(),
      };

      subscriptions.set(symbol, entry);

      try {
        priceStream.subscribe(symbol, listenerFor(symbol));
      } catch (error) {
        // Do not leave a symbol registered if the provider rejected the
        // subscription; otherwise the global cap slowly leaks phantom symbols.
        subscriptions.delete(symbol);

        try {
          priceStream.unsubscribe(symbol);
        } catch (unsubscribeError) {
          log.warn("Price stream rollback failed", {
            symbol,
            message: unsubscribeError.message,
          });
        }

        throw error;
      }
    }

    state.symbols.add(symbol);
    entry.sockets.add(socket.id);
    await socket.join(stockRoom(symbol));

    // Replay the last cached tick so a late subscriber sees a price immediately
    // instead of waiting for the next tick. A cache outage must not fail the
    // subscription itself.
    try {
      const cached = await cache.getPrice(assetClass, symbol);

      if (cached) {
        socket.emit("price-update", cached);
      }
    } catch (error) {
      log.warn("Price cache read failed", {
        symbol,
        message: error.message,
      });
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

    const state = sockets.get(socket.id);

    if (state) {
      state.symbols.delete(symbol);

      if (state.symbols.size === 0) {
        sockets.delete(socket.id);
      }
    }

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
    const state = sockets.get(socketId);

    sockets.delete(socketId);

    if (!state) {
      return;
    }

    // Use the socket's own symbol set instead of scanning every subscription.
    // With the global cap this is bounded either way, but it keeps disconnect
    // cleanup proportional to the socket's own footprint.
    for (const symbol of state.symbols) {
      const entry = subscriptions.get(symbol);

      if (!entry) {
        continue;
      }

      entry.sockets.delete(socketId);

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
    sockets.clear();
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
  DEFAULT_MAX_SUBSCRIPTIONS_PER_SOCKET,
  DEFAULT_MAX_TOTAL_SUBSCRIPTIONS,
  DEFAULT_SUBSCRIPTION_RATE_LIMIT,
  DEFAULT_SUBSCRIPTION_RATE_WINDOW_MS,
};
