const http = require("http");

const app = require("../../src/app");
const { disconnectRedis } = require("../../src/config/redis");
const cacheService = require("../../src/services/cacheService");
const {
  createMarketStream,
} = require("../../src/services/marketStreamService");
const { createSocketServer } = require("../../src/sockets");
const { startProviderServer } = require("../helpers/providerServer");
const {
  collectEvents,
  connectSocket,
  emitWithAck,
  listen,
  silentLogger,
  sleep,
  waitFor,
  waitForEvent,
} = require("../helpers/realtime");

const RUN_ID = Date.now().toString(36).toUpperCase().slice(-6);
let symbolCounter = 0;

/**
 * Unique crypto symbols per test keep Redis cache replay and provider
 * subscription state from leaking between cases.
 */
function nextSymbol(prefix) {
  symbolCounter += 1;
  return `${prefix}${RUN_ID}${symbolCounter}USDT`;
}

describe("Live market-data broadcasting", () => {
  let provider;
  let server;
  let io;
  let marketRooms;
  let stream;
  let baseUrl;
  let clients;

  beforeAll(async () => {
    jest.setTimeout(30000);

    provider = await startProviderServer();

    stream = createMarketStream({
      config: {
        finnhubApiKey: "",
        finnhubUrl: provider.url("/finnhub"),
        binanceUrl: provider.url("/binance"),
      },
      logger: silentLogger,
      baseDelayMs: 20,
      maxDelayMs: 40,
      maxAttempts: 6,
    });

    server = http.createServer(app);
    ({ io, marketRooms } = createSocketServer(server, {
      marketPriceStream: stream,
    }));

    const port = await listen(server);
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    for (const client of clients || []) {
      if (client.connected) {
        client.close();
      }
    }

    marketRooms.stop();
    stream.stop();

    await new Promise((resolve) => io.close(resolve));
    await provider.close();

    try {
      await disconnectRedis();
    } catch (error) {
      // Already closed.
    }
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

    await sleep(20);
  });

  async function connectMarket() {
    const client = await connectSocket(baseUrl, "/market");
    clients.push(client);
    return client;
  }

  async function subscribe(client, payload) {
    return emitWithAck(client, "subscribe", payload);
  }

  async function unsubscribe(client, payload) {
    return emitWithAck(client, "unsubscribe", payload);
  }

  function tradeFrame(symbol, price, quantity) {
    return {
      e: "trade",
      s: symbol,
      p: String(price),
      q: String(quantity),
      T: Date.now(),
    };
  }

  function sendTrade(connection, symbol, price, quantity) {
    connection.socket.send(
      JSON.stringify(tradeFrame(symbol, price, quantity)),
    );
  }

  function subscriptionPredicate(symbol) {
    const streamName = `${symbol.toLowerCase()}@trade`;

    return (message) =>
      message.method === "SUBSCRIBE" &&
      Array.isArray(message.params) &&
      message.params.includes(streamName);
  }

  async function waitForSubscription(symbol) {
    return waitFor(
      () => {
        for (const connection of provider.connections) {
          if (connection.path !== "/binance" || connection.closed) {
            continue;
          }

          const message = connection.messages.find(
            subscriptionPredicate(symbol),
          );

          if (message) {
            return { connection, message };
          }
        }

        return null;
      },
      { description: `Binance subscription for ${symbol}` },
    );
  }

  async function waitForUnsubscription(symbol) {
    const streamName = `${symbol.toLowerCase()}@trade`;

    return waitFor(
      () => {
        for (const connection of provider.connections) {
          if (connection.path !== "/binance" || connection.closed) {
            continue;
          }

          const message = connection.messages.find(
            (candidate) =>
              candidate.method === "UNSUBSCRIBE" &&
              Array.isArray(candidate.params) &&
              candidate.params.includes(streamName),
          );

          if (message) {
            return { connection, message };
          }
        }

        return null;
      },
      { description: `Binance unsubscription for ${symbol}` },
    );
  }

  it("pushes a provider tick to an anonymous /market subscriber", async () => {
    const symbol = nextSymbol("TICK");
    const client = await connectMarket();

    const update = waitForEvent(client, "price-update", {
      predicate: (payload) => payload.symbol === symbol,
    });

    await expect(subscribe(client, { symbol })).resolves.toEqual({
      ok: true,
      symbol,
      assetClass: "CRYPTO",
    });

    const { connection } = await waitForSubscription(symbol);

    sendTrade(connection, symbol, "42.5", "1.25");

    await expect(update).resolves.toEqual({
      symbol,
      price: "42.5",
      volume: "1.25",
      timestamp: expect.any(String),
    });
  });

  it("normalises case, whitespace, and the provider prefix end to end", async () => {
    const symbol = nextSymbol("NORM");
    const client = await connectMarket();
    const subscribed = `  binance:${symbol.toLowerCase()}  `;

    const update = waitForEvent(client, "price-update", {
      predicate: (payload) => payload.symbol === symbol,
    });

    await expect(subscribe(client, { symbol: subscribed })).resolves.toEqual({
      ok: true,
      symbol,
      assetClass: "CRYPTO",
    });

    const { connection, message } = await waitForSubscription(symbol);

    expect(message.params).toEqual([`${symbol.toLowerCase()}@trade`]);

    sendTrade(connection, symbol, "10", "2");

    await expect(update).resolves.toMatchObject({
      symbol,
      price: "10",
      volume: "2",
    });
  });

  it("broadcasts one tick to every socket in the symbol room", async () => {
    const symbol = nextSymbol("FAN");
    const first = await connectMarket();
    const second = await connectMarket();

    const firstUpdate = waitForEvent(first, "price-update", {
      predicate: (payload) => payload.symbol === symbol,
    });
    const secondUpdate = waitForEvent(second, "price-update", {
      predicate: (payload) => payload.symbol === symbol,
    });

    await subscribe(first, { symbol });
    await subscribe(second, { symbol });

    const { connection } = await waitForSubscription(symbol);

    sendTrade(connection, symbol, "300", "0.5");

    const [firstPayload, secondPayload] = await Promise.all([
      firstUpdate,
      secondUpdate,
    ]);

    expect(firstPayload).toEqual(secondPayload);
    expect(firstPayload).toMatchObject({
      symbol,
      price: "300",
      volume: "0.5",
    });
  });

  it("does not leak a tick into another symbol's room", async () => {
    const watched = nextSymbol("WATCH");
    const other = nextSymbol("OTHER");
    const watcher = await connectMarket();
    const bystander = await connectMarket();

    const update = waitForEvent(watcher, "price-update", {
      predicate: (payload) => payload.symbol === watched,
    });

    await subscribe(watcher, { symbol: watched });
    await subscribe(bystander, { symbol: other });

    const { connection } = await waitForSubscription(watched);

    const leaked = collectEvents(bystander, "price-update", 250);
    sendTrade(connection, watched, "50", "1");

    await expect(update).resolves.toMatchObject({ symbol: watched });

    expect(await leaked).toEqual([]);
  });

  it("replays the latest cached price to a late subscriber", async () => {
    const symbol = nextSymbol("REPLAY");
    const first = await connectMarket();
    const second = await connectMarket();

    await subscribe(first, { symbol });

    const { connection } = await waitForSubscription(symbol);

    sendTrade(connection, symbol, "777", "3");

    await waitFor(
      async () => (await cacheService.getPrice("CRYPTO", symbol)) !== null,
      { description: "cached price write" },
    );

    const replay = waitForEvent(second, "price-update", {
      predicate: (payload) => payload.symbol === symbol,
    });

    await expect(subscribe(second, { symbol })).resolves.toMatchObject({
      ok: true,
      symbol,
    });

    await expect(replay).resolves.toMatchObject({
      symbol,
      price: "777",
      volume: "3",
    });
  });

  it("keeps the upstream subscription until the last subscriber leaves", async () => {
    const symbol = nextSymbol("LAST");
    const first = await connectMarket();
    const second = await connectMarket();

    await subscribe(first, { symbol });
    await subscribe(second, { symbol });

    const { connection } = await waitForSubscription(symbol);

    await expect(unsubscribe(first, { symbol })).resolves.toEqual({
      ok: true,
      symbol,
    });

    // The symbol is still watched by `second`, so no upstream unsubscribe.
    await sleep(80);

    const streamName = `${symbol.toLowerCase()}@trade`;

    expect(
      connection.messages.some(
        (message) =>
          message.method === "UNSUBSCRIBE" &&
          Array.isArray(message.params) &&
          message.params.includes(streamName),
      ),
    ).toBe(false);

    const stillWatching = waitForEvent(second, "price-update", {
      predicate: (payload) => payload.symbol === symbol,
    });
    const firstAfterLeaving = collectEvents(first, "price-update", 250);

    sendTrade(connection, symbol, "12", "1");

    await expect(stillWatching).resolves.toMatchObject({ symbol });
    expect(await firstAfterLeaving).toEqual([]);

    await expect(unsubscribe(second, { symbol })).resolves.toEqual({
      ok: true,
      symbol,
    });

    await expect(waitForUnsubscription(symbol)).resolves.toBeDefined();
  });

  it("releases the upstream subscription when the last client disconnects", async () => {
    const symbol = nextSymbol("DROP");
    const first = await connectMarket();
    const second = await connectMarket();

    await subscribe(first, { symbol });
    await subscribe(second, { symbol });

    const { connection } = await waitForSubscription(symbol);

    first.close();
    await sleep(80);

    const streamName = `${symbol.toLowerCase()}@trade`;

    expect(
      connection.messages.some(
        (message) =>
          message.method === "UNSUBSCRIBE" &&
          Array.isArray(message.params) &&
          message.params.includes(streamName),
      ),
    ).toBe(false);

    second.close();

    await expect(waitForUnsubscription(symbol)).resolves.toBeDefined();
  });

  it("stops delivering ticks after a client unsubscribes", async () => {
    const symbol = nextSymbol("STOP");
    const client = await connectMarket();

    await subscribe(client, { symbol });

    const { connection } = await waitForSubscription(symbol);

    await unsubscribe(client, { symbol });
    await waitForUnsubscription(symbol);

    const afterUnsubscribe = collectEvents(client, "price-update", 250);
    sendTrade(connection, symbol, "999", "1");

    expect(await afterUnsubscribe).toEqual([]);
  });

  it("rejects missing, malformed, and non-string symbols without subscribing", async () => {
    const client = await connectMarket();
    const connectionsBefore = provider.connections.length;
    const messagesBefore = provider.connections.reduce(
      (total, connection) => total + connection.messages.length,
      0,
    );

    for (const payload of [null, {}, { symbol: "" }, { symbol: 7 }, { symbol: "!!" }]) {
      await expect(subscribe(client, payload)).resolves.toMatchObject({
        ok: false,
        code: "VALIDATION_ERROR",
      });
    }

    await sleep(80);

    expect(provider.connections).toHaveLength(connectionsBefore);
    expect(
      provider.connections.reduce(
        (total, connection) => total + connection.messages.length,
        0,
      ),
    ).toBe(messagesBefore);
  });

  it("accepts the bare-string symbol form documented in REALTIME.md", async () => {
    const symbol = nextSymbol("BARE");
    const client = await connectMarket();

    await expect(subscribe(client, symbol)).resolves.toEqual({
      ok: true,
      symbol,
      assetClass: "CRYPTO",
    });

    await waitForSubscription(symbol);
  });

  it("ignores provider ticks for symbols that nobody is watching", async () => {
    const watched = nextSymbol("SEEN");
    const unwatched = nextSymbol("UNSEEN");
    const client = await connectMarket();

    await subscribe(client, { symbol: watched });

    const { connection } = await waitForSubscription(watched);

    const received = collectEvents(client, "price-update", 250);
    sendTrade(connection, unwatched, "1", "1");

    expect(await received).toEqual([]);
  });

  it("delivers ticks for several symbols on the same socket", async () => {
    const first = nextSymbol("MULTI");
    const second = nextSymbol("MULTI");
    const client = await connectMarket();

    const firstUpdate = waitForEvent(client, "price-update", {
      predicate: (payload) => payload.symbol === first,
    });
    const secondUpdate = waitForEvent(client, "price-update", {
      predicate: (payload) => payload.symbol === second,
    });

    await subscribe(client, { symbol: first });
    await subscribe(client, { symbol: second });

    const { connection } = await waitForSubscription(first);
    await waitForSubscription(second);

    sendTrade(connection, first, "11", "1");
    sendTrade(connection, second, "22", "1");

    await expect(firstUpdate).resolves.toMatchObject({
      symbol: first,
      price: "11",
    });
    await expect(secondUpdate).resolves.toMatchObject({
      symbol: second,
      price: "22",
    });
  });

  it("keeps broadcasting when the price cache write fails", async () => {
    const failingStream = createMarketStream({
      config: {
        finnhubApiKey: "",
        finnhubUrl: provider.url("/finnhub"),
        binanceUrl: provider.url("/binance"),
      },
      logger: silentLogger,
      baseDelayMs: 20,
      maxDelayMs: 40,
    });

    const failingServer = http.createServer(app);
    const failing = createSocketServer(failingServer, {
      marketPriceStream: failingStream,
      marketCache: {
        async getPrice() {
          return null;
        },
        async setPrice() {
          throw new Error("cache unavailable");
        },
      },
    });

    const failingPort = await listen(failingServer);
    const failingUrl = `http://127.0.0.1:${failingPort}`;
    const client = await connectSocket(failingUrl, "/market");

    try {
      const symbol = nextSymbol("CACHE");
      const update = waitForEvent(client, "price-update", {
        predicate: (payload) => payload.symbol === symbol,
      });

      await expect(subscribe(client, { symbol })).resolves.toMatchObject({
        ok: true,
        symbol,
      });

      const { connection } = await waitForSubscription(symbol);

      sendTrade(connection, symbol, "5", "1");

      await expect(update).resolves.toMatchObject({
        symbol,
        price: "5",
      });
    } finally {
      client.close();
      failing.marketRooms.stop();
      failingStream.stop();
      await new Promise((resolve) => failing.io.close(resolve));
    }
  });

  it("keeps streaming to clients after the provider connection drops", async () => {
    const symbol = nextSymbol("RECONNECT");
    const client = await connectMarket();

    await subscribe(client, { symbol });

    const { connection: first } = await waitForSubscription(symbol);

    first.socket.terminate();

    const second = await waitFor(
      () =>
        provider.connections.find(
          (entry) =>
            entry.path === "/binance" && entry !== first && !entry.closed,
        ),
      { description: "reconnected Binance socket" },
    );

    await waitFor(
      () =>
        second.messages.some((message) => subscriptionPredicate(symbol)(message)),
      { description: "resubscription after reconnect" },
    );

    const update = waitForEvent(client, "price-update", {
      predicate: (payload) => payload.symbol === symbol,
    });

    sendTrade(second, symbol, "1234", "2");

    await expect(update).resolves.toMatchObject({
      symbol,
      price: "1234",
      volume: "2",
    });
  });
});
