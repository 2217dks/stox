const http = require("http");

const request = require("supertest");

const app = require("../../src/app");
const prisma = require("../../src/config/database");
const {
  configureEventBus,
  createInMemoryEventBus,
  resetEventBus,
} = require("../../src/realtime/eventBus");
const { startRealtimeBridge } = require("../../src/realtime/realtimeBridge");
const { createSocketServer } = require("../../src/sockets");
const portfolioService = require("../../src/services/portfolioService");
const tradeService = require("../../src/services/tradeService");
const marketDataService = require("../../src/services/marketData");
const { processPendingOrders } = require("../../src/workers/orderWorker");
const {
  collectEvents,
  connectSocket,
  emitWithAck,
  listen,
  sleep,
  waitForEvent,
} = require("../helpers/realtime");

const RUN_ID = Date.now().toString(36).toUpperCase().slice(-6);
let portfolioCounter = 0;

const credentialsFor = (label) => ({
  name: `Realtime ${label} User`,
  email: `realtime-${label}-${RUN_ID}@stox.local`,
  password: "TestPassword123!",
});

/**
 * End-to-end trading events:
 *
 *   HTTP order API / worker  ->  event bus  ->  Socket.IO /trading room
 *
 * Everything below drives the public API and asserts on the payloads a real
 * client receives. Room membership is proven by negative assertions against
 * sockets that did not join the portfolio.
 */
