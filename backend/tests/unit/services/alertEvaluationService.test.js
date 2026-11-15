jest.mock("../../../src/config/database", () => ({
  alert: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    updateMany: jest.fn(),
  },
  notification: {
    create: jest.fn(),
  },
  $transaction: jest.fn(),
}));

jest.mock("../../../src/queues/notificationQueue", () => ({
  enqueueNotificationDelivery: jest.fn(async () => ({ enqueued: true })),
}));

const { Prisma } = require("@prisma/client");
const prisma = require("../../../src/config/database");
const {
  enqueueNotificationDelivery,
} = require("../../../src/queues/notificationQueue");
const {
  buildNotificationData,
  evaluateAlertById,
  evaluateAlertWithQuote,
  evaluateCondition,
  scanActiveAlerts,
  triggerAlert,
} = require("../../../src/services/alertEvaluationService");

const ALERT_ID = "8a2e6b4d-1c3f-4d5e-9a7b-0c1d2e3f4a5b";
const USER_ID = "3f1b2c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";

function makeAlert(overrides = {}) {
  return {
    id: ALERT_ID,
    userId: USER_ID,
    condition: "PRICE_ABOVE",
    targetPrice: new Prisma.Decimal("200"),
    baselinePrice: null,
    baselineAt: null,
    status: "ACTIVE",
    sendEmail: true,
    sendPush: false,
    symbol: { symbol: "AAPL", assetType: "STOCK" },
    ...overrides,
  };
}

function makeQuote(price) {
  return { symbol: "AAPL", price: String(price) };
}

