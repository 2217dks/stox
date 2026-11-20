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
  const createdUserIds = [];

  beforeAll(async () => {
    jest.setTimeout(30000);

    server = http.createServer(app);
    ({ io } = createSocketServer(server));

    const port = await listen(server);
    baseUrl = `http://127.0.0.1:${port}`;

    const registration = await request(app)
      .post("/api/v1/auth/register")
      .send(credentials);

    accessToken = registration.body.data.accessToken;
    userId = registration.body.data.user.id;
    createdUserIds.push(userId);
  });

  afterAll(async () => {
    if (createdUserIds.length > 0) {
      await prisma.adminAccountAction.deleteMany({
        where: { OR: [{ actorId: { in: createdUserIds } }, { targetId: { in: createdUserIds } }] },
      });
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
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

  it("rejects new socket handshakes for suspended users across authenticated namespaces", async () => {
    const suspendedCreds = {
      name: "Suspended Socket User",
      email: `suspended-socket-${Date.now()}@stox.local`,
      password: "TestPassword123!",
    };
    const reg = await request(app).post("/api/v1/auth/register").send(suspendedCreds);
    expect(reg.status).toBe(201);
    const suspendedUserId = reg.body.data.user.id;
    const suspendedToken = reg.body.data.accessToken;
    createdUserIds.push(suspendedUserId);

    await prisma.user.update({
      where: { id: suspendedUserId },
      data: { isSuspended: true },
    });

    const tradingOutcome = await attemptConnection(`${baseUrl}/trading`, {
      auth: { token: suspendedToken },
    });
    expect(tradingOutcome.status).toBe("error");
    expect(tradingOutcome.error.data).toEqual({ code: "ACCOUNT_SUSPENDED" });

    const notificationsOutcome = await attemptConnection(`${baseUrl}/notifications`, {
      auth: { token: suspendedToken },
    });
    expect(notificationsOutcome.status).toBe("error");
    expect(notificationsOutcome.error.data).toEqual({ code: "ACCOUNT_SUSPENDED" });
  });

  it("disconnects already-connected sockets on /trading and /notifications when suspension commits", async () => {
    const adminCreds = {
      name: "Admin Socket Auditor",
      email: `admin-socket-${Date.now()}@stox.local`,
      password: "AdminPassword123!",
    };
    const adminReg = await request(app).post("/api/v1/auth/register").send(adminCreds);
    expect(adminReg.status).toBe(201);
    const adminId = adminReg.body.data.user.id;
    createdUserIds.push(adminId);
    await prisma.user.update({ where: { id: adminId }, data: { role: "ADMIN" } });
    const adminLogin = await request(app).post("/api/v1/auth/login").send({
      email: adminCreds.email,
      password: adminCreds.password,
    });
    const adminToken = adminLogin.body.data.accessToken;

    const targetCreds = {
      name: "Target Socket User",
      email: `target-socket-${Date.now()}@stox.local`,
      password: "TargetPassword123!",
    };
    const targetReg = await request(app).post("/api/v1/auth/register").send(targetCreds);
    expect(targetReg.status).toBe(201);
    const targetUserId = targetReg.body.data.user.id;
    const targetToken = targetReg.body.data.accessToken;
    createdUserIds.push(targetUserId);

    const tradingOutcome = await attemptConnection(`${baseUrl}/trading`, {
      auth: { token: targetToken },
    });
    expect(tradingOutcome.status).toBe("connected");
    expect(tradingOutcome.client.connected).toBe(true);

    const notificationsOutcome = await attemptConnection(`${baseUrl}/notifications`, {
      auth: { token: targetToken },
    });
    expect(notificationsOutcome.status).toBe("connected");
    expect(notificationsOutcome.client.connected).toBe(true);

    const tradingDisconnected = new Promise((resolve) => {
      tradingOutcome.client.once("disconnect", (reason) => resolve(reason));
    });
    const notificationsDisconnected = new Promise((resolve) => {
      notificationsOutcome.client.once("disconnect", (reason) => resolve(reason));
    });

    const suspendRes = await request(app)
      .patch(`/api/v1/admin/users/${targetUserId}/suspend`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ isSuspended: true, reason: "Realtime policy enforcement" });
    expect(suspendRes.status).toBe(200);

    const tradingReason = await Promise.race([
      tradingDisconnected,
      new Promise((_, reject) => setTimeout(() => reject(new Error("Trading socket disconnect timed out")), 5000)),
    ]);
    const notificationsReason = await Promise.race([
      notificationsDisconnected,
      new Promise((_, reject) => setTimeout(() => reject(new Error("Notifications socket disconnect timed out")), 5000)),
    ]);

    expect(tradingReason).toBe("io server disconnect");
    expect(notificationsReason).toBe("io server disconnect");
    expect(tradingOutcome.client.connected).toBe(false);
    expect(notificationsOutcome.client.connected).toBe(false);

    tradingOutcome.client.close();
    notificationsOutcome.client.close();
  });

  it("does not disconnect sockets if suspension fails", async () => {
    const adminCreds = {
      name: "Admin Self Suspend Tester",
      email: `admin-self-${Date.now()}@stox.local`,
      password: "AdminPassword123!",
    };
    const adminReg = await request(app).post("/api/v1/auth/register").send(adminCreds);
    expect(adminReg.status).toBe(201);
    const adminId = adminReg.body.data.user.id;
    createdUserIds.push(adminId);
    await prisma.user.update({ where: { id: adminId }, data: { role: "ADMIN" } });
    const adminLogin = await request(app).post("/api/v1/auth/login").send({
      email: adminCreds.email,
      password: adminCreds.password,
    });
    const adminToken = adminLogin.body.data.accessToken;

    const tradingOutcome = await attemptConnection(`${baseUrl}/trading`, {
      auth: { token: adminToken },
    });
    expect(tradingOutcome.status).toBe("connected");
    expect(tradingOutcome.client.connected).toBe(true);

    let disconnected = false;
    tradingOutcome.client.once("disconnect", () => {
      disconnected = true;
    });

    const failedRes = await request(app)
      .patch(`/api/v1/admin/users/${adminId}/suspend`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ isSuspended: true, reason: "Self attempt" });
    expect(failedRes.status).toBe(409);

    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(disconnected).toBe(false);
    expect(tradingOutcome.client.connected).toBe(true);

    tradingOutcome.client.close();
  });
});
