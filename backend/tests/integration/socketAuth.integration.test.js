const http = require("http");
const request = require("supertest");
const { io: createClient } = require("socket.io-client");

const app = require("../../src/app");
const prisma = require("../../src/config/database");
const { createSocketServer } = require("../../src/sockets");

const CONNECT_TIMEOUT_MS = 5000;

const timestamp = Date.now();

const credentials = {
  name: "Socket Auth Test User",
  email: `socket-auth-${timestamp}@stox.local`,
  password: "TestPassword123!",
};

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

/**
 * Resolve with the outcome instead of rejecting, so tests can assert on both
 * successful connections and `connect_error` codes.
 */
function attemptConnection(url, options = {}) {
  const client = createClient(url, {
    transports: ["websocket"],
    reconnection: false,
    forceNew: true,
    ...options,
  });

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      client.close();
      resolve({ status: "timeout", client });
    }, CONNECT_TIMEOUT_MS);

    client.once("connect", () => {
      clearTimeout(timer);
      resolve({ status: "connected", client });
    });

    client.once("connect_error", (error) => {
      clearTimeout(timer);
      client.close();
      resolve({ status: "error", error });
    });
  });
}

describe("Socket.IO authenticated handshake", () => {
  let server;
  let io;
  let baseUrl;
  let accessToken;
  let userId;

  beforeAll(async () => {
    jest.setTimeout(20000);

    server = http.createServer(app);
    ({ io } = createSocketServer(server));

    const port = await listen(server);
    baseUrl = `http://127.0.0.1:${port}`;

    const registration = await request(app)
      .post("/api/v1/auth/register")
      .send(credentials);

    accessToken = registration.body.data.accessToken;
    userId = registration.body.data.user.id;
  });

  afterAll(async () => {
    if (userId) {
      await prisma.user.delete({ where: { id: userId } });
    }

    await new Promise((resolve) => io.close(resolve));
    await prisma.$disconnect();
  });

  it("rejects a /trading connection with no credentials", async () => {
    const outcome = await attemptConnection(`${baseUrl}/trading`);

    expect(outcome.status).toBe("error");
    expect(outcome.error.data).toEqual({ code: "UNAUTHORIZED" });
  });

  it("rejects a /trading connection with an invalid token", async () => {
    const outcome = await attemptConnection(`${baseUrl}/trading`, {
      auth: { token: "not-a-jwt" },
    });

    expect(outcome.status).toBe("error");
    expect(outcome.error.data).toEqual({ code: "INVALID_ACCESS_TOKEN" });
  });

  it("accepts a /trading connection with a valid access token", async () => {
    const outcome = await attemptConnection(`${baseUrl}/trading`, {
      auth: { token: accessToken },
    });

    expect(outcome.status).toBe("connected");
    expect(outcome.client.connected).toBe(true);

    outcome.client.close();
  });

  it("keeps the default namespace anonymous", async () => {
    const outcome = await attemptConnection(baseUrl);

    expect(outcome.status).toBe("connected");

    outcome.client.close();
  });
});
