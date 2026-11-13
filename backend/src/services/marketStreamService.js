const logger = require("../utils/logger");
const { toInternalSymbol } = require("../utils/symbolUtils");
const { normalizeAssetClass } = require("./marketDataService");

const DEFAULT_MAX_ATTEMPTS = 10;
const DEFAULT_BASE_DELAY_MS = 1000;
const DEFAULT_MAX_DELAY_MS = 30000;
// Once the short backoff budget is exhausted the provider is not abandoned:
// the stream enters a long cooldown and tries again. A market-data service is
// expected to recover from a provider outage without an application restart.
const DEFAULT_COOLDOWN_MS = 60000;
const MAX_JITTER_MS = 250;
const WS_OPEN = 1;

const FINNHUB_URL = "wss://ws.finnhub.io";
const BINANCE_URL = "wss://stream.binance.com:9443/ws";

function createReconnectingSocket({
  name,
  url,
  webSocketFactory,
  onOpen,
  onMessage,
  onError,
  logger: log = logger,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  baseDelayMs = DEFAULT_BASE_DELAY_MS,
  maxDelayMs = DEFAULT_MAX_DELAY_MS,
  cooldownMs = DEFAULT_COOLDOWN_MS,
  random = Math.random,
  timers = { setTimeout, clearTimeout },
}) {
  let socket = null;
  let attempts = 0;
  let stopped = false;
  let reconnectTimer = null;
  let state = "idle";

  function connect() {
    if (stopped) {
      return;
    }

    state = "connecting";
    socket = webSocketFactory(url);

    socket.onopen = () => {
      attempts = 0;
      state = "connected";
      log.info("Market stream connected", { provider: name });

      if (typeof onOpen === "function") {
        onOpen(send);
      }
    };

    socket.onmessage = (event) => {
      try {
        const data =
          typeof event.data === "string" ? JSON.parse(event.data) : event.data;
        onMessage(data);
      } catch (error) {
        log.warn("Market stream message ignored", {
          provider: name,
          message: error.message,
        });
      }
    };

    socket.onerror = (error) => {
      if (stopped) {
        return;
      }

      state = "reconnecting";
      log.warn("Market stream error", {
        provider: name,
        message: error?.message,
      });

      if (typeof onError === "function") {
        onError(error);
      }
    };

    socket.onclose = () => {
      if (stopped) {
        return;
      }

      log.warn("Market stream disconnected", { provider: name });
      state = "reconnecting";
      scheduleReconnect();
    };
  }

  function scheduleTimer(delay) {
    reconnectTimer = timers.setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);

    if (typeof reconnectTimer.unref === "function") {
      reconnectTimer.unref();
    }
  }

  /**
   * Exponential backoff with a small bounded jitter. Jitter prevents every
   * instance reconnecting in lockstep after a provider-wide outage.
   *
   * After `maxAttempts` consecutive failures the socket enters a long cooldown
   * instead of giving up permanently. The retry budget resets for the next
   * cycle, so a provider that recovers minutes later is reconnected and every
   * active symbol is resubscribed by `onOpen`.
   */
  function scheduleReconnect() {
    if (attempts >= maxAttempts) {
      state = "unavailable";
      log.error("Market stream provider unavailable; entering cooldown", {
        provider: name,
        attempts,
        cooldownMs,
      });

      attempts = 0;
      scheduleTimer(cooldownMs);
      return;
    }

    const delay = Math.min(baseDelayMs * 2 ** attempts, maxDelayMs);
    const jitter = Math.floor(random() * Math.min(MAX_JITTER_MS, delay * 0.1));

    attempts += 1;
    scheduleTimer(delay + jitter);
  }

  function send(payload) {
    if (!socket || socket.readyState !== WS_OPEN) {
      return false;
    }

    socket.send(
      typeof payload === "string" ? payload : JSON.stringify(payload),
    );
    return true;
  }

  function stop() {
    stopped = true;
    state = "stopped";

    if (reconnectTimer) {
      timers.clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }

    if (socket) {
      try {
        socket.close();
      } catch (error) {
        log.warn("Market stream close failed", {
          provider: name,
          message: error.message,
        });
      }

      socket = null;
    }
  }

  return {
    connect,
    send,
    stop,
    getState() {
      return {
        state,
        attempts,
        hasSocket: Boolean(socket),
      };
    },
    get state() {
      return state;
    },
    get attempts() {
      return attempts;
    },
    get socket() {
      return socket;
    },
  };
}

