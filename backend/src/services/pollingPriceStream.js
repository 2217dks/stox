const logger = require("../utils/logger");
const { normalizeAssetClass } = require("./marketDataService");

const DEFAULT_INTERVAL_MS = 5000;

/**
 * Polling fallback for environments where the upstream WebSocket stream is
 * disabled (`MARKET_STREAM_ENABLED=false`). It exposes the same
 * `subscribe(symbol, listener)` contract as `createMarketStream`, so the socket
 * layer does not care which one it received.
 *
 * The next poll is scheduled *after* the previous one settles instead of by a
 * fixed `setInterval`. A slow provider response therefore delays the next poll
 * for that symbol rather than starting overlapping requests. Overlapping polls
 * waste provider quota and, worse, can deliver an older response after a newer
 * one.
 */
function createPollingPriceStream({
  priceSource,
  intervalMs = DEFAULT_INTERVAL_MS,
  logger: log = logger,
  timers = { setTimeout, clearTimeout },
} = {}) {
  if (!priceSource || typeof priceSource.getQuote !== "function") {
    throw new TypeError(
      "createPollingPriceStream requires a priceSource with getQuote().",
    );
  }

  const entries = new Map();
  let running = true;

  function schedulePoll(symbol, entry, delayMs) {
    if (entry.stopped || entries.get(symbol) !== entry) {
      return;
    }

    entry.timer = timers.setTimeout(() => {
      entry.timer = null;
      void poll(symbol, entry);
    }, delayMs);

    if (typeof entry.timer.unref === "function") {
      entry.timer.unref();
    }
  }

  async function poll(symbol, entry) {
    // The entry may have been unsubscribed (or replaced) between scheduling
    // and execution. Never poll a symbol nobody is watching.
    if (entry.stopped || entries.get(symbol) !== entry || entry.inFlight) {
      return;
    }

    entry.inFlight = true;
    entry.lastPollStartedAt = Date.now();

    try {
      const quote = await priceSource.getQuote(symbol, {
        assetClass: entry.assetClass,
      });

      // A response that arrives after unsubscribe/stop is stale. Drop it rather
      // than broadcasting a price for a room the client already left.
      if (entry.stopped || entries.get(symbol) !== entry) {
        return;
      }

      const update = {
        symbol,
        price: String(quote.price),
        // Match the WebSocket stream's tick shape: volume is always a string
        // or null, regardless of how the quote source represented it.
        volume:
          quote.volume === undefined || quote.volume === null
            ? null
            : String(quote.volume),
        timestamp: quote.timestamp,
      };

      entry.lastSuccessAt = Date.now();

      for (const listener of entry.listeners) {
        try {
          listener(update);
        } catch (error) {
          log.warn("Price listener failed", {
            symbol,
            message: error.message,
          });
        }
      }
    } catch (error) {
      if (entries.get(symbol) === entry) {
        entry.lastError = error.message;
      }

      log.warn("Price poll failed", {
        symbol,
        code: error.code,
        message: error.message,
      });
    } finally {
      entry.inFlight = false;
      schedulePoll(symbol, entry, intervalMs);
    }
  }

  function subscribe(symbol, listener) {
    if (typeof listener !== "function") {
      throw new TypeError("A tick listener is required.");
    }

    running = true;

    let entry = entries.get(symbol);

    if (!entry) {
      entry = {
        assetClass: normalizeAssetClass(undefined, symbol),
        listeners: new Set(),
        timer: null,
        stopped: false,
        inFlight: false,
        lastPollStartedAt: null,
        lastSuccessAt: null,
        lastError: null,
      };

      entries.set(symbol, entry);

      // Fetch immediately so the first subscriber does not wait for a tick.
      // Scheduling the follow-up happens in `poll`'s finally block, which is
      // what prevents overlap.
      void poll(symbol, entry);
    }

    entry.listeners.add(listener);
  }

  function unsubscribe(symbol) {
    const entry = entries.get(symbol);

    if (!entry) {
      return;
    }

    entry.stopped = true;

    if (entry.timer) {
      timers.clearTimeout(entry.timer);
      entry.timer = null;
    }

    entries.delete(symbol);
  }

  function stop() {
    running = false;

    for (const entry of entries.values()) {
      entry.stopped = true;

      if (entry.timer) {
        timers.clearTimeout(entry.timer);
        entry.timer = null;
      }
    }

    entries.clear();
  }

  function getState() {
    return {
      mode: "polling",
      running,
      intervalMs,
      subscriptions: [...entries.entries()].map(([symbol, entry]) => ({
        symbol,
        assetClass: entry.assetClass,
        intervalMs,
        listenerCount: entry.listeners.size,
        inFlight: entry.inFlight,
        lastPollStartedAt: entry.lastPollStartedAt,
        lastSuccessAt: entry.lastSuccessAt,
        lastError: entry.lastError,
      })),
    };
  }

  return {
    subscribe,
    unsubscribe,
    stop,
    getState,
    // Polling depends on the price source rather than a provider socket, so
    // both supported asset classes are available whenever the source is.
    supportsAssetClass() {
      return true;
    },
  };
}

module.exports = {
  createPollingPriceStream,
  DEFAULT_INTERVAL_MS,
};