describe("Trading realtime events", () => {
  let server;
  let io;
  let bus;
  let bridge;
  let getQuoteSpy;
  let baseUrl;
  let primary;
  let sameUserOther;
  let neverJoined;
  let otherUser;
  let otherUserPortfolioId;

  beforeAll(async () => {
    jest.setTimeout(60000);

    getQuoteSpy = jest
      .spyOn(marketDataService, "getQuote")
      .mockResolvedValue({ price: "100" });

    server = http.createServer(app);
    ({ io } = createSocketServer(server));

    bus = createInMemoryEventBus();
    configureEventBus(bus);
    bridge = await startRealtimeBridge({ io, bus });

    const port = await listen(server);
    baseUrl = `http://127.0.0.1:${port}`;

    const primaryRegistration = await request(app)
      .post("/api/v1/auth/register")
      .send(credentialsFor("primary"));
    const otherRegistration = await request(app)
      .post("/api/v1/auth/register")
      .send(credentialsFor("secondary"));

    primary = {
      token: primaryRegistration.body.data.accessToken,
      userId: primaryRegistration.body.data.user.id,
    };
    otherUser = {
      token: otherRegistration.body.data.accessToken,
      userId: otherRegistration.body.data.user.id,
    };

    const otherPortfolio = await prisma.portfolio.findFirst({
      where: { userId: otherUser.userId, isDefault: true },
    });
    otherUserPortfolioId = otherPortfolio.id;

    const primaryClient = await connectSocket(baseUrl, "/trading", {
      auth: { token: primary.token },
    });
    const secondClient = await connectSocket(baseUrl, "/trading", {
      auth: { token: primary.token },
    });
    const unjoinedClient = await connectSocket(baseUrl, "/trading", {
      auth: { token: primary.token },
    });
    const otherClient = await connectSocket(baseUrl, "/trading", {
      auth: { token: otherUser.token },
    });

    primary.client = primaryClient;
    sameUserOther = secondClient;
    neverJoined = unjoinedClient;

    otherUser.client = otherClient;
    await join(otherUser.client, otherUserPortfolioId);
  });

  afterAll(async () => {
    // Stop accepting new socket connections and close the Socket.IO server.
    if (io) {
      await new Promise((resolve) => io.close(resolve));
    }

    // Stop the bridge and restore the default event bus.
    if (bridge) {
      bridge.stop();
    }

    resetEventBus();

    // Delete test users only after socket activity has stopped.
    for (const userId of [primary?.userId, otherUser?.userId]) {
      if (userId) {
        await prisma.user.delete({ where: { id: userId } });
      }
    }

    getQuoteSpy?.mockRestore();

    await prisma.$disconnect();
  });

  async function newPortfolio(label) {
    portfolioCounter += 1;

    const response = await request(app)
      .post("/api/v1/portfolios")
      .set("Authorization", `Bearer ${primary.token}`)
      .send({ name: `${label}-${RUN_ID}-${portfolioCounter}` });

    if (response.status !== 201) {
      console.error("Portfolio creation failed:", {
        label,
        status: response.status,
        body: response.body,
      });
    }

    expect(response.status).toBe(201);

    return response.body.data.portfolio.id;
  }

  async function join(client, portfolioId) {
    const ack = await emitWithAck(client, "join:portfolio", { portfolioId });

    expect(ack).toEqual({ ok: true, portfolioId });
  }

  async function leave(client, portfolioId) {
    const ack = await emitWithAck(client, "leave:portfolio", { portfolioId });

    expect(ack).toEqual({ ok: true, portfolioId });
  }

  async function placeOrder(overrides = {}) {
    return request(app)
      .post("/api/v1/orders")
      .set("Authorization", `Bearer ${primary.token}`)
      .send({
        portfolioId: overrides.portfolioId,
        symbol: "AAPL",
        assetType: "STOCK",
        side: "BUY",
        type: "MARKET",
        quantity: "1",
        ...overrides,
      });
  }

  async function getOrder(orderId) {
    return request(app)
      .get(`/api/v1/orders/${orderId}`)
      .set("Authorization", `Bearer ${primary.token}`);
  }

  async function runWorker(portfolioId, quotes) {
    const quoteProvider = {
      getQuote: jest.fn(async (symbol) => {
        const quote = quotes[symbol] ?? quotes.default;

        if (quote instanceof Error) {
          throw quote;
        }

        return { price: String(quote) };
      }),
    };

    const summary = await processPendingOrders({
      portfolioId,
      quoteProvider,
      maxAttempts: 1,
    });

    return { summary, quoteProvider };
  }

  function orderStatus(orderId) {
    return (payload) => payload.orderId === orderId;
  }

  function portfolioUpdate(portfolioId) {
    return (payload) => payload.portfolioId === portfolioId;
  }

  it("emits order-status PENDING with the placement payload when an order is created", async () => {
    const portfolioId = await newPortfolio("pending");
    await join(primary.client, portfolioId);

    const pending = waitForEvent(primary.client, "order-status", {
      predicate: portfolioUpdate(portfolioId),
    });

    const response = await placeOrder({
      portfolioId,
      symbol: " msft ",
      quantity: "1",
    });

    expect(response.status).toBe(201);

    const payload = await pending;

    expect(payload).toEqual({
      orderId: response.body.data.order.id,
      portfolioId,
      symbol: "MSFT",
      side: "BUY",
      type: "MARKET",
      status: "PENDING",
      quantity: "1",
      price: null,
      updatedAt: expect.any(String),
    });
    expect(Number.isNaN(Date.parse(payload.updatedAt))).toBe(false);
  });

  it("emits order-status EXECUTED, trade-executed, and portfolio-update on a fill", async () => {
    const portfolioId = await newPortfolio("fill");
    await join(primary.client, portfolioId);

    const placed = await placeOrder({
      portfolioId,
      symbol: "TSLA",
      quantity: "2",
    });

    if (placed.status !== 201) {
      console.error("TSLA order placement failed:", {
        status: placed.status,
        body: placed.body,
      });
    }

    expect(placed.status).toBe(201);

    const orderId = placed.body.data.order.id;

    const status = waitForEvent(primary.client, "order-status", {
      predicate: orderStatus(orderId),
    });
    const executed = waitForEvent(primary.client, "trade-executed", {
      predicate: orderStatus(orderId),
    });
    const update = waitForEvent(primary.client, "portfolio-update", {
      predicate: portfolioUpdate(portfolioId),
    });

    const { summary } = await runWorker(portfolioId, { TSLA: 100 });

    expect(summary.executed).toBe(1);

    await expect(status).resolves.toEqual({
      orderId,
      portfolioId,
      symbol: "TSLA",
      side: "BUY",
      type: "MARKET",
      status: "EXECUTED",
      quantity: "2",
      price: "100",
      updatedAt: expect.any(String),
    });

    const tradePayload = await executed;

    expect(tradePayload).toEqual({
      tradeId: expect.any(String),
      orderId,
      portfolioId,
      symbol: "TSLA",
      side: "BUY",
      quantity: "2",
      price: "100",
      totalValue: "200",
      realizedPnl: null,
      executedAt: expect.any(String),
    });
    expect(Number.isNaN(Date.parse(tradePayload.executedAt))).toBe(false);

    await expect(update).resolves.toEqual({
      portfolioId,
      cashBalance: "9800",
      holdingsValue: "200",
      totalValue: "10000",
      pnl: "0",
      asOf: expect.any(String),
    });

    const stored = await getOrder(orderId);

    expect(stored.status).toBe(200);
    expect(stored.body.data.order).toMatchObject({
      status: "EXECUTED",
      executedPrice: "100",
    });
  });

  it("still publishes the order and trade when portfolio valuation fails", async () => {
    const portfolioId = await newPortfolio("valuation-failure");
    await join(primary.client, portfolioId);

    const placed = await placeOrder({
      portfolioId,
      symbol: "ADBE",
      quantity: "1",
    });
    const orderId = placed.body.data.order.id;

    expect(placed.status).toBe(201);

    const status = waitForEvent(primary.client, "order-status", {
      predicate: (payload) =>
        payload.orderId === orderId && payload.status === "EXECUTED",
    });
    const executed = waitForEvent(primary.client, "trade-executed", {
      predicate: orderStatus(orderId),
    });
    const valuationFailure = jest
      .spyOn(portfolioService, "getPortfolioValuation")
      .mockRejectedValue(new Error("valuation query failed"));

    try {
      const { summary } = await runWorker(portfolioId, { ADBE: 100 });

      expect(summary.executed).toBe(1);

      await expect(status).resolves.toMatchObject({
        orderId,
        status: "EXECUTED",
        price: "100",
      });
      await expect(executed).resolves.toMatchObject({
        orderId,
        price: "100",
        totalValue: "100",
      });

      // The valuation is supplementary: it must not be broadcast, and it must
      // not turn the committed trade into an error.
      const updates = collectEvents(primary.client, "portfolio-update", 250);

      expect(await updates).toEqual([]);

      const stored = await getOrder(orderId);

      expect(stored.status).toBe(200);
      expect(stored.body.data.order).toMatchObject({
        status: "EXECUTED",
        executedPrice: "100",
      });
    } finally {
      valuationFailure.mockRestore();
    }
  });

  it("reports realized P&L and the updated valuation on a profitable sell", async () => {
    const portfolioId = await newPortfolio("sell");
    await join(primary.client, portfolioId);

    const buy = await placeOrder({
      portfolioId,
      symbol: "NVDA",
      quantity: "2",
    });
    const buyId = buy.body.data.order.id;

    const buyFilled = waitForEvent(primary.client, "order-status", {
      predicate: (payload) =>
        payload.orderId === buyId && payload.status === "EXECUTED",
    });

    await runWorker(portfolioId, { NVDA: 100 });
    await buyFilled;

    const sell = await placeOrder({
      portfolioId,
      symbol: "NVDA",
      side: "SELL",
      quantity: "2",
    });
    const sellId = sell.body.data.order.id;

    const executed = waitForEvent(primary.client, "trade-executed", {
      predicate: orderStatus(sellId),
    });
    const update = waitForEvent(primary.client, "portfolio-update", {
      predicate: portfolioUpdate(portfolioId),
    });

    await runWorker(portfolioId, { NVDA: 150 });

    await expect(executed).resolves.toMatchObject({
      orderId: sellId,
      side: "SELL",
      quantity: "2",
      price: "150",
      totalValue: "300",
      realizedPnl: "100",
    });

    await expect(update).resolves.toEqual({
      portfolioId,
      cashBalance: "10100",
      holdingsValue: "0",
      totalValue: "10100",
      pnl: "100",
      asOf: expect.any(String),
    });
  });

  it("reports a negative realized P&L and a loss-making valuation on a sell", async () => {
    const portfolioId = await newPortfolio("loss");
    await join(primary.client, portfolioId);

    const buy = await placeOrder({
      portfolioId,
      symbol: "PYPL",
      quantity: "2",
    });
    const buyId = buy.body.data.order.id;

    const buyFilled = waitForEvent(primary.client, "order-status", {
      predicate: (payload) =>
        payload.orderId === buyId && payload.status === "EXECUTED",
    });

    await runWorker(portfolioId, { PYPL: 100 });
    await buyFilled;

    const sell = await placeOrder({
      portfolioId,
      symbol: "PYPL",
      side: "SELL",
      quantity: "2",
    });
    const sellId = sell.body.data.order.id;

    const executed = waitForEvent(primary.client, "trade-executed", {
      predicate: orderStatus(sellId),
    });
    const update = waitForEvent(primary.client, "portfolio-update", {
      predicate: portfolioUpdate(portfolioId),
    });

    await runWorker(portfolioId, { PYPL: 80 });

    await expect(executed).resolves.toMatchObject({
      orderId: sellId,
      side: "SELL",
      totalValue: "160",
      realizedPnl: "-40",
    });

    await expect(update).resolves.toEqual({
      portfolioId,
      cashBalance: "9960",
      holdingsValue: "0",
      totalValue: "9960",
      pnl: "-40",
      asOf: expect.any(String),
    });
  });

  it("emits order-status CANCELLED when a pending order is cancelled", async () => {
    const portfolioId = await newPortfolio("cancel");
    await join(primary.client, portfolioId);

    const placed = await placeOrder({
      portfolioId,
      symbol: "AMD",
      type: "LIMIT",
      limitPrice: "50",
      quantity: "1",
    });
    const orderId = placed.body.data.order.id;

    const cancelled = waitForEvent(primary.client, "order-status", {
      predicate: orderStatus(orderId),
    });

    await request(app)
      .delete(`/api/v1/orders/${orderId}`)
      .set("Authorization", `Bearer ${primary.token}`)
      .expect(200);

    await expect(cancelled).resolves.toEqual({
      orderId,
      portfolioId,
      symbol: "AMD",
      side: "BUY",
      type: "LIMIT",
      status: "CANCELLED",
      quantity: "1",
      price: null,
      updatedAt: expect.any(String),
    });
  });

  it("emits order-status EXPIRED when the worker expires an order", async () => {
    const portfolioId = await newPortfolio("expire");
    await join(primary.client, portfolioId);

    const placed = await placeOrder({
      portfolioId,
      symbol: "AMZN",
      type: "LIMIT",
      limitPrice: "100",
      quantity: "1",
    });
    const orderId = placed.body.data.order.id;

    await prisma.order.update({
      where: { id: orderId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const expired = waitForEvent(primary.client, "order-status", {
      predicate: orderStatus(orderId),
    });
    const trade = collectEvents(primary.client, "trade-executed", 250);

    const { summary, quoteProvider } = await runWorker(portfolioId, {
      default: 100,
    });

    expect(summary.expired).toBe(1);
    // An expired order must never be priced.
    expect(quoteProvider.getQuote).not.toHaveBeenCalled();

    await expect(expired).resolves.toMatchObject({
      orderId,
      portfolioId,
      status: "EXPIRED",
      price: null,
    });

    expect(await trade).toEqual([]);

    const stored = await getOrder(orderId);

    expect(stored.body.data.order.status).toBe("EXPIRED");
  });

  it("emits order-status REJECTED when the portfolio cannot cover a sell", async () => {
    const portfolioId = await newPortfolio("reject-position");
    await join(primary.client, portfolioId);

    const placed = await placeOrder({
      portfolioId,
      symbol: "GOOG",
      side: "SELL",
      quantity: "1",
    });
    const orderId = placed.body.data.order.id;

    const rejected = waitForEvent(primary.client, "order-status", {
      predicate: orderStatus(orderId),
    });
    const trade = collectEvents(primary.client, "trade-executed", 250);

    const { summary } = await runWorker(portfolioId, { GOOG: 100 });

    expect(summary.rejected).toBe(1);

    await expect(rejected).resolves.toMatchObject({
      orderId,
      portfolioId,
      status: "REJECTED",
      price: null,
    });

    expect(await trade).toEqual([]);
    expect((await getOrder(orderId)).body.data.order.status).toBe("REJECTED");
  });

  it("emits order-status REJECTED when the provider reports a permanent error", async () => {
    const portfolioId = await newPortfolio("reject-provider");
    await join(primary.client, portfolioId);

    const placed = await placeOrder({
      portfolioId,
      symbol: "NFLX",
      quantity: "1",
    });
    const orderId = placed.body.data.order.id;

    const rejected = waitForEvent(primary.client, "order-status", {
      predicate: orderStatus(orderId),
    });

    const permanent = Object.assign(new Error("symbol not found"), {
      code: "MARKET_DATA_NOT_FOUND",
    });

    const { summary } = await runWorker(portfolioId, { default: permanent });

    expect(summary.rejected).toBe(1);

    await expect(rejected).resolves.toMatchObject({
      orderId,
      status: "REJECTED",
    });
    expect((await getOrder(orderId)).body.data.order.status).toBe("REJECTED");
  });

  it("emits order-status REJECTED when transient retries are exhausted", async () => {
    const portfolioId = await newPortfolio("reject-retry");
    await join(primary.client, portfolioId);

    const placed = await placeOrder({
      portfolioId,
      symbol: "SNAP",
      quantity: "1",
    });
    const orderId = placed.body.data.order.id;

    const rejected = waitForEvent(primary.client, "order-status", {
      predicate: orderStatus(orderId),
    });

    // A plain error has no permanent provider code, so the worker treats it as
    // retryable and the retry budget is what turns it into a rejection.
    const transient = new Error("provider timed out");

    const { summary } = await runWorker(portfolioId, { default: transient });

    expect(summary.rejected).toBe(1);

    await expect(rejected).resolves.toMatchObject({
      orderId,
      status: "REJECTED",
      price: null,
    });
    expect((await getOrder(orderId)).body.data.order.status).toBe("REJECTED");
  });

  it("publishes only one trade event when an executed order is executed again", async () => {
    const portfolioId = await newPortfolio("duplicate");
    await join(primary.client, portfolioId);

    const placed = await placeOrder({
      portfolioId,
      symbol: "DIS",
      quantity: "1",
    });
    const orderId = placed.body.data.order.id;

    const trades = collectEvents(primary.client, "trade-executed", 400);

    await runWorker(portfolioId, { DIS: 100 });

    await expect(
      tradeService.executeOrder(orderId, "200"),
    ).rejects.toMatchObject({ code: "ORDER_NOT_EXECUTABLE" });

    await sleep(100);

    const received = await trades;

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      orderId,
      price: "100",
      totalValue: "100",
    });
  });

  it("keeps events inside the portfolio room for sockets of the same user", async () => {
    const portfolioId = await newPortfolio("room-same-user");
    const otherPortfolioId = await newPortfolio("room-same-user-other");

    await join(primary.client, portfolioId);
    await join(sameUserOther, otherPortfolioId);

    const received = waitForEvent(primary.client, "order-status", {
      predicate: portfolioUpdate(portfolioId),
    });
    const leaked = collectEvents(sameUserOther, "order-status", 300);

    const placed = await placeOrder({ portfolioId, symbol: "META" });

    await expect(received).resolves.toMatchObject({
      orderId: placed.body.data.order.id,
      portfolioId,
    });
    expect(await leaked).toEqual([]);
  });

  it("does not deliver one user's portfolio events to another user", async () => {
    const portfolioId = await newPortfolio("room-other-user");
    await join(primary.client, portfolioId);

    const received = waitForEvent(primary.client, "order-status", {
      predicate: portfolioUpdate(portfolioId),
    });
    const leaked = collectEvents(otherUser.client, "order-status", 300);

    const placed = await placeOrder({ portfolioId, symbol: "IBM" });

    await expect(received).resolves.toMatchObject({
      orderId: placed.body.data.order.id,
    });
    expect(await leaked).toEqual([]);
    expect(otherUserPortfolioId).not.toBe(portfolioId);
  });

  it("does not deliver portfolio events to a socket that never joined the room", async () => {
    const portfolioId = await newPortfolio("room-unjoined");
    await join(primary.client, portfolioId);

    const received = waitForEvent(primary.client, "order-status", {
      predicate: portfolioUpdate(portfolioId),
    });
    const leaked = collectEvents(neverJoined, "order-status", 300);

    await placeOrder({ portfolioId, symbol: "ORCL" });

    await expect(received).resolves.toBeDefined();
    expect(await leaked).toEqual([]);
  });

  it("stops delivering events after a socket leaves the portfolio room", async () => {
    const portfolioId = await newPortfolio("leave");
    await join(sameUserOther, portfolioId);

    const beforeLeaving = waitForEvent(sameUserOther, "order-status", {
      predicate: portfolioUpdate(portfolioId),
    });

    await placeOrder({ portfolioId, symbol: "CRM" });
    await expect(beforeLeaving).resolves.toBeDefined();

    await leave(sameUserOther, portfolioId);

    const afterLeaving = collectEvents(sameUserOther, "order-status", 300);

    await placeOrder({ portfolioId, symbol: "CRM" });

    expect(await afterLeaving).toEqual([]);
  });

  it("delivers the same event to every socket in the portfolio room", async () => {
    const portfolioId = await newPortfolio("multi-socket");
    await join(primary.client, portfolioId);
    await join(sameUserOther, portfolioId);

    const first = waitForEvent(primary.client, "order-status", {
      predicate: portfolioUpdate(portfolioId),
    });
    const second = waitForEvent(sameUserOther, "order-status", {
      predicate: portfolioUpdate(portfolioId),
    });

    const placed = await placeOrder({ portfolioId, symbol: "SHOP" });
    const orderId = placed.body.data.order.id;

    await expect(first).resolves.toMatchObject({ orderId });
    await expect(second).resolves.toMatchObject({ orderId });
  });

  it("keeps order placement, execution, and persistence working when the bus fails", async () => {
    const portfolioId = await newPortfolio("bus-failure");
    await join(primary.client, portfolioId);

    configureEventBus({
      publish: jest.fn().mockRejectedValue(new Error("redis unavailable")),
    });

    try {
      const placed = await placeOrder({
        portfolioId,
        symbol: "UBER",
        quantity: "1",
      });

      expect(placed.status).toBe(201);

      const { summary } = await runWorker(portfolioId, { UBER: 50 });

      expect(summary.executed).toBe(1);

      const stored = await getOrder(placed.body.data.order.id);

      expect(stored.body.data.order).toMatchObject({
        status: "EXECUTED",
        executedPrice: "50",
      });
    } finally {
      configureEventBus(bus);
    }
  });

  it("keeps the financial path working with no event bus configured", async () => {
    const portfolioId = await newPortfolio("no-bus");
    await join(primary.client, portfolioId);

    resetEventBus();

    try {
      const placed = await placeOrder({
        portfolioId,
        symbol: "ABNB",
        quantity: "1",
      });

      expect(placed.status).toBe(201);

      const { summary } = await runWorker(portfolioId, { ABNB: 25 });

      expect(summary.executed).toBe(1);

      const stored = await getOrder(placed.body.data.order.id);

      expect(stored.body.data.order).toMatchObject({
        status: "EXECUTED",
        executedPrice: "25",
      });
    } finally {
      configureEventBus(bus);
    }
  });
});
