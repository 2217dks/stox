const http = require("http");
const { io: createClient } = require("socket.io-client");

const app = require("../../src/app");
const { createSocketServer } = require("../../src/sockets");

const CONNECT_TIMEOUT_MS = 5000;
const DEFAULT_ORIGIN = "http://localhost:3000";

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

function connectClient(url) {
  const client = createClient(url, {
    transports: ["websocket"],
    reconnection: false,
    forceNew: true,
  });

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      client.close();
      reject(new Error("Socket client did not connect in time."));
    }, CONNECT_TIMEOUT_MS);

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

function closeServer(io) {
  return new Promise((resolve) => {
    io.close(resolve);
  });
}

describe("Socket.IO server integration", () => {
  let server;
  let io;
  let baseUrl;

  beforeAll(async () => {
    server = http.createServer(app);
    ({ io } = createSocketServer(server));

    const port = await listen(server);
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await closeServer(io);
  });

  it("attaches Socket.IO to the provided HTTP server and accepts a client connection", async () => {
    const client = await connectClient(baseUrl);

    expect(client.connected).toBe(true);
    expect(typeof client.id).toBe("string");
    expect(client.id.length).toBeGreaterThan(0);

    client.close();
  });

  it("keeps the Express app serving HTTP on the same server", async () => {
    const response = await fetch(`${baseUrl}/api/v1/__socket-test-route__`);
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toEqual({
      success: false,
      error: {
        code: "ROUTE_NOT_FOUND",
        message: expect.any(String),
      },
    });
  });

  it("allows the configured CORS origin during the Socket.IO handshake", async () => {
    const configuredOrigin = process.env.CORS_ORIGIN || DEFAULT_ORIGIN;

    const response = await fetch(
      `${baseUrl}/socket.io/?EIO=4&transport=polling`,
      {
        headers: { Origin: configuredOrigin },
      },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe(
      configuredOrigin,
    );
  });

  it("does not allow an origin outside the CORS allow-list", async () => {
    const response = await fetch(
      `${baseUrl}/socket.io/?EIO=4&transport=polling`,
      {
        headers: { Origin: "http://untrusted.example" },
      },
    );

    expect(response.headers.get("access-control-allow-origin")).not.toBe(
      "http://untrusted.example",
    );
  });

  it("closes the underlying HTTP server when the Socket.IO server closes", async () => {
    const isolatedServer = http.createServer(app);
    const { io: isolatedIo } = createSocketServer(isolatedServer);

    const port = await listen(isolatedServer);
    const client = await connectClient(`http://127.0.0.1:${port}`);

    await closeServer(isolatedIo);

    expect(isolatedServer.listening).toBe(false);
    await expect(connectClient(`http://127.0.0.1:${port}`)).rejects.toThrow();

    client.close();
  });
});
