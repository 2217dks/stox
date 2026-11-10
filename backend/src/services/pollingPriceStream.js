const logger = require("../utils/logger");
const { normalizeAssetClass } = require("./marketDataService");

const DEFAULT_INTERVAL_MS = 5000;

/**
 * Polling fallback for environments where the upstream WebSocket stream is
 * disabled (`MARKET_STREAM_ENABLED=false`). It exposes the same
 * `subscribe(symbol, listener)` contract as `createMarketStream`, so the socket
 * layer does not care which one it received.
 */
function createPollingPriceStream({
  priceSource,
  intervalMs = DEFAULT_INTERVAL_MS,
  logger: log = logger,
} = {}) {
  if (!priceSource || typeof priceSource.getQuote !== "function") {
    throw new TypeError(
      "createPollingPriceStream requires a priceSource with getQuote().",
    );
  }

  const entries = new Map();

  async function poll(symbol) {
    const entry = entries.get(symbol);

    if (!entry) {
      return;
    }

    try {
      const quote = await priceSource.getQuote(symbol, {
        assetClass: entry.assetClass,
      });

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
      log.warn("Price poll failed", {
        symbol,
        code: error.code,
        message: error.message,
      });
    }
  }

  function subscribe(symbol, listener) {
    if (typeof listener !== "function") {
      throw new TypeError("A tick listener is required.");
    }

    let entry = entries.get(symbol);

    if (!entry) {
      entry = {
        assetClass: normalizeAssetClass(undefined, symbol),
        listeners: new Set(),
        timer: setInterval(() => poll(symbol), intervalMs),
      };

      if (typeof entry.timer.unref === "function") {
        entry.timer.unref();
      }

      entries.set(symbol, entry);

      // Fetch immediately so the first subscriber does not wait for a tick.
      poll(symbol);
    }

    entry.listeners.add(listener);
  }

  function unsubscribe(symbol) {
    const entry = entries.get(symbol);

    if (!entry) {
      return;
    }

    clearInterval(entry.timer);
    entries.delete(symbol);
  }

  function stop() {
    for (const entry of entries.values()) {
      clearInterval(entry.timer);
    }

    entries.clear();
  }

  return {
    subscribe,
    unsubscribe,
    stop,
  };
}

module.exports = {
  createPollingPriceStream,
  DEFAULT_INTERVAL_MS,
};
