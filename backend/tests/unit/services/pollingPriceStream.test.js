const {
  createPollingPriceStream,
  DEFAULT_INTERVAL_MS,
} = require("../../../src/services/pollingPriceStream");
const {
  sleep,
  waitFor,
} = require("../../helpers/realtime");

const QUOTE_TIME = "2026-11-11T10:00:00.000Z";

/**
 * The polling stream is the fallback selected by `MARKET_STREAM_ENABLED=false`.
 * It is tested through the same `subscribe(symbol, listener)` contract the
 * WebSocket stream exposes, with a real interval timer and a stub quote source.
 */
describe("Polling price stream", () => {
  let streams;

  beforeEach(() => {
    streams = [];
  });

  afterEach(() => {
    for (const stream of streams) {
      stream.stop();
    }
  });

  function buildStream({ getQuote, intervalMs = 30 } = {}) {
    const priceSource = { getQuote: getQuote || jest.fn() };
    const stream = createPollingPriceStream({ priceSource, intervalMs });
    streams.push(stream);

    return { stream, priceSource };
  }

  it("requires a price source with getQuote()", () => {
    expect(() => createPollingPriceStream()).toThrow(TypeError);
    expect(() =>
      createPollingPriceStream({ priceSource: {} }),
    ).toThrow(TypeError);
  });

  it("rejects a non-function listener", () => {
    const { stream } = buildStream();

    expect(() => stream.subscribe("AAPL", null)).toThrow(TypeError);
    expect(() => stream.subscribe("AAPL", "listener")).toThrow(TypeError);
  });

  it("polls immediately and normalises the quote for the first subscriber", async () => {
    const getQuote = jest.fn().mockResolvedValue({
      price: 12.5,
      volume: 4,
      timestamp: QUOTE_TIME,
    });
    const { stream } = buildStream({ getQuote });
    const listener = jest.fn();

    stream.subscribe("AAPL", listener);

    await waitFor(() => listener.mock.calls.length === 1, {
      description: "immediate quote delivery",
    });

    expect(getQuote).toHaveBeenCalledWith("AAPL", { assetClass: "STOCK" });
    expect(listener).toHaveBeenCalledWith({
      symbol: "AAPL",
      price: "12.5",
      volume: "4",
      timestamp: QUOTE_TIME,
    });
  });

  it("infers the crypto asset class for a crypto pair", async () => {
    const getQuote = jest.fn().mockResolvedValue({
      price: "67000",
      volume: "0.25",
      timestamp: QUOTE_TIME,
    });
    const { stream } = buildStream({ getQuote });
    const listener = jest.fn();

    stream.subscribe("BTCUSDT", listener);

    await waitFor(() => listener.mock.calls.length === 1);

    expect(getQuote).toHaveBeenCalledWith("BTCUSDT", {
      assetClass: "CRYPTO",
    });
  });

  it("reports a missing volume as null and keeps price as a string", async () => {
    const getQuote = jest.fn().mockResolvedValue({
      price: 7,
      timestamp: QUOTE_TIME,
    });
    const { stream } = buildStream({ getQuote });
    const listener = jest.fn();

    stream.subscribe("AAPL", listener);

    await waitFor(() => listener.mock.calls.length === 1);

    expect(listener).toHaveBeenCalledWith({
      symbol: "AAPL",
      price: "7",
      volume: null,
      timestamp: QUOTE_TIME,
    });
  });

  it("shares one poll between listeners of the same symbol", async () => {
    let resolveQuote;
    const getQuote = jest.fn(
      () =>
        new Promise((resolve) => {
          resolveQuote = resolve;
        }),
    );
    const { stream } = buildStream({ getQuote, intervalMs: 1000 });
    const first = jest.fn();
    const second = jest.fn();

    stream.subscribe("AAPL", first);
    stream.subscribe("AAPL", second);

    resolveQuote({ price: 1, volume: 2, timestamp: QUOTE_TIME });

    await waitFor(
      () => first.mock.calls.length === 1 && second.mock.calls.length === 1,
      { description: "one poll delivered to both listeners" },
    );

    expect(getQuote).toHaveBeenCalledTimes(1);
  });

  it("keeps polling on the configured interval", async () => {
    const getQuote = jest.fn().mockResolvedValue({
      price: 1,
      volume: 1,
      timestamp: QUOTE_TIME,
    });
    const { stream } = buildStream({ getQuote, intervalMs: 25 });
    const listener = jest.fn();

    stream.subscribe("AAPL", listener);

    await waitFor(() => getQuote.mock.calls.length >= 3, {
      description: "repeated interval polls",
    });

    expect(listener.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it("stops polling and delivering after unsubscribe", async () => {
    const getQuote = jest.fn().mockResolvedValue({
      price: 1,
      volume: 1,
      timestamp: QUOTE_TIME,
    });
    const { stream } = buildStream({ getQuote, intervalMs: 40 });
    const listener = jest.fn();

    stream.subscribe("AAPL", listener);

    await waitFor(() => getQuote.mock.calls.length >= 1);

    stream.unsubscribe("AAPL");

    const callsAtUnsubscribe = getQuote.mock.calls.length;
    const deliveriesAtUnsubscribe = listener.mock.calls.length;

    await sleep(150);

    expect(getQuote.mock.calls.length).toBe(callsAtUnsubscribe);
    expect(listener.mock.calls.length).toBe(deliveriesAtUnsubscribe);
  });

  it("starts a fresh immediate poll after resubscribing", async () => {
    const getQuote = jest.fn().mockResolvedValue({
      price: 1,
      volume: 1,
      timestamp: QUOTE_TIME,
    });
    const { stream } = buildStream({ getQuote, intervalMs: 1000 });
    const first = jest.fn();

    stream.subscribe("AAPL", first);
    await waitFor(() => first.mock.calls.length === 1);

    stream.unsubscribe("AAPL");

    const second = jest.fn();
    stream.subscribe("AAPL", second);

    await waitFor(() => second.mock.calls.length === 1, {
      description: "immediate poll after resubscribe",
    });

    expect(getQuote).toHaveBeenCalledTimes(2);
  });

  it("stops every symbol on stop()", async () => {
    const getQuote = jest.fn().mockResolvedValue({
      price: 1,
      volume: 1,
      timestamp: QUOTE_TIME,
    });
    const { stream } = buildStream({ getQuote, intervalMs: 40 });

    stream.subscribe("AAPL", jest.fn());
    stream.subscribe("BTCUSDT", jest.fn());

    await waitFor(() => getQuote.mock.calls.length >= 2);

    stream.stop();

    const callsAfterStop = getQuote.mock.calls.length;

    await sleep(150);

    expect(getQuote.mock.calls.length).toBe(callsAfterStop);
  });

  it("keeps the other symbols polling when one is unsubscribed", async () => {
    const getQuote = jest.fn().mockResolvedValue({
      price: 1,
      volume: 1,
      timestamp: QUOTE_TIME,
    });
    const { stream } = buildStream({ getQuote, intervalMs: 30 });
    const apple = jest.fn();
    const microsoft = jest.fn();

    stream.subscribe("AAPL", apple);
    stream.subscribe("MSFT", microsoft);

    await waitFor(
      () => apple.mock.calls.length >= 1 && microsoft.mock.calls.length >= 1,
    );

    stream.unsubscribe("AAPL");

    const appleCalls = apple.mock.calls.length;
    const microsoftBefore = microsoft.mock.calls.length;

    await sleep(150);

    expect(apple.mock.calls.length).toBe(appleCalls);
    expect(microsoft.mock.calls.length).toBeGreaterThan(microsoftBefore);
  });

  it("swallows quote failures and keeps polling", async () => {
    const getQuote = jest
      .fn()
      .mockRejectedValueOnce(new Error("provider down"))
      .mockResolvedValue({
        price: 3,
        volume: 1,
        timestamp: QUOTE_TIME,
      });
    const { stream } = buildStream({ getQuote, intervalMs: 25 });
    const listener = jest.fn();

    stream.subscribe("AAPL", listener);

    await waitFor(() => listener.mock.calls.length === 1, {
      description: "delivery after a failed poll",
    });

    expect(getQuote.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(listener).toHaveBeenCalledWith({
      symbol: "AAPL",
      price: "3",
      volume: "1",
      timestamp: QUOTE_TIME,
    });
  });

  it("keeps notifying healthy listeners when one listener throws", async () => {
    const getQuote = jest.fn().mockResolvedValue({
      price: 2,
      volume: 1,
      timestamp: QUOTE_TIME,
    });
    const { stream } = buildStream({ getQuote, intervalMs: 1000 });
    const healthy = jest.fn();

    stream.subscribe("AAPL", () => {
      throw new Error("consumer failed");
    });
    stream.subscribe("AAPL", healthy);

    await waitFor(() => healthy.mock.calls.length === 1, {
      description: "healthy listener after a throwing sibling",
    });

    expect(healthy).toHaveBeenCalledWith({
      symbol: "AAPL",
      price: "2",
      volume: "1",
      timestamp: QUOTE_TIME,
    });
  });

  it("exposes a five-second default interval", () => {
    expect(DEFAULT_INTERVAL_MS).toBe(5000);
  });
});
