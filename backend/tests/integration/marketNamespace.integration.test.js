const http = require("http");
const { io: createClient } = require("socket.io-client");

const app = require("../../src/app");
const { createSocketServer } = require("../../src/sockets");

const POLL_INTERVAL_MS = 30;
const EVENT_WINDOW_MS = 500;
const ACK_TIMEOUT_MS = 3000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

function createFakePriceSource() {
  const quotes = new Map();
  const calls = [];

  return {
    calls,
    setQuote(symbol, price) {
      quotes.set(symbol, { type: "price", price });
    },
    setError(symbol, error) {
      quotes.set(symbol, { type: "error", error });
    },
    callsFor(symbol) {
      return calls.filter((call) => call.symbol === symbol).length;
    },
    async getQuote(symbol, options = {}) {
      calls.push({ symbol, options });

      const entry = quotes.get(symbol);

      if (entry?.type === "error") {
        throw entry.error;
      }

      return {
        symbol,
        assetClass: options.assetClass || "STOCK",
        price: String(entry?.price ?? 100),
        change: "0",
        changePercent: "0",
        high: null,
        low: null,
        open: null,
        previousClose: null,
        volume: null,
        currency: "USD",
        timestamp: new Date().toISOString(),
        source: "fake",
      };
    },
  };
}

function createFakeCache() {
  const store = new Map();

  return {
    store,
    async getPrice(assetClass, symbol) {
      return store.get(`${assetClass}:${symbol}`) ?? null;
    },
    async setPrice(assetClass, symbol, value) {
      store.set(`${assetClass}:${symbol}`, value);
    },
  };
}

function connectMarket(baseUrl, options = {}) {
  const client = createClient(`${baseUrl}/market`, {
    transports: ["websocket"],
    reconnection: false,
    forceNew: true,
    ...options,
  });

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      client.close();
      reject(new Error("Market socket did not connect in time."));
    }, 5000);

    client.once("connect", () => {
      clearTimeout(timer);
      resolve(client);
    });

    client.once("connect_error", (error) => {
      clearTimeout(timer);
      client.close();
      reject(error);
    });
  });
}

function emitWithAck(client, event, payload) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ timeout: true }), ACK_TIMEOUT_MS);

    client.emit(event, payload, (ack) => {
      clearTimeout(timer);
      resolve(ack);
    });
  });
}

function nextEvent(client, event) {
  return new Promise((resolve) => {
    const handler = (payload) => {
      clearTimeout(timer);
      client.off(event, handler);
      resolve(payload);
    };

    const timer = setTimeout(() => {
      client.off(event, handler);
      resolve(null);
    }, EVENT_WINDOW_MS);

    client.on(event, handler);
  });
}

describe("Market namespace subscription rooms", () => {
  let server;
  let io;
  let marketRooms;
  let baseUrl;
  let priceSource;
  let cache;
  let clients;

  beforeAll(async () => {
    jest.setTimeout(20000);

    priceSource = createFakePriceSource();
    cache = createFakeCache();

    server = http.createServer(app);

    ({ io, marketRooms } = createSocketServer(server, {
      marketPriceSource: priceSource,
      marketCache: cache,
      marketPollIntervalMs: POLL_INTERVAL_MS,
    }));

    const port = await listen(server);
    baseUrl = `http://127.0.0.1:${port}`;
  });

  beforeEach(() => {
    clients = [];
  });

  afterEach(async () => {
    for (const client of clients) {
      if (client.connected) {
        client.close();
      }
    }

    // Let disconnect handlers release their subscriptions before the next test.
    await sleep(30);
  });

  afterAll(async () => {
    marketRooms.stop();
    await new Promise((resolve) => io.close(resolve));
  });

  async function connect(options) {
    const client = await connectMarket(baseUrl, options);
    clients.push(client);
    return client;
  }

  it("accepts anonymous connections", async () => {
    const client = await connect();

    expect(client.connected).toBe(true);
  });

  it("subscribes to a symbol and receives the current quote", async () => {
    const client = await connect();

    const pricePromise = nextEvent(client, "price-update");
    const ack = await emitWithAck(client, "subscribe", { symbol: "AAPL" });

    expect(ack).toEqual({
      ok: true,
      symbol: "AAPL",
      assetClass: "STOCK",
    });

    await expect(pricePromise).resolves.toMatchObject({
      symbol: "AAPL",
      price: "100",
      volume: null,
      timestamp: expect.any(String),
    });
  });

  it("shares one upstream subscription between clients watching the same symbol", async () => {
    const first = await connect();
    const second = await connect();

    await emitWithAck(first, "subscribe", { symbol: "MSFT" });
    const callsAfterFirst = priceSource.callsFor("MSFT");

    await emitWithAck(second, "subscribe", { symbol: "MSFT" });

    expect(callsAfterFirst).toBe(1);
    expect(priceSource.callsFor("MSFT")).toBe(callsAfterFirst);
  });

  it("replays the latest cached quote to a later subscriber", async () => {
    const first = await connect();
    const second = await connect();

    await emitWithAck(first, "subscribe", { symbol: "NVDA" });

    const replayPromise = nextEvent(second, "price-update");
    const ack = await emitWithAck(second, "subscribe", { symbol: "NVDA" });

    expect(ack.ok).toBe(true);
    await expect(replayPromise).resolves.toMatchObject({
      symbol: "NVDA",
      price: "100",
    });
  });

  it("rejects a malformed symbol", async () => {
    const client = await connect();

    const ack = await emitWithAck(client, "subscribe", { symbol: "!!" });

    expect(ack).toMatchObject({
      ok: false,
      code: "VALIDATION_ERROR",
    });
  });

  it("reports provider failures on subscribe and cleans up the subscription", async () => {
    const client = await connect();

    const notFound = Object.assign(new Error("Unknown symbol."), {
      code: "MARKET_DATA_NOT_FOUND",
    });
    priceSource.setError("UNKNOWN", notFound);

    const failed = await emitWithAck(client, "subscribe", { symbol: "UNKNOWN" });
    expect(failed).toMatchObject({
      ok: false,
      code: "MARKET_DATA_NOT_FOUND",
    });

    priceSource.setQuote("UNKNOWN", 42);
    const retried = await emitWithAck(client, "subscribe", { symbol: "UNKNOWN" });

    expect(retried.ok).toBe(true);
  });

  it("keeps polling while one subscriber remains and stops after the last leaves", async () => {
    const first = await connect();
    const second = await connect();

    await emitWithAck(first, "subscribe", { symbol: "TSLA" });
    await emitWithAck(second, "subscribe", { symbol: "TSLA" });

    await emitWithAck(first, "unsubscribe", { symbol: "TSLA" });

    const before = priceSource.callsFor("TSLA");
    await sleep(POLL_INTERVAL_MS * 4);
    const whileSecondWatching = priceSource.callsFor("TSLA");

    expect(whileSecondWatching).toBeGreaterThan(before);

    await emitWithAck(second, "unsubscribe", { symbol: "TSLA" });

    const afterLastLeave = priceSource.callsFor("TSLA");
    await sleep(POLL_INTERVAL_MS * 4);

    expect(priceSource.callsFor("TSLA")).toBe(afterLastLeave);
  });

  it("stops polling after the last client disconnects", async () => {
    const client = await connect();

    await emitWithAck(client, "subscribe", { symbol: "AMZN" });
    client.close();

    await sleep(POLL_INTERVAL_MS * 2);

    const afterDisconnect = priceSource.callsFor("AMZN");
    await sleep(POLL_INTERVAL_MS * 4);

    expect(priceSource.callsFor("AMZN")).toBe(afterDisconnect);
  });
});
