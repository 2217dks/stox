const { createShutdown } = require("../../src/serverShutdown");

const silentLogger = {
  info() {},
  warn() {},
  error() {},
};

function deferred() {
  let resolve;
  const promise = new Promise((current) => {
    resolve = current;
  });

  return { promise, resolve };
}

function createIo(order, callback = (done) => setImmediate(done)) {
  return {
    close: jest.fn((done) => {
      order.push("io:close");
      callback(done);
    }),
  };
}

describe("Server shutdown lifecycle", () => {
  it("stops accepting connections first and awaits Redis cleanup before exiting", async () => {
    const order = [];
    const io = createIo(order);
    const marketRooms = {
      stop: jest.fn(() => order.push("rooms:stop")),
    };
    const realtimeBridge = {
      stop: jest.fn(() => order.push("bridge:stop")),
      ready: Promise.resolve(true),
    };
    const eventBus = {
      close: jest.fn(async () => {
        order.push("bus:start");
        await Promise.resolve();
        order.push("bus:end");
      }),
    };
    const exit = jest.fn();

    const shutdown = createShutdown({
      io,
      marketRooms,
      realtimeBridge,
      eventBus,
      logger: silentLogger,
      exit,
    });

    await shutdown("SIGTERM");

    expect(order).toEqual([
      "io:close",
      "rooms:stop",
      "bridge:stop",
      "bus:start",
      "bus:end",
    ]);
    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("waits for a bridge that is still initializing", async () => {
    const order = [];
    const ready = deferred();
    const io = createIo(order);
    const realtimeBridge = {
      stop: jest.fn(() => {
        order.push("bridge:stop");
        ready.resolve(false);
      }),
      ready: ready.promise,
    };
    const eventBus = {
      close: jest.fn(async () => order.push("bus:close")),
    };
    const exit = jest.fn();

    const shutdown = createShutdown({
      io,
      realtimeBridge,
      eventBus,
      logger: silentLogger,
      exit,
    });

    await shutdown("SIGINT");

    expect(order).toEqual(["io:close", "bridge:stop", "bus:close"]);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("still exits when one resource fails to close", async () => {
    const order = [];
    const exit = jest.fn();

    const shutdown = createShutdown({
      io: createIo(order),
      marketRooms: {
        stop() {
          throw new Error("rooms failed");
        },
      },
      realtimeBridge: {
        stop() {
          throw new Error("bridge failed");
        },
        ready: Promise.resolve(false),
      },
      eventBus: {
        close: jest.fn(async () => {
          order.push("bus:close");
          throw new Error("redis failed");
        }),
      },
      logger: silentLogger,
      exit,
    });

    await expect(shutdown("SIGTERM")).resolves.toBeUndefined();

    expect(order).toEqual(["io:close", "bus:close"]);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("is idempotent across repeated signals", async () => {
    const order = [];
    const exit = jest.fn();
    const close = deferred();

    const shutdown = createShutdown({
      io: {
        close: jest.fn((done) => {
          order.push("io:close");
          close.promise.then(done);
        }),
      },
      eventBus: {
        close: jest.fn(async () => order.push("bus:close")),
      },
      logger: silentLogger,
      exit,
    });

    const first = shutdown("SIGINT");
    const second = shutdown("SIGTERM");

    expect(second).toBe(first);

    close.resolve();

    await Promise.all([first, second]);

    expect(order).toEqual(["io:close", "bus:close"]);
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it("tolerates a server without realtime resources", async () => {
    const exit = jest.fn();

    const shutdown = createShutdown({
      logger: silentLogger,
      exit,
    });

    await shutdown("SIGTERM");

    expect(exit).toHaveBeenCalledWith(0);
  });
});
