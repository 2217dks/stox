const http = require("http");
const request = require("supertest");
const { io: createClient } = require("socket.io-client");

const app = require("../../src/app");
const prisma = require("../../src/config/database");
const { createSocketServer } = require("../../src/sockets");

const CONNECT_TIMEOUT_MS = 5000;
const ACK_TIMEOUT_MS = 3000;
const EVENT_WINDOW_MS = 300;

const timestamp = Date.now();

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

async function registerUser(label) {
  const response = await request(app)
    .post("/api/v1/auth/register")
    .send({
      name: `Trading Rooms ${label}`,
      email: `trading-rooms-${label}-${timestamp}@stox.local`,
      password: "TestPassword123!",
    });

  const userId = response.body.data.user.id;

  const portfolio = await prisma.portfolio.findFirst({
    where: { userId, isDefault: true },
  });

  return {
    userId,
    accessToken: response.body.data.accessToken,
    portfolioId: portfolio.id,
  };
}

function connectTrading(baseUrl, token) {
  const client = createClient(`${baseUrl}/trading`, {
    transports: ["websocket"],
    reconnection: false,
    forceNew: true,
    auth: { token },
  });

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      client.close();
      reject(new Error("Trading socket did not connect in time."));
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

function emitWithAck(client, event, payload) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ timeout: true }), ACK_TIMEOUT_MS);

    client.emit(event, payload, (ack) => {
      clearTimeout(timer);
      resolve(ack);
    });
  });
}

/**
 * Resolve with the first payload, or `null` when nothing arrives inside the
 * window. Listening must start before the broadcast, otherwise a fast emit
 * would be missed.
 */
function nextEvent(client, event) {
  return new Promise((resolve) => {
    const handler = (payload) => {
      clearTimeout(timer);
      client.off(event, handler);
      resolve(payload);
    };

    const timer = setTimeout(() => {
      client.off(event, handler);
      resolve(null);
    }, EVENT_WINDOW_MS);

    client.on(event, handler);
  });
}

describe("Trading namespace room management", () => {
  let server;
  let io;
  let baseUrl;
  let userA;
  let userB;
  let clientA;

  function broadcastToPortfolio(portfolioId, payload) {
    io.of("/trading")
      .to(`portfolio:${portfolioId}`)
      .emit("portfolio-update", payload);
  }

  beforeAll(async () => {
    jest.setTimeout(20000);

    server = http.createServer(app);
    ({ io } = createSocketServer(server));

    const port = await listen(server);
    baseUrl = `http://127.0.0.1:${port}`;

    [userA, userB] = await Promise.all([
      registerUser("a"),
      registerUser("b"),
    ]);
  });

  beforeEach(async () => {
    clientA = await connectTrading(baseUrl, userA.accessToken);
  });

  afterEach(() => {
    if (clientA?.connected) {
      clientA.close();
    }
  });

  afterAll(async () => {
    await prisma.user.deleteMany({
      where: { id: { in: [userA.userId, userB.userId] } },
    });

    await new Promise((resolve) => io.close(resolve));
    await prisma.$disconnect();
  });

  it("joins the caller's own portfolio and receives its broadcasts", async () => {
    const ack = await emitWithAck(clientA, "join:portfolio", {
      portfolioId: userA.portfolioId,
    });

    expect(ack).toEqual({ ok: true, portfolioId: userA.portfolioId });

    const payload = { portfolioId: userA.portfolioId, totalValue: "10000" };
    const received = nextEvent(clientA, "portfolio-update");
    broadcastToPortfolio(userA.portfolioId, payload);

    await expect(received).resolves.toEqual(payload);
  });

  it("refuses to join another user's portfolio", async () => {
    const ack = await emitWithAck(clientA, "join:portfolio", {
      portfolioId: userB.portfolioId,
    });

    expect(ack).toMatchObject({
      ok: false,
      code: "PORTFOLIO_NOT_FOUND",
    });

    const received = nextEvent(clientA, "portfolio-update");
    broadcastToPortfolio(userB.portfolioId, { portfolioId: userB.portfolioId });

    await expect(received).resolves.toBeNull();
  });

  it("rejects a malformed portfolio id", async () => {
    const ack = await emitWithAck(clientA, "join:portfolio", {
      portfolioId: "not-a-uuid",
    });

    expect(ack).toMatchObject({
      ok: false,
      code: "VALIDATION_ERROR",
    });
  });

  it("leaves a portfolio room on request", async () => {
    const joinAck = await emitWithAck(clientA, "join:portfolio", {
      portfolioId: userA.portfolioId,
    });
    expect(joinAck.ok).toBe(true);

    const leaveAck = await emitWithAck(clientA, "leave:portfolio", {
      portfolioId: userA.portfolioId,
    });
    expect(leaveAck).toEqual({ ok: true, portfolioId: userA.portfolioId });

    const received = nextEvent(clientA, "portfolio-update");
    broadcastToPortfolio(userA.portfolioId, { portfolioId: userA.portfolioId });

    await expect(received).resolves.toBeNull();
  });

  it("treats repeated joins as idempotent and delivers one event", async () => {
    const first = await emitWithAck(clientA, "join:portfolio", {
      portfolioId: userA.portfolioId,
    });
    const second = await emitWithAck(clientA, "join:portfolio", {
      portfolioId: userA.portfolioId,
    });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);

    const received = [];
    const handler = (payload) => received.push(payload);
    clientA.on("portfolio-update", handler);

    broadcastToPortfolio(userA.portfolioId, { portfolioId: userA.portfolioId });

    await new Promise((resolve) => setTimeout(resolve, EVENT_WINDOW_MS));

    clientA.off("portfolio-update", handler);

    expect(received).toHaveLength(1);
  });

  it("stops delivering to a socket after it disconnects", async () => {
    const ack = await emitWithAck(clientA, "join:portfolio", {
      portfolioId: userA.portfolioId,
    });
    expect(ack.ok).toBe(true);

    clientA.close();
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Broadcasting to a room with no members must be a no-op, not an error.
    broadcastToPortfolio(userA.portfolioId, { portfolioId: userA.portfolioId });

    const reconnected = await connectTrading(baseUrl, userA.accessToken);
    const received = nextEvent(reconnected, "portfolio-update");
    broadcastToPortfolio(userA.portfolioId, { portfolioId: userA.portfolioId });

    await expect(received).resolves.toBeNull();

    reconnected.close();
  });
});
