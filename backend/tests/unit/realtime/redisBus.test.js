const { EventEmitter } = require("events");

const { createRedisEventBus } = require("../../../src/realtime/redisBus");
const { waitFor } = require("../../helpers/realtime");

/**
 * ioredis is an EventEmitter with a small state machine. This fake models just
 * enough of that surface (status, connect, duplicate, subscribe, message) to
 * exercise the bus's own retry and resubscribe logic without needing a second
 * Redis instance or a network outage.
 */
function createFakeRedisFactory({ failConnects = 0 } = {}) {
  const factoryState = { failConnects };
  const clients = [];

  function createClient(context) {
    const client = new EventEmitter();

    client.context = context;
    client.status = "wait";
    client.subscribeCalls = [];
    client.published = [];
    client.quitCalls = 0;
    client.disconnectCalls = 0;

    client.connect = jest.fn(async () => {
      if (factoryState.failConnects > 0) {
        factoryState.failConnects -= 1;
        client.status = "end";
        throw new Error("redis unavailable");
      }

      client.status = "ready";
      client.emit("ready");
    });

    client.duplicate = jest.fn(() => {
      const duplicate = createClient("subscriber");
      clients.push(duplicate);
      return duplicate;
    });

    client.subscribe = jest.fn(async (channel) => {
      client.subscribeCalls.push(channel);
      client.status = "ready";
      return 1;
    });

    client.publish = jest.fn(async (channel, payload) => {
      client.published.push({ channel, payload });
      return 1;
    });

    client.quit = jest.fn(async () => {
      client.status = "end";
      client.quitCalls += 1;
    });

    client.disconnect = jest.fn(() => {
      client.status = "end";
      client.disconnectCalls += 1;
    });

    return client;
  }

  const factory = jest.fn(() => {
    const client = createClient("publisher");
    clients.push(client);
    return client;
  });

  factory.clients = clients;
  factory.state = factoryState;

  return factory;
}

