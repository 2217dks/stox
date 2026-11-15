const http = require("http");

const app = require("../../src/app");
const { createSocketServer } = require("../../src/sockets");
const {
  connectSocket,
  emitWithAck,
  listen,
  waitFor,
} = require("../helpers/realtime");

describe("Socket.IO heartbeat and disconnect cleanup", () => {
  let server;
  let io;
  let marketRooms;
  let baseUrl;

  const priceStream = {
    subscribe: jest.fn(),
    unsubscribe: jest.fn(),
    stop: jest.fn(),
  };

  const previousInterval = process.env.SOCKET_PING_INTERVAL_MS;
  const previousTimeout = process.env.SOCKET_PING_TIMEOUT_MS;

  beforeAll(async () => {
    jest.setTimeout(20000);

    process.env.SOCKET_PING_INTERVAL_MS = "1234";
    process.env.SOCKET_PING_TIMEOUT_MS = "4321";

    server = http.createServer(app);
    ({ io, marketRooms } = createSocketServer(server, {
      marketPriceStream: priceStream,
    }));

    baseUrl = `http://127.0.0.1:${await listen(server)}`;
  });

  afterAll(async () => {
    marketRooms.stop();
    await new Promise((resolve) => io.close(resolve));

    if (previousInterval === undefined) {
      delete process.env.SOCKET_PING_INTERVAL_MS;
    } else {
      process.env.SOCKET_PING_INTERVAL_MS = previousInterval;
    }

    if (previousTimeout === undefined) {
      delete process.env.SOCKET_PING_TIMEOUT_MS;
    } else {
      process.env.SOCKET_PING_TIMEOUT_MS = previousTimeout;
    }
  });

  test("passes the configured heartbeat values to the Engine.IO server", () => {
    expect(io.engine.opts.pingInterval).toBe(1234);
    expect(io.engine.opts.pingTimeout).toBe(4321);
  });

  test("releases a market subscription when the socket disconnects", async () => {
    priceStream.subscribe.mockClear();
    priceStream.unsubscribe.mockClear();

    const client = await connectSocket(baseUrl, "/market");

    const ack = await emitWithAck(client, "subscribe", {
      symbol: "AAPL",
      assetClass: "STOCK",
    });

    expect(ack).toMatchObject({ ok: true, symbol: "AAPL" });
    expect(priceStream.subscribe).toHaveBeenCalledWith(
      "AAPL",
      expect.any(Function),
      "STOCK",
    );

    client.disconnect();

    await waitFor(
      () =>
        priceStream.unsubscribe.mock.calls.some(
          ([symbol, assetClass]) =>
            symbol === "AAPL" && assetClass === "STOCK",
        ),
      { description: "market subscription cleanup" },
    );
  });
});