/**
 * Streaming market data with automatic reconnection.
 *
 * The service owns the provider connections and the symbol subscriptions. It
 * emits normalized ticks to per-symbol listeners; the socket layer decides what
 * to do with them (cache + room broadcast).
 *
 * Connections are created lazily on the first subscription, so a process that
 * never serves market data never opens a socket.
 */
function createMarketStream({
  config = {},
  webSocketFactory = (url) => new WebSocket(url),
  logger: log = logger,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  baseDelayMs = DEFAULT_BASE_DELAY_MS,
  maxDelayMs = DEFAULT_MAX_DELAY_MS,
  cooldownMs = DEFAULT_COOLDOWN_MS,
  random = Math.random,
  timers = { setTimeout, clearTimeout },
} = {}) {
  const finnhubApiKey =
    config.finnhubApiKey ?? process.env.FINNHUB_API_KEY ?? null;
  const finnhubUrl = config.finnhubUrl || FINNHUB_URL;
  const binanceUrl = config.binanceUrl || BINANCE_URL;

  const listeners = new Map();
  const subscriptionAssetClasses = new Map();
  const providers = {
    stock: {
      enabled: Boolean(finnhubApiKey),
      url: `${finnhubUrl}?token=${encodeURIComponent(finnhubApiKey || "")}`,
      symbols: new Set(),
      connection: null,
      lastConnectedAt: null,
      lastUpdateAt: null,
      lastError: null,
    },
    crypto: {
      enabled: true,
      url: binanceUrl,
      symbols: new Set(),
      connection: null,
      lastConnectedAt: null,
      lastUpdateAt: null,
      lastError: null,
    },
  };

  let warnedStockDisabled = false;
  let running = true;

  function subscribeMessage(provider, symbol) {
    if (provider === "stock") {
      return { type: "subscribe", symbol };
    }

    return {
      method: "SUBSCRIBE",
      params: [`${symbol.toLowerCase()}@trade`],
      id: 1,
    };
  }

  function unsubscribeMessage(provider, symbol) {
    if (provider === "stock") {
      return { type: "unsubscribe", symbol };
    }

    return {
      method: "UNSUBSCRIBE",
      params: [`${symbol.toLowerCase()}@trade`],
      id: 2,
    };
  }

  function providerFor(symbol, assetClass) {
    return normalizeAssetClass(assetClass, symbol) === "CRYPTO"
      ? "crypto"
      : "stock";
  }

  function emitTick(symbol, price, volume, timestamp) {
    const internal = toInternalSymbol(symbol);
    const symbolListeners = listeners.get(internal);

    if (!symbolListeners || symbolListeners.size === 0) {
      return;
    }

    const update = {
      symbol: internal,
      price: String(price),
      volume: volume === undefined || volume === null ? null : String(volume),
      timestamp: new Date(Number(timestamp)).toISOString(),
    };

    for (const listener of symbolListeners) {
      try {
        listener(update);
      } catch (error) {
        log.warn("Market stream listener failed", {
          symbol: internal,
          message: error.message,
        });
      }
    }
  }

  function handleMessage(provider, data) {
    if (!data || typeof data !== "object") {
      return;
    }

    if (provider === "stock") {
      if (data.type !== "trade" || !Array.isArray(data.data)) {
        return;
      }

      providers[provider].lastUpdateAt = new Date().toISOString();

      for (const trade of data.data) {
        emitTick(trade.s, trade.p, trade.v, trade.t);
      }

      return;
    }

    // Binance raw streams send the trade directly; combined streams wrap it.
    const trade = data.data && data.data.e ? data.data : data;

    if (trade.e !== "trade") {
      return;
    }

    providers[provider].lastUpdateAt = new Date().toISOString();
    emitTick(trade.s, trade.p, trade.q, trade.T);
  }

  function ensureConnection(provider) {
    const state = providers[provider];

    if (!state.enabled || state.connection) {
      return state.connection;
    }

    state.connection = createReconnectingSocket({
      name: provider,
      url: state.url,
      webSocketFactory,
      onOpen: (send) => {
        state.lastConnectedAt = new Date().toISOString();
        state.lastError = null;

        for (const symbol of state.symbols) {
          send(subscribeMessage(provider, symbol));
        }
      },
      onMessage: (data) => handleMessage(provider, data),
      onError: (error) => {
        state.lastError = error?.message || "Market stream error";
      },
      logger: log,
      maxAttempts,
      baseDelayMs,
      maxDelayMs,
      cooldownMs,
      random,
      timers,
    });

    state.connection.connect();

    return state.connection;
  }

  function subscribe(symbol, listener, assetClass) {
    const internal = toInternalSymbol(symbol);

    if (!internal) {
      throw new Error("A symbol is required.");
    }

    if (typeof listener !== "function") {
      throw new TypeError("A tick listener is required.");
    }

    const resolvedAssetClass = normalizeAssetClass(assetClass, internal);
    const existingAssetClass = subscriptionAssetClasses.get(internal);

    if (existingAssetClass && existingAssetClass !== resolvedAssetClass) {
      throw new Error(
        `Asset-class conflict for ${internal}: already subscribed as ${existingAssetClass}.`,
      );
    }

    let symbolListeners = listeners.get(internal);

    if (!symbolListeners) {
      symbolListeners = new Set();
      listeners.set(internal, symbolListeners);
    }

    symbolListeners.add(listener);
    subscriptionAssetClasses.set(internal, resolvedAssetClass);

    const provider = providerFor(internal, resolvedAssetClass);
    const state = providers[provider];

    if (!state.enabled) {
      if (!warnedStockDisabled) {
        warnedStockDisabled = true;
        log.warn(
          "Stock stream disabled because FINNHUB_API_KEY is not configured",
        );
      }

      return;
    }

    if (state.symbols.has(internal)) {
      return;
    }

    state.symbols.add(internal);

    const connection = ensureConnection(provider);

    if (connection) {
      connection.send(subscribeMessage(provider, internal));
    }
  }

  function unsubscribe(symbol, assetClass) {
    const internal = toInternalSymbol(symbol);

    if (!internal) {
      return;
    }

    const storedAssetClass = subscriptionAssetClasses.get(internal);

    if (!storedAssetClass) {
      return;
    }

    if (
      assetClass !== undefined &&
      normalizeAssetClass(assetClass, internal) !== storedAssetClass
    ) {
      throw new Error(
        `Asset-class conflict for ${internal}: subscribed as ${storedAssetClass}.`,
      );
    }

    listeners.delete(internal);
    subscriptionAssetClasses.delete(internal);

    const provider = providerFor(internal, storedAssetClass);
    const state = providers[provider];

    if (!state.symbols.delete(internal)) {
      return;
    }

    if (state.connection) {
      state.connection.send(unsubscribeMessage(provider, internal));
    }
  }

  function stop() {
    running = false;
    listeners.clear();

    for (const state of Object.values(providers)) {
      state.symbols.clear();

      if (state.connection) {
        state.connection.stop();
        state.connection = null;
      }
    }
  }

  function getState() {
    return {
      mode: "websocket",
      running,
      providers: Object.fromEntries(
        Object.entries(providers).map(([name, state]) => [
          name,
          {
            enabled: state.enabled,
            state: !running
              ? "stopped"
              : state.connection
                ? state.connection.state
                : "idle",
            activeSubscriptions: [...state.symbols],
            reconnectAttempts: state.connection?.attempts ?? 0,
            lastConnectedAt: state.lastConnectedAt,
            lastUpdateAt: state.lastUpdateAt,
            lastError: state.lastError,
          },
        ]),
      ),
    };
  }

  return {
    subscribe,
    unsubscribe,
    stop,
    getState,
    supportsAssetClass(assetClass) {
      if (assetClass === "CRYPTO") {
        return providers.crypto.enabled;
      }

      if (assetClass === "STOCK") {
        return providers.stock.enabled;
      }

      return false;
    },
    isListening(symbol) {
      return listeners.has(toInternalSymbol(symbol));
    },
    providerState(provider) {
      return providers[provider];
    },
  };
}

module.exports = {
  createMarketStream,
  createReconnectingSocket,
  toInternalSymbol,
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_BASE_DELAY_MS,
  DEFAULT_MAX_DELAY_MS,
  DEFAULT_COOLDOWN_MS,
};