describe("Redis event bus lifecycle", () => {
  const buses = [];

  function buildBus(options = {}) {
    const redisFactory = options.redisFactory || createFakeRedisFactory();
    const bus = createRedisEventBus({
      channel: "stox:test:realtime",
      redisFactory,
      ...options,
    });

    buses.push(bus);
    return { bus, redisFactory };
  }

  afterEach(async () => {
    while (buses.length > 0) {
      await buses.pop().close();
    }
  });

  it("keeps the handler and retries after the initial connection fails", async () => {
    const redisFactory = createFakeRedisFactory({ failConnects: 1 });
    const { bus } = buildBus({ redisFactory });
    const handler = jest.fn();

    await expect(bus.subscribe(handler)).rejects.toThrow(/redis unavailable/i);

    expect(bus.connectionState()).toMatchObject({
      subscribed: false,
      handlerCount: 1,
    });

    await bus.subscribe(handler);

    const subscriber = redisFactory.clients.find(
      (client) => client.context === "subscriber",
    );

    expect(subscriber.subscribeCalls).toEqual(["stox:test:realtime"]);
    expect(bus.connectionState()).toMatchObject({
      subscribed: true,
      handlerCount: 1,
    });

    subscriber.emit(
      "message",
      "stox:test:realtime",
      JSON.stringify({ event: "after-retry" }),
    );

    await waitFor(() => handler.mock.calls.length === 1, {
      description: "delivery after a retried subscription",
    });
  });

  it("does not duplicate a handler when subscribe is called repeatedly", async () => {
    const { bus, redisFactory } = buildBus();
    const handler = jest.fn();

    await bus.subscribe(handler);
    await bus.subscribe(handler);

    const subscriber = redisFactory.clients.find(
      (client) => client.context === "subscriber",
    );

    expect(subscriber.subscribeCalls).toEqual(["stox:test:realtime"]);
    expect(bus.connectionState().handlerCount).toBe(1);

    subscriber.emit(
      "message",
      "stox:test:realtime",
      JSON.stringify({ event: "once" }),
    );

    await waitFor(() => handler.mock.calls.length === 1, {
      description: "single delivery",
    });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("restores the channel subscription after a reconnect without duplicate delivery", async () => {
    const { bus, redisFactory } = buildBus();
    const handler = jest.fn();

    await bus.subscribe(handler);

    const subscriber = redisFactory.clients.find(
      (client) => client.context === "subscriber",
    );

    expect(subscriber.subscribeCalls).toHaveLength(1);

    // Simulate ioredis emitting `ready` twice while a resubscribe is pending.
    // The single-flight guard must collapse both into one SUBSCRIBE.
    subscriber.emit("ready");
    subscriber.emit("ready");

    await waitFor(() => subscriber.subscribeCalls.length === 2, {
      description: "one channel resubscription for repeated ready events",
    });

    subscriber.emit(
      "message",
      "stox:test:realtime",
      JSON.stringify({ event: "after-reconnect" }),
    );

    await waitFor(() => handler.mock.calls.length === 1, {
      description: "delivery after reconnect",
    });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("ignores malformed frames without dropping the handler", async () => {
    const { bus, redisFactory } = buildBus();
    const handler = jest.fn();

    await bus.subscribe(handler);

    const subscriber = redisFactory.clients.find(
      (client) => client.context === "subscriber",
    );

    subscriber.emit("message", "stox:test:realtime", "not-json");
    subscriber.emit("message", "other-channel", JSON.stringify({ ok: false }));
    subscriber.emit(
      "message",
      "stox:test:realtime",
      JSON.stringify({ event: "valid" }),
    );

    await waitFor(() => handler.mock.calls.length === 1, {
      description: "valid message after malformed frames",
    });
    expect(handler).toHaveBeenCalledWith({ event: "valid" });
  });

  it("reports publisher and subscriber state for health checks", async () => {
    const { bus, redisFactory } = buildBus();
    const handler = jest.fn();

    await bus.subscribe(handler);

    const subscriber = redisFactory.clients.find(
      (client) => client.context === "subscriber",
    );

    expect(bus.connectionState()).toEqual({
      // The publisher is lazy: it connects on the first publish.
      publisher: "wait",
      subscriber: "ready",
      subscribed: true,
      handlerCount: 1,
      lastError: null,
      lastReadyAt: expect.any(Date),
    });

    subscriber.status = "reconnecting";

    expect(bus.connectionState().subscriber).toBe("reconnecting");
  });

  it("rejects subscriptions on a publisher-only bus", async () => {
    const { bus } = buildBus({ withSubscriber: false });

    await expect(bus.subscribe(jest.fn())).rejects.toThrow(
      /publisher-only/i,
    );
  });

  it("closes both clients exactly once across concurrent close calls", async () => {
    const { bus, redisFactory } = buildBus();
    const handler = jest.fn();

    await bus.subscribe(handler);

    const publisher = redisFactory.clients.find(
      (client) => client.context === "publisher",
    );
    const subscriber = redisFactory.clients.find(
      (client) => client.context === "subscriber",
    );

    await Promise.all([bus.close(), bus.close(), bus.close()]);

    expect(subscriber.quitCalls).toBe(1);
    expect(publisher.quitCalls + publisher.disconnectCalls).toBe(1);
    expect(bus.connectionState()).toMatchObject({
      subscribed: false,
      handlerCount: 0,
    });

    // Repeated cleanup after completion is a no-op.
    await bus.close();

    expect(subscriber.quitCalls).toBe(1);
    expect(publisher.quitCalls + publisher.disconnectCalls).toBe(1);
  });

  it("closes both clients and clears handlers", async () => {
    const { bus, redisFactory } = buildBus();
    const handler = jest.fn();

    await bus.subscribe(handler);
    await bus.close();

    expect(bus.connectionState()).toMatchObject({
      subscribed: false,
      handlerCount: 0,
    });

    for (const client of redisFactory.clients) {
      expect(client.status).toBe("end");
    }
  });
});