describe("alert evaluation service", () => {
  let tx;

  beforeEach(() => {
    jest.clearAllMocks();

    tx = {
      alert: { updateMany: jest.fn(async () => ({ count: 1 })) },
      notification: {
        create: jest.fn(async ({ data }) => ({ id: "notification-1", ...data })),
      },
    };
    prisma.$transaction.mockImplementation(async (callback) => callback(tx));
  });

  describe("evaluateCondition", () => {
    test("PRICE_ABOVE is inclusive at the boundary", () => {
      expect(evaluateCondition(makeAlert(), makeQuote("200")).triggered).toBe(
        true,
      );
      expect(evaluateCondition(makeAlert(), makeQuote("199.99")).triggered).toBe(
        false,
      );
    });

    test("PRICE_BELOW is inclusive at the boundary", () => {
      const alert = makeAlert({ condition: "PRICE_BELOW" });

      expect(evaluateCondition(alert, makeQuote("200")).triggered).toBe(true);
      expect(evaluateCondition(alert, makeQuote("200.01")).triggered).toBe(
        false,
      );
    });

    test("PERCENT_CHANGE_UP compares against the stored baseline", () => {
      const alert = makeAlert({
        condition: "PERCENT_CHANGE_UP",
        targetPrice: new Prisma.Decimal("5"),
        baselinePrice: new Prisma.Decimal("100"),
      });

      expect(evaluateCondition(alert, makeQuote("105")).triggered).toBe(true);
      expect(evaluateCondition(alert, makeQuote("104.99")).triggered).toBe(
        false,
      );
    });

    test("PERCENT_CHANGE_DOWN triggers at the negative threshold", () => {
      const alert = makeAlert({
        condition: "PERCENT_CHANGE_DOWN",
        targetPrice: new Prisma.Decimal("5"),
        baselinePrice: new Prisma.Decimal("100"),
      });

      expect(evaluateCondition(alert, makeQuote("95")).triggered).toBe(true);
      expect(evaluateCondition(alert, makeQuote("95.01")).triggered).toBe(
        false,
      );
    });

    test("a percentage alert without a baseline is invalid", () => {
      const result = evaluateCondition(
        makeAlert({
          condition: "PERCENT_CHANGE_UP",
          targetPrice: new Prisma.Decimal("5"),
        }),
        makeQuote("105"),
      );

      expect(result).toMatchObject({
        triggered: false,
        invalid: true,
        reason: "NO_BASELINE",
      });
    });
  });

  test("captures a baseline for a legacy percentage alert on first evaluation", async () => {
    prisma.alert.updateMany.mockResolvedValue({ count: 1 });

    const alert = makeAlert({
      condition: "PERCENT_CHANGE_UP",
      targetPrice: new Prisma.Decimal("5"),
      baselinePrice: null,
    });

    const result = await evaluateAlertWithQuote(alert, makeQuote("100"));

    expect(result).toEqual({
      outcome: "baseline_captured",
      alertId: ALERT_ID,
      captured: true,
      price: "100",
    });
    expect(prisma.alert.updateMany).toHaveBeenCalledWith({
      where: { id: ALERT_ID, status: "ACTIVE", baselinePrice: null },
      data: { baselinePrice: "100", baselineAt: expect.any(Date) },
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  test("does not evaluate an alert that is no longer ACTIVE", async () => {
    const result = await evaluateAlertWithQuote(
      makeAlert({ status: "TRIGGERED" }),
      makeQuote("210"),
    );

    expect(result).toEqual({ outcome: "skipped", status: "TRIGGERED" });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  test("claims the alert and creates one notification when triggered", async () => {
    const alert = makeAlert();
    const quote = makeQuote("210");

    const result = await triggerAlert(
      alert,
      quote,
      evaluateCondition(alert, quote),
      { now: () => new Date("2026-01-01T00:00:00.000Z") },
    );

    expect(tx.alert.updateMany).toHaveBeenCalledWith({
      where: { id: ALERT_ID, status: "ACTIVE" },
      data: {
        status: "TRIGGERED",
        triggeredAt: new Date("2026-01-01T00:00:00.000Z"),
        message: expect.stringContaining("AAPL"),
      },
    });
    expect(tx.notification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: USER_ID,
        type: "PRICE_ALERT",
        title: "Price alert: AAPL",
        data: expect.objectContaining({
          alertId: ALERT_ID,
          symbol: "AAPL",
          currentPrice: "210",
          channels: { email: true, push: false },
        }),
      }),
    });
    expect(enqueueNotificationDelivery).toHaveBeenCalledWith({
      notificationId: "notification-1",
    });
    expect(result).toMatchObject({
      outcome: "triggered",
      alertId: ALERT_ID,
      notificationId: "notification-1",
    });
  });

  test("does not create a second notification when another worker won", async () => {
    tx.alert.updateMany.mockResolvedValue({ count: 0 });

    const alert = makeAlert();
    const quote = makeQuote("210");

    const result = await triggerAlert(
      alert,
      quote,
      evaluateCondition(alert, quote),
    );

    expect(result).toEqual({
      outcome: "skipped",
      reason: "ALREADY_TRIGGERED",
    });
    expect(tx.notification.create).not.toHaveBeenCalled();
    expect(enqueueNotificationDelivery).not.toHaveBeenCalled();
  });

  test("reports a missing alert without fetching a quote", async () => {
    prisma.alert.findUnique.mockResolvedValue(null);
    const quoteProvider = { getQuote: jest.fn() };

    await expect(
      evaluateAlertById(ALERT_ID, { quoteProvider }),
    ).resolves.toEqual({ outcome: "not_found", alertId: ALERT_ID });
    expect(quoteProvider.getQuote).not.toHaveBeenCalled();
  });

  test("fetches one quote per symbol and isolates provider failures", async () => {
    const apple = makeAlert({ id: "alert-apple" });
    const tesla = makeAlert({
      id: "alert-tesla",
      symbol: { symbol: "TSLA", assetType: "STOCK" },
      targetPrice: new Prisma.Decimal("300"),
    });
    const broken = makeAlert({
      id: "alert-broken",
      symbol: { symbol: "BROKEN", assetType: "STOCK" },
    });

    prisma.alert.findMany.mockResolvedValue([apple, tesla, broken]);

    const quoteProvider = {
      getQuote: jest.fn(async (symbol) => {
        if (symbol === "BROKEN") {
          throw Object.assign(new Error("unavailable"), {
            code: "MARKET_DATA_PROVIDER_UNAVAILABLE",
          });
        }

        return makeQuote(symbol === "AAPL" ? "210" : "250");
      }),
    };

    const result = await scanActiveAlerts({ limit: 10 }, { quoteProvider });

    expect(quoteProvider.getQuote).toHaveBeenCalledTimes(3);
    expect(result).toMatchObject({
      scanned: 3,
      triggered: 1,
      notTriggered: 1,
      errors: 1,
    });
    expect(result.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          outcome: "error",
          alertId: "alert-broken",
          reason: "MARKET_DATA_PROVIDER_UNAVAILABLE",
        }),
      ]),
    );
  });

  test("builds alert notification data with the request-time baseline", () => {
    const alert = makeAlert({
      condition: "PERCENT_CHANGE_UP",
      targetPrice: new Prisma.Decimal("5"),
      baselinePrice: new Prisma.Decimal("190.25"),
    });

    expect(
      buildNotificationData(alert, makeQuote("200")),
    ).toEqual({
      alertId: ALERT_ID,
      symbol: "AAPL",
      condition: "PERCENT_CHANGE_UP",
      targetPrice: "5",
      currentPrice: "200",
      baselinePrice: "190.25",
      channels: { email: true, push: false },
    });
  });

  test("expires an alert on a permanent provider error instead of retrying", async () => {
    const alert = makeAlert({
      id: "alert-delisted",
      symbol: { symbol: "DELISTED", assetType: "STOCK" },
    });
    prisma.alert.findMany.mockResolvedValue([alert]);
    prisma.alert.updateMany.mockResolvedValue({ count: 1 });

    const quoteProvider = {
      getQuote: jest.fn(async () => {
        throw Object.assign(new Error("not found"), {
          code: "MARKET_DATA_NOT_FOUND",
          statusCode: 404,
        });
      }),
    };

    const result = await scanActiveAlerts({}, { quoteProvider });

    expect(result).toMatchObject({
      scanned: 1,
      expired: 1,
      errors: 0,
    });
    expect(prisma.alert.updateMany).toHaveBeenCalledWith({
      where: {
        id: { in: ["alert-delisted"] },
        status: "ACTIVE",
      },
      data: {
        status: "EXPIRED",
        message: expect.stringContaining("MARKET_DATA_NOT_FOUND"),
      },
    });
  });

  test("caps the symbols per scan and defers the rest", async () => {
    const alerts = ["AAA", "BBB", "CCC"].map((symbol, index) =>
      makeAlert({
        id: `alert-${index}`,
        symbol: { symbol, assetType: "STOCK" },
      }),
    );
    prisma.alert.findMany.mockResolvedValue(alerts);

    const quoteProvider = {
      getQuote: jest.fn(async () => ({ price: "100" })),
    };

    const result = await scanActiveAlerts(
      { maxSymbols: 2 },
      { quoteProvider },
    );

    expect(quoteProvider.getQuote).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      scanned: 2,
      symbolsScanned: 2,
      symbolsDeferred: 1,
    });
    expect(prisma.alert.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: expect.arrayContaining([
          { lastEvaluatedAt: { sort: "asc", nulls: "first" } },
        ]),
      }),
    );
  });
});
