const http = require("http");

const app = require("../../src/app");
const { createSocketServer } = require("../../src/sockets");
const {
  connectSocket,
  emitWithAck,
  listen,
  sleep,
} = require("../helpers/realtime");

/**
 * The `/market` namespace is public, so its resource use has to be bounded at
 * the socket layer. These tests use a fake price stream so a subscription is
 * observable without opening a provider connection.
 */
describe("Market subscription limits", () => {
  let server;
  let io;
  let marketRooms;
  let baseUrl;
  let clients;
  let priceStream;

  const cache = {
    async getPrice() {
      return null;
    },
    async setPrice() {
      return true;
    },
  };

  async function startServer(options = {}) {
    jest.setTimeout(20000);

    priceStream = options.marketPriceStream || {
      subscribe: jest.fn(),
      unsubscribe: jest.fn(),
      stop: jest.fn(),
    };

    server = http.createServer(app);
    ({ io, marketRooms } = createSocketServer(server, {
      marketPriceStream: priceStream,
      marketCache: options.marketCache || cache,
      marketMaxSubscriptionsPerSocket: 2,
      marketSubscriptionRateLimit: 1000,
      marketSubscriptionRateWindowMs: 10000,
      ...options,
    }));

    const port = await listen(server);
    baseUrl = `http://127.0.0.1:${port}`;
  }

  async function connect() {
    const client = await connectSocket(baseUrl, "/market");

    clients.push(client);
    return client;
  }

  beforeEach(() => {
    clients = [];
  });

  afterEach(async () => {
    for (const client of clients) {
      if (client.connected) {
        client.close();
      }
    }

    if (marketRooms) {
      marketRooms.stop();
    }

    if (io) {
      await new Promise((resolve) => io.close(resolve));
    }

    marketRooms = null;
    io = null;
    server = null;
  });

  it("enforces a per-socket distinct subscription limit", async () => {
    await startServer();
    const client = await connect();

    await expect(
      emitWithAck(client, "subscribe", { symbol: "AAPL" }),
    ).resolves.toMatchObject({
      ok: true,
      symbol: "AAPL",
    });
    // Repeating an existing subscription must not count as a new one.
    await expect(
      emitWithAck(client, "subscribe", { symbol: "AAPL" }),
    ).resolves.toMatchObject({
      ok: true,
      symbol: "AAPL",
    });
    await expect(
      emitWithAck(client, "subscribe", { symbol: "MSFT" }),
    ).resolves.toMatchObject({
      ok: true,
      symbol: "MSFT",
    });

    await expect(
      emitWithAck(client, "subscribe", { symbol: "GOOG" }),
    ).resolves.toEqual({
      ok: false,
      code: "SUBSCRIPTION_LIMIT_REACHED",
      message: expect.any(String),
      limit: 2,
    });

    expect(priceStream.subscribe).toHaveBeenCalledTimes(2);
    expect(priceStream.subscribe.mock.calls.map(([symbol]) => symbol)).toEqual([
      "AAPL",
      "MSFT",
    ]);

    // Unsubscribing frees capacity without touching the other symbol.
    await expect(
      emitWithAck(client, "unsubscribe", { symbol: "AAPL" }),
    ).resolves.toMatchObject({
      ok: true,
      symbol: "AAPL",
    });

    await expect(
      emitWithAck(client, "subscribe", { symbol: "GOOG" }),
    ).resolves.toMatchObject({
      ok: true,
      symbol: "GOOG",
    });

    expect(priceStream.subscribe).toHaveBeenLastCalledWith(
      "GOOG",
      expect.any(Function),
      "STOCK",
    );
  });

  it("keeps one socket's limit independent from another socket", async () => {
    await startServer();
    const first = await connect();
    const second = await connect();

    await emitWithAck(first, "subscribe", { symbol: "AAPL" });
    await emitWithAck(first, "subscribe", { symbol: "MSFT" });

    await expect(
      emitWithAck(second, "subscribe", { symbol: "TSLA" }),
    ).resolves.toMatchObject({ ok: true, symbol: "TSLA" });
    await expect(
      emitWithAck(second, "subscribe", { symbol: "NVDA" }),
    ).resolves.toMatchObject({ ok: true, symbol: "NVDA" });

    await expect(
      emitWithAck(first, "subscribe", { symbol: "AMD" }),
    ).resolves.toMatchObject({
      ok: false,
      code: "SUBSCRIPTION_LIMIT_REACHED",
    });
    await expect(
      emitWithAck(second, "subscribe", { symbol: "INTC" }),
    ).resolves.toMatchObject({
      ok: false,
      code: "SUBSCRIPTION_LIMIT_REACHED",
    });
  });

  it("rate-limits subscription events per socket", async () => {
    await startServer({
      marketMaxSubscriptionsPerSocket: 10,
      marketSubscriptionRateLimit: 2,
      marketSubscriptionRateWindowMs: 80,
    });
    const client = await connect();

    await expect(
      emitWithAck(client, "subscribe", { symbol: "AAPL" }),
    ).resolves.toMatchObject({ ok: true });

    await expect(
      emitWithAck(client, "subscribe", { symbol: "MSFT" }),
    ).resolves.toMatchObject({ ok: true });

    await expect(
      emitWithAck(client, "subscribe", { symbol: "GOOG" }),
    ).resolves.toEqual({
      ok: false,
      code: "RATE_LIMITED",
      message: expect.any(String),
      retryAfterMs: expect.any(Number),
    });

    await sleep(120);

    await expect(
      emitWithAck(client, "subscribe", { symbol: "GOOG" }),
    ).resolves.toMatchObject({ ok: true, symbol: "GOOG" });
  });

  it("accepts an explicit asset class for ambiguous symbols", async () => {
    await startServer();
    const client = await connect();

    // GBTC is a stock ticker even though it ends in BTC. Inference must not
    // silently route it to the crypto provider.
    await expect(
      emitWithAck(client, "subscribe", { symbol: "GBTC" }),
    ).resolves.toMatchObject({
      ok: true,
      symbol: "GBTC",
      assetClass: "STOCK",
    });

    await expect(
      emitWithAck(client, "subscribe", {
        symbol: "WBTC",
        assetClass: "CRYPTO",
      }),
    ).resolves.toMatchObject({
      ok: true,
      symbol: "WBTC",
      assetClass: "CRYPTO",
    });

    await expect(
      emitWithAck(client, "subscribe", {
        symbol: "AAPL",
        assetClass: "OPTION",
      }),
    ).resolves.toMatchObject({
      ok: false,
      code: "VALIDATION_ERROR",
    });
  });

  it("rejects an asset class the price stream cannot serve", async () => {
    const capabilityStream = {
      subscribe: jest.fn(),
      unsubscribe: jest.fn(),
      stop: jest.fn(),
      supportsAssetClass: (assetClass) => assetClass === "CRYPTO",
    };

    await startServer({ marketPriceStream: capabilityStream });
    const client = await connect();

    await expect(
      emitWithAck(client, "subscribe", { symbol: "AAPL" }),
    ).resolves.toEqual({
      ok: false,
      code: "MARKET_DATA_UNAVAILABLE",
      message: expect.stringContaining("STOCK"),
    });

    await expect(
      emitWithAck(client, "subscribe", { symbol: "BTCUSDT" }),
    ).resolves.toMatchObject({ ok: true, symbol: "BTCUSDT" });

    expect(capabilityStream.subscribe).toHaveBeenCalledTimes(1);
  });

  it("does not leak a phantom global subscription when the provider subscribe fails", async () => {
    const failingStream = {
      subscribe: jest
        .fn()
        .mockImplementationOnce(() => {
          throw new Error("provider subscribe failed");
        })
        .mockImplementation(() => {}),
      unsubscribe: jest.fn(),
      stop: jest.fn(),
    };

    await startServer({
      marketPriceStream: failingStream,
      marketMaxTotalSubscriptions: 1,
    });
    const client = await connect();

    await expect(
      emitWithAck(client, "subscribe", { symbol: "AAPL" }),
    ).resolves.toMatchObject({
      ok: false,
      code: "INTERNAL_SERVER_ERROR",
    });

    // The failed attempt must have released both the per-socket state and the
    // global slot, so a retry can succeed.
    await expect(
      emitWithAck(client, "subscribe", { symbol: "AAPL" }),
    ).resolves.toMatchObject({ ok: true, symbol: "AAPL" });

    expect(failingStream.subscribe).toHaveBeenCalledTimes(2);
  });

  it("keeps the subscription working when the price cache read fails", async () => {
    await startServer({
      marketCache: {
        async getPrice() {
          throw new Error("cache unavailable");
        },
        async setPrice() {
          return true;
        },
      },
    });
    const client = await connect();

    await expect(
      emitWithAck(client, "subscribe", { symbol: "AAPL" }),
    ).resolves.toMatchObject({ ok: true, symbol: "AAPL" });
  });

  it("enforces an optional global distinct-symbol limit", async () => {
    await startServer({ marketMaxTotalSubscriptions: 2 });
    const first = await connect();
    const second = await connect();

    await expect(
      emitWithAck(first, "subscribe", { symbol: "AAPL" }),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      emitWithAck(second, "subscribe", { symbol: "MSFT" }),
    ).resolves.toMatchObject({ ok: true });

    await expect(
      emitWithAck(first, "subscribe", { symbol: "GOOG" }),
    ).resolves.toMatchObject({
      ok: false,
      code: "SUBSCRIPTION_LIMIT_REACHED",
    });

    // Sharing an already-streamed symbol is still allowed because it does not
    // create another upstream subscription.
    await expect(
      emitWithAck(first, "subscribe", { symbol: "MSFT" }),
    ).resolves.toMatchObject({ ok: true, symbol: "MSFT" });

    await emitWithAck(first, "unsubscribe", { symbol: "AAPL" });
    await emitWithAck(second, "unsubscribe", { symbol: "MSFT" });

    await expect(
      emitWithAck(first, "subscribe", { symbol: "GOOG" }),
    ).resolves.toMatchObject({ ok: true, symbol: "GOOG" });
  });
});
