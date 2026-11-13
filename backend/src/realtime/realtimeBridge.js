const logger = require("../utils/logger");

const DEFAULT_RETRY_BASE_DELAY_MS = 500;
const DEFAULT_RETRY_MAX_DELAY_MS = 30000;

const ORDER_STATUSES = new Set([
  "PENDING",
  "EXECUTED",
  "CANCELLED",
  "EXPIRED",
  "REJECTED",
]);

/**
 * Only events the backend actually publishes may cross the internal bus. The
 * allow-list is the boundary between the Redis channel and arbitrary Socket.IO
 * clients, so a malformed or accidentally published message is dropped rather
 * than fanned out.
 */
const EVENT_CONTRACTS = {
  "/market": {
    "price-update": validatePriceUpdate,
  },
  "/trading": {
    "order-status": validateOrderStatus,
    "trade-executed": validateTradeExecuted,
    "portfolio-update": validatePortfolioUpdate,
  },
};

const registeredBridges = new WeakMap();

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function isDecimalish(value) {
  if (typeof value === "number") {
    return Number.isFinite(value);
  }

  // Accept provider/Decimal spellings such as "1", "0.25", and "1e-8" while
  // rejecting arbitrary strings and non-decimal forms such as "0x10".
  return /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(value.trim());
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

const ROOM_PREFIXES = {
  "/market": "stock:",
  "/trading": "portfolio:",
};

function validatePriceUpdate(payload) {
  if (!isNonEmptyString(payload.symbol)) {
    return "price-update requires a non-empty symbol.";
  }

  if (!isDecimalish(payload.price)) {
    return "price-update requires a numeric price.";
  }

  if (
    payload.volume !== undefined &&
    payload.volume !== null &&
    !isDecimalish(payload.volume)
  ) {
    return "price-update volume must be numeric, null, or absent.";
  }

  if (
    payload.timestamp !== undefined &&
    typeof payload.timestamp !== "string" &&
    !(typeof payload.timestamp === "number" && Number.isFinite(payload.timestamp))
  ) {
    return "price-update timestamp must be a string or number.";
  }

  return null;
}

function validateOrderStatus(payload) {
  if (
    !isNonEmptyString(payload.orderId) ||
    !isNonEmptyString(payload.portfolioId)
  ) {
    return "order-status requires orderId and portfolioId.";
  }

  if (!ORDER_STATUSES.has(payload.status)) {
    return "order-status requires a known status.";
  }

  return null;
}

function validateTradeExecuted(payload) {
  if (
    !isNonEmptyString(payload.tradeId) ||
    !isNonEmptyString(payload.orderId) ||
    !isNonEmptyString(payload.portfolioId)
  ) {
    return "trade-executed requires tradeId, orderId, and portfolioId.";
  }

  return null;
}

function validatePortfolioUpdate(payload) {
  if (!isNonEmptyString(payload.portfolioId)) {
    return "portfolio-update requires a portfolioId.";
  }

  return null;
}

function validateMessage(message) {
  if (!isPlainObject(message)) {
    return { ok: false, reason: "message must be an object." };
  }

  const { namespace, event, room, payload } = message;

  if (typeof namespace !== "string" || !hasOwn(EVENT_CONTRACTS, namespace)) {
    return { ok: false, reason: "unsupported namespace." };
  }

  const events = EVENT_CONTRACTS[namespace];

  if (typeof event !== "string" || !hasOwn(events, event)) {
    return { ok: false, reason: "unsupported event." };
  }

  const validatePayload = events[event];

  // Every implemented event targets a room. In particular, an accidental
  // roomless `/trading` event must never broadcast portfolio data to every
  // authenticated client.
  if (!isNonEmptyString(room)) {
    return { ok: false, reason: "room is required." };
  }

  if (!room.startsWith(ROOM_PREFIXES[namespace])) {
    return {
      ok: false,
      reason: `room must start with "${ROOM_PREFIXES[namespace]}".`,
    };
  }

  if (!isPlainObject(payload)) {
    return { ok: false, reason: "payload must be an object." };
  }

  const payloadError = validatePayload(payload);

  if (payloadError) {
    return { ok: false, reason: payloadError };
  }

  return { ok: true, message };
}

function getBridgeRegistry(io) {
  let byBus = registeredBridges.get(io);

  if (!byBus) {
    byBus = new Map();
    registeredBridges.set(io, byBus);
  }

  return byBus;
}

/**
 * Forward bus messages onto Socket.IO namespaces/rooms.
 *
 * The worker process publishes; this bridge runs in the API process and is the
 * only place that knows about Socket.IO. Keeping it separate is what makes the
 * execution path testable without a Socket.IO server.
 *
 * Startup is retried with backoff so a Redis instance that is unavailable while
 * the API boots does not leave realtime fan-out permanently disabled. The
 * returned handle is available immediately, even while `ready` is pending, so
 * shutdown can cancel startup deterministically.
 */
function startRealtimeBridge({
  io,
  bus,
  logger: log = logger,
  retryBaseDelayMs = DEFAULT_RETRY_BASE_DELAY_MS,
  retryMaxDelayMs = DEFAULT_RETRY_MAX_DELAY_MS,
  timers = { setTimeout, clearTimeout },
} = {}) {
  if (!io || typeof io.of !== "function") {
    throw new TypeError(
      "startRealtimeBridge requires a Socket.IO server with of().",
    );
  }

  if (!bus || typeof bus.subscribe !== "function") {
    throw new TypeError("startRealtimeBridge requires a subscribable bus.");
  }

  const registry = getBridgeRegistry(io);
  const existing = registry.get(bus);

  if (existing) {
    return existing;
  }

  let stopped = false;
  let unsubscribe = null;
  let retryTimer = null;
  let cancelWait = null;
  let attempts = 0;
  let status = "connecting";
  let lastError = null;
  let readySettled = false;
  let resolveReady;

  const ready = new Promise((resolve) => {
    resolveReady = resolve;
  });

  function settleReady(connected) {
    if (readySettled) {
      return;
    }

    readySettled = true;
    resolveReady(connected);
  }

  function rejectMessage(message, reason) {
    log.warn("Realtime message rejected", {
      namespace: message?.namespace ?? null,
      event: message?.event ?? null,
      reason,
    });
  }

  function forward(message) {
    const namespace = io.of(message.namespace);
    const target = message.room ? namespace.to(message.room) : namespace;

    target.emit(message.event, message.payload);
  }

  const handler = (message) => {
    const result = validateMessage(message);

    if (!result.ok) {
      rejectMessage(message, result.reason);
      return;
    }

    forward(result.message);
  };

  function waitForRetry(delayMs) {
    return new Promise((resolve) => {
      cancelWait = resolve;

      retryTimer = timers.setTimeout(() => {
        retryTimer = null;
        cancelWait = null;
        resolve();
      }, delayMs);

      if (typeof retryTimer.unref === "function") {
        retryTimer.unref();
      }
    });
  }

  async function connectUntilReady() {
    while (!stopped) {
      attempts += 1;

      try {
        const candidate = await bus.subscribe(handler);

        if (stopped) {
          if (typeof candidate === "function") {
            candidate();
          }

          settleReady(false);
          return;
        }

        unsubscribe =
          typeof candidate === "function" ? candidate : null;
        status = "connected";
        lastError = null;

        log.info("Realtime event bridge connected", {
          attempts,
        });

        settleReady(true);
        return;
      } catch (error) {
        if (stopped) {
          break;
        }

        lastError = error.message;
        status = "reconnecting";

        log.warn("Realtime event bridge subscription failed; retrying", {
          attempts,
          message: error.message,
        });

        const delay = Math.min(
          retryBaseDelayMs * 2 ** (attempts - 1),
          retryMaxDelayMs,
        );

        await waitForRetry(delay);
      }
    }

    settleReady(false);
  }

  function stop() {
    if (stopped) {
      return;
    }

    stopped = true;
    status = "stopped";

    if (retryTimer) {
      timers.clearTimeout(retryTimer);
      retryTimer = null;
    }

    if (cancelWait) {
      const cancel = cancelWait;
      cancelWait = null;
      cancel();
    }

    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }

    registry.delete(bus);

    if (registry.size === 0) {
      registeredBridges.delete(io);
    }

    log.info("Realtime event bridge stopped");
    settleReady(false);
  }

  function getState() {
    return {
      status,
      attempts,
      lastError,
      subscribed: status === "connected",
    };
  }

  const bridge = { ready, stop, getState };

  registry.set(bus, bridge);
  void connectUntilReady();

  return bridge;
}

module.exports = {
  startRealtimeBridge,
  validateMessage,
  EVENT_CONTRACTS,
};
