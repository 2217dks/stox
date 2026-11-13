const { WebSocketServer } = require("ws");

/**
 * A real WebSocket endpoint that impersonates Finnhub and Binance.
 *
 * Tests drive the provider protocol over an actual TCP connection, so
 * reconnection, subscription messages, and message parsing are exercised
 * exactly as they are in production. Nothing here reaches the internet.
 */
async function startProviderServer() {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });

  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });

  const connections = [];

  server.on("connection", (socket, request) => {
    const url = request.url || "/";
    const [path, queryString = ""] = url.split("?");

    const entry = {
      socket,
      url,
      path,
      query: new URLSearchParams(queryString),
      messages: [],
      closed: false,
    };

    socket.on("message", (raw) => {
      const text = raw.toString();

      try {
        entry.messages.push(JSON.parse(text));
      } catch (error) {
        // Keep raw non-JSON frames so a test can prove they are ignored.
        entry.messages.push(text);
      }
    });

    socket.on("close", () => {
      entry.closed = true;
    });

    connections.push(entry);
  });

  const { port } = server.address();

  return {
    port,
    server,
    connections,
    url(path) {
      return `ws://127.0.0.1:${port}${path}`;
    },
    openConnections(path) {
      return connections.filter(
        (entry) => entry.path === path && !entry.closed,
      );
    },
    latestConnection(path) {
      const open = connections.filter(
        (entry) => entry.path === path && !entry.closed,
      );

      return open[open.length - 1] || null;
    },
    async close() {
      for (const entry of connections) {
        try {
          entry.socket.terminate();
        } catch (error) {
          // Already closed.
        }
      }

      await new Promise((resolve) => server.close(resolve));
    },
  };
}

module.exports = {
  startProviderServer,
};
