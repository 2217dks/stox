const net = require("net");

const {
  createMarketStream,
} = require("../../src/services/marketStreamService");
const {
  startProviderServer,
} = require("../helpers/providerServer");
const {
  silentLogger,
  sleep,
  waitFor,
} = require("../helpers/realtime");

const TICK_TIME = Date.UTC(2026, 10, 11, 10, 0, 0);
const TICK_ISO = new Date(TICK_TIME).toISOString();
const NEXT_TICK_ISO = new Date(TICK_TIME + 1000).toISOString();

/**
 * These tests treat the market stream as a black box:
 *
 *   real TCP provider  <->  createMarketStream()  ->  listener callbacks
 *
 * No fake sockets, no fake timers, and no assertions on private state. Every
 * expectation is something an upstream provider or a downstream consumer can
 * actually observe.
 */
describe("Market stream provider connection", () => {
  let provider;
  let streams;

  beforeAll(async () => {
    jest.setTimeout(30000);
    provider = await startProviderServer();
  });

  afterAll(async () => {
    await provider.close();
  });

  beforeEach(() => {
    streams = [];
    provider.connections.length = 0;
  });

  afterEach(async () => {
    for (const stream of streams) {
      stream.stop();
    }

    // Give client close frames a chance to reach the provider before the next
    // test starts counting connections.
    await sleep(20);
  });

  function providerConfig(overrides = {}) {
    return {
      finnhubApiKey: "test-finnhub-key",
      finnhubUrl: provider.url("/finnhub"),
      binanceUrl: provider.url("/binance"),
      ...overrides,
    };
  }

  function buildStream(overrides = {}) {
    const stream = createMarketStream({
      config: providerConfig(),
      logger: silentLogger,
      baseDelayMs: 20,
      maxDelayMs: 40,
      maxAttempts: 4,
      ...overrides,
    });

    streams.push(stream);
    return stream;
  }

  async function waitForConnection(path, description) {
    return waitFor(
      () => provider.connections.find((entry) => entry.path === path),
      { description: description || `${path} connection` },
    );
  }

  async function waitForMessage(connection, predicate, description) {
    return waitFor(
      () => connection.messages.find(predicate),
      { description: description || "provider message" },
    );
  }

  function stockSubscribe(symbol) {
    return (message) =>
      message.type === "subscribe" && message.symbol === symbol;
  }

  function binanceSubscribe(symbol) {
    const stream = `${symbol.toLowerCase()}@trade`;

    return (message) =>
      message.method === "SUBSCRIBE" &&
      Array.isArray(message.params) &&
      message.params.includes(stream);
  }

  it("does not open a provider connection until something subscribes", async () => {
    buildStream();

    await sleep(80);

    expect(provider.connections).toHaveLength(0);
  });

  it("connects to Finnhub with the API token and subscribes to a stock", async () => {
    const stream = buildStream();

    // Lowercase and surrounding whitespace must normalise before the provider
    // ever sees the symbol.
    stream.subscribe(" aapl ", jest.fn());

    const connection = await waitForConnection("/finnhub");

    expect(connection.query.get("token")).toBe("test-finnhub-key");
    await expect(
      waitForMessage(connection, stockSubscribe("AAPL")),
    ).resolves.toEqual({ type: "subscribe", symbol: "AAPL" });
  });

  it("connects to Binance and subscribes to a crypto pair in provider format", async () => {
    const stream = buildStream();

    stream.subscribe("BINANCE:btcusdt", jest.fn());

    const connection = await waitForConnection("/binance");

    await expect(
      waitForMessage(connection, binanceSubscribe("BTCUSDT")),
    ).resolves.toEqual({
      method: "SUBSCRIBE",
      params: ["btcusdt@trade"],
      id: 1,
    });
  });

  it("opens one connection per provider and never duplicates a subscription", async () => {
    const stream = buildStream();
    const firstListener = jest.fn();
    const secondListener = jest.fn();

    stream.subscribe("AAPL", firstListener);
    stream.subscribe("MSFT", jest.fn());
    stream.subscribe("BTCUSDT", jest.fn());

    const stock = await waitForConnection("/finnhub");
    const crypto = await waitForConnection("/binance");

    await waitForMessage(stock, stockSubscribe("MSFT"));

    expect(
      provider.connections.filter((entry) => entry.path === "/finnhub"),
    ).toHaveLength(1);
    expect(
      provider.connections.filter((entry) => entry.path === "/binance"),
    ).toHaveLength(1);

    // A second listener for an already-streamed symbol is served locally; it
    // must not produce another upstream subscription.
    stream.subscribe("AAPL", secondListener);

    await sleep(50);

    expect(
      stock.messages.filter((message) => message.type === "subscribe"),
    ).toHaveLength(2);

    stock.socket.send(
      JSON.stringify({
        type: "trade",
        data: [{ s: "AAPL", p: 101, v: 3, t: TICK_TIME }],
      }),
    );

    await waitFor(() => firstListener.mock.calls.length === 1, {
      description: "first AAPL listener",
    });
    await waitFor(() => secondListener.mock.calls.length === 1, {
      description: "second AAPL listener",
    });
  });

  it("normalises a Finnhub trade batch into one tick per trade", async () => {
    const stream = buildStream();
    const listener = jest.fn();

    stream.subscribe("AAPL", listener);

    const connection = await waitForConnection("/finnhub");
    await waitForMessage(connection, stockSubscribe("AAPL"));

    connection.socket.send(
      JSON.stringify({
        type: "trade",
        data: [
          { s: "AAPL", p: 123.45, v: 10, t: TICK_TIME },
          { s: "AAPL", p: 123.5, v: 5, t: TICK_TIME + 1000 },
        ],
      }),
    );

    await waitFor(() => listener.mock.calls.length === 2, {
      description: "two normalised ticks",
    });

    expect(listener).toHaveBeenNthCalledWith(1, {
      symbol: "AAPL",
      price: "123.45",
      volume: "10",
      timestamp: TICK_ISO,
    });
    expect(listener).toHaveBeenNthCalledWith(2, {
      symbol: "AAPL",
      price: "123.5",
      volume: "5",
      timestamp: NEXT_TICK_ISO,
    });
  });

  it("normalises Binance raw and combined trade frames", async () => {
    const stream = buildStream();
    const listener = jest.fn();

    stream.subscribe("BTCUSDT", listener);

    const connection = await waitForConnection("/binance");
    await waitForMessage(connection, binanceSubscribe("BTCUSDT"));

    connection.socket.send(
      JSON.stringify({
        e: "trade",
        s: "BTCUSDT",
        p: "67123.45",
        q: "0.5",
        T: TICK_TIME,
      }),
    );
    connection.socket.send(
      JSON.stringify({
        stream: "btcusdt@trade",
        data: {
          e: "trade",
          s: "BTCUSDT",
          p: "67124",
          q: "0.25",
          T: TICK_TIME + 1000,
        },
      }),
    );

    await waitFor(() => listener.mock.calls.length === 2, {
      description: "two normalised crypto ticks",
    });

    expect(listener).toHaveBeenNthCalledWith(1, {
      symbol: "BTCUSDT",
      price: "67123.45",
      volume: "0.5",
      timestamp: TICK_ISO,
    });
    expect(listener).toHaveBeenNthCalledWith(2, {
      symbol: "BTCUSDT",
      price: "67124",
      volume: "0.25",
      timestamp: NEXT_TICK_ISO,
    });
  });

  it("reports a missing volume as null and keeps price as a string", async () => {
    const stream = buildStream();
    const listener = jest.fn();

    stream.subscribe("AAPL", listener);

    const connection = await waitForConnection("/finnhub");
    await waitForMessage(connection, stockSubscribe("AAPL"));

    connection.socket.send(
      JSON.stringify({ type: "trade", data: [{ s: "AAPL", p: 7.5, t: TICK_TIME }] }),
    );

    await expect(
      waitFor(() => listener.mock.calls[0], {
        description: "tick without volume",
      }),
    ).resolves.toEqual([
      {
        symbol: "AAPL",
        price: "7.5",
        volume: null,
        timestamp: TICK_ISO,
      },
    ]);
  });

  it("ignores unrelated and unparseable provider frames without disconnecting", async () => {
    const stream = buildStream();
    const listener = jest.fn();

    stream.subscribe("AAPL", listener);

    const connection = await waitForConnection("/finnhub");
    await waitForMessage(connection, stockSubscribe("AAPL"));

    connection.socket.send(JSON.stringify({ type: "ping" }));
    connection.socket.send(JSON.stringify({ e: "depthUpdate", s: "AAPL" }));
    connection.socket.send("not-json");
    connection.socket.send(JSON.stringify(null));

    await sleep(50);

    expect(listener).not.toHaveBeenCalled();
    expect(connection.closed).toBe(false);

    connection.socket.send(
      JSON.stringify({ type: "trade", data: [{ s: "AAPL", p: 1, v: 1, t: TICK_TIME }] }),
    );

    await expect(
      waitFor(() => listener.mock.calls[0], { description: "valid tick" }),
    ).resolves.toEqual([
      {
        symbol: "AAPL",
        price: "1",
        volume: "1",
        timestamp: TICK_ISO,
      },
    ]);
  });

  it("keeps notifying healthy listeners when one listener throws", async () => {
    const stream = buildStream();
    const healthy = jest.fn();

    stream.subscribe("AAPL", () => {
      throw new Error("consumer blew up");
    });
    stream.subscribe("AAPL", healthy);

    const connection = await waitForConnection("/finnhub");
    await waitForMessage(connection, stockSubscribe("AAPL"));

    connection.socket.send(
      JSON.stringify({ type: "trade", data: [{ s: "AAPL", p: 2, v: 1, t: TICK_TIME }] }),
    );

    await waitFor(() => healthy.mock.calls.length === 1, {
      description: "healthy listener",
    });
  });

  it("sends an upstream unsubscribe and stops delivering ticks", async () => {
    const stream = buildStream();
    const listener = jest.fn();

    stream.subscribe("AAPL", listener);

    const connection = await waitForConnection("/finnhub");
    await waitForMessage(connection, stockSubscribe("AAPL"));

    stream.unsubscribe("AAPL");

    await waitForMessage(
      connection,
      (message) =>
        message.type === "unsubscribe" && message.symbol === "AAPL",
      "AAPL unsubscribe",
    );

    connection.socket.send(
      JSON.stringify({ type: "trade", data: [{ s: "AAPL", p: 2, v: 1, t: TICK_TIME }] }),
    );

    await sleep(50);

    expect(listener).not.toHaveBeenCalled();
  });

  it("does not subscribe upstream when the last listener left before open", async () => {
    const stream = buildStream();

    stream.subscribe("AAPL", jest.fn());
    stream.unsubscribe("AAPL");

    const connection = await waitForConnection("/finnhub");

    await sleep(80);

    expect(connection.messages).toEqual([]);
  });

  it("reconnects after a provider drop and replays the active subscriptions", async () => {
    const stream = buildStream();
    const listener = jest.fn();

    stream.subscribe("AAPL", listener);

    const first = await waitForConnection("/finnhub");
    await waitForMessage(first, stockSubscribe("AAPL"));

    first.socket.terminate();

    const second = await waitFor(
      () =>
        provider.connections.find(
          (entry) => entry.path === "/finnhub" && entry !== first,
        ),
      { description: "reconnected Finnhub socket" },
    );

    await waitForMessage(
      second,
      stockSubscribe("AAPL"),
      "resubscribe after reconnect",
    );

    second.socket.send(
      JSON.stringify({ type: "trade", data: [{ s: "AAPL", p: 42, v: 1, t: TICK_TIME }] }),
    );

    await waitFor(() => listener.mock.calls.length === 1, {
      description: "tick after reconnect",
    });
  });

  it("restores every watched symbol after a reconnect", async () => {
    const stream = buildStream();

    stream.subscribe("AAPL", jest.fn());
    stream.subscribe("MSFT", jest.fn());

    const first = await waitForConnection("/finnhub");
    await waitForMessage(first, stockSubscribe("MSFT"));

    first.socket.terminate();

    const second = await waitFor(
      () =>
        provider.connections.find(
          (entry) => entry.path === "/finnhub" && entry !== first,
        ),
      { description: "reconnected Finnhub socket" },
    );

    await waitFor(
      () =>
        second.messages.filter((message) => message.type === "subscribe")
          .length === 2,
      { description: "both symbols resubscribed" },
    );

    expect(
      second.messages
        .filter((message) => message.type === "subscribe")
        .map((message) => message.symbol)
        .sort(),
    ).toEqual(["AAPL", "MSFT"]);
  });

  it("stops reconnecting after the configured attempt limit", async () => {
    const attempts = [];
    const rejecting = net.createServer((socket) => {
      attempts.push(Date.now());
      socket.destroy();
    });

    await new Promise((resolve, reject) => {
      rejecting.once("error", reject);
      rejecting.listen(0, "127.0.0.1", resolve);
    });

    const port = rejecting.address().port;
    const stream = createMarketStream({
      config: {
        finnhubApiKey: "test-key",
        finnhubUrl: `ws://127.0.0.1:${port}`,
        binanceUrl: `ws://127.0.0.1:${port}`,
      },
      logger: silentLogger,
      baseDelayMs: 20,
      maxDelayMs: 20,
      maxAttempts: 3,
    });

    streams.push(stream);
    stream.subscribe("AAPL", jest.fn());

    await waitFor(() => attempts.length >= 4, {
      description: "initial attempt plus three retries",
    });

    await sleep(150);

    expect(attempts).toHaveLength(4);

    await new Promise((resolve) => rejecting.close(resolve));
  });

  it("waits between reconnect attempts", async () => {
    const attempts = [];
    const rejecting = net.createServer((socket) => {
      attempts.push(Date.now());
      socket.destroy();
    });

    await new Promise((resolve, reject) => {
      rejecting.once("error", reject);
      rejecting.listen(0, "127.0.0.1", resolve);
    });

    const port = rejecting.address().port;
    const stream = createMarketStream({
      config: {
        finnhubApiKey: "test-key",
        finnhubUrl: `ws://127.0.0.1:${port}`,
        binanceUrl: `ws://127.0.0.1:${port}`,
      },
      logger: silentLogger,
      baseDelayMs: 60,
      maxDelayMs: 60,
      maxAttempts: 2,
    });

    streams.push(stream);
    stream.subscribe("AAPL", jest.fn());

    await waitFor(() => attempts.length >= 3, {
      description: "initial attempt plus two retries",
    });

    const gaps = [
      attempts[1] - attempts[0],
      attempts[2] - attempts[1],
    ];

    // Real timers cannot be earlier than the configured delay; the small
    // margin only absorbs scheduling overhead in the other direction.
    expect(gaps[0]).toBeGreaterThanOrEqual(50);
    expect(gaps[1]).toBeGreaterThanOrEqual(50);

    await new Promise((resolve) => rejecting.close(resolve));
  });

  it("keeps stock streaming dormant when no Finnhub key is configured", async () => {
    const stream = buildStream({
      config: providerConfig({ finnhubApiKey: "" }),
    });

    stream.subscribe("AAPL", jest.fn());

    await sleep(100);

    expect(
      provider.connections.filter((entry) => entry.path === "/finnhub"),
    ).toHaveLength(0);

    // Crypto does not depend on the stock credentials.
    stream.subscribe("BTCUSDT", jest.fn());

    await waitForConnection("/binance");
  });

  it("closes the provider socket on stop and never reconnects", async () => {
    const stream = buildStream();

    stream.subscribe("AAPL", jest.fn());

    const connection = await waitForConnection("/finnhub");
    await waitForMessage(connection, stockSubscribe("AAPL"));

    stream.stop();

    await waitFor(() => connection.closed, {
      description: "provider connection closed",
    });

    await sleep(150);

    expect(
      provider.connections.filter((entry) => entry.path === "/finnhub"),
    ).toHaveLength(1);
  });

  it("rejects invalid subscribe arguments", () => {
    const stream = buildStream();

    expect(() => stream.subscribe("", jest.fn())).toThrow(
      /symbol is required/i,
    );
    expect(() => stream.subscribe("AAPL")).toThrow(TypeError);
    expect(() => stream.unsubscribe("")).not.toThrow();
  });
});
