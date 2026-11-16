jest.mock("../../../src/config/database", () => ({
  user: { findUnique: jest.fn() },
  symbol: { findUnique: jest.fn() },
  alert: {
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
}));

jest.mock("../../../src/services/marketData", () => ({
  getQuote: jest.fn(),
}));

const prisma = require("../../../src/config/database");
const marketData = require("../../../src/services/marketData");
const {
  createAlert,
  updateAlert,
  serializeAlert,
} = require("../../../src/services/alertService");

const USER_ID = "3f1b2c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const ALERT_ID = "8a2e6b4d-1c3f-4d5e-9a7b-0c1d2e3f4a5b";
const SYMBOL_ID = "0b6d5a1c-2f3e-4a5b-8c9d-1e2f3a4b5c6d";

const symbolRecord = {
  id: SYMBOL_ID,
  symbol: "AAPL",
  assetType: "STOCK",
  isActive: true,
};

function makeStoredAlert(overrides = {}) {
  return {
    id: ALERT_ID,
    userId: USER_ID,
    symbolId: SYMBOL_ID,
    condition: "PRICE_ABOVE",
    targetPrice: "250.5",
    status: "ACTIVE",
    sendEmail: true,
    sendPush: false,
    triggeredAt: null,
    message: null,
    baselinePrice: null,
    baselineAt: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    symbol: symbolRecord,
    ...overrides,
  };
}

describe("alert service percentage baselines", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    prisma.user.findUnique.mockResolvedValue({
      id: USER_ID,
      isSuspended: false,
    });
    prisma.symbol.findUnique.mockResolvedValue(symbolRecord);

    prisma.alert.create.mockImplementation(async ({ data }) =>
      makeStoredAlert({ ...data, symbol: symbolRecord }),
    );
    prisma.alert.update.mockImplementation(async ({ data }) =>
      makeStoredAlert({ ...data, symbol: symbolRecord }),
    );
  });

  test("does not fetch a quote for an absolute price alert", async () => {
    const alert = await createAlert(USER_ID, {
      symbol: "AAPL",
      assetType: "STOCK",
      condition: "PRICE_ABOVE",
      targetPrice: "250.5",
      sendEmail: true,
      sendPush: false,
    });

    expect(marketData.getQuote).not.toHaveBeenCalled();
    expect(alert.baselinePrice).toBeNull();
    expect(alert.baselineAt).toBeNull();
  });

  test("captures the request-time price as the baseline for a percentage alert", async () => {
    marketData.getQuote.mockResolvedValue({ symbol: "AAPL", price: "190.25" });

    const alert = await createAlert(USER_ID, {
      symbol: "AAPL",
      assetType: "STOCK",
      condition: "PERCENT_CHANGE_UP",
      targetPrice: "5",
      sendEmail: true,
      sendPush: false,
    });

    expect(marketData.getQuote).toHaveBeenCalledWith("AAPL", {
      assetClass: "STOCK",
    });
    expect(alert.baselinePrice).toBe("190.25");
    expect(alert.baselineAt).toBeInstanceOf(Date);

    expect(prisma.alert.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          baselinePrice: "190.25",
          baselineAt: expect.any(Date),
        }),
      }),
    );
  });

  test("fails the request instead of creating an alert with an unknown baseline", async () => {
    marketData.getQuote.mockRejectedValue(
      Object.assign(new Error("provider unavailable"), {
        statusCode: 503,
        code: "MARKET_DATA_PROVIDER_UNAVAILABLE",
        isOperational: true,
      }),
    );

    await expect(
      createAlert(USER_ID, {
        symbol: "AAPL",
        assetType: "STOCK",
        condition: "PERCENT_CHANGE_DOWN",
        targetPrice: "5",
        sendEmail: true,
        sendPush: false,
      }),
    ).rejects.toMatchObject({
      code: "MARKET_DATA_PROVIDER_UNAVAILABLE",
      statusCode: 503,
    });

    expect(prisma.alert.create).not.toHaveBeenCalled();
  });

  test("captures a baseline when an alert is switched to a percentage condition", async () => {
    prisma.alert.findFirst.mockResolvedValue(
      makeStoredAlert({ condition: "PRICE_ABOVE" }),
    );
    marketData.getQuote.mockResolvedValue({ symbol: "AAPL", price: "200" });

    const alert = await updateAlert(USER_ID, ALERT_ID, {
      condition: "PERCENT_CHANGE_UP",
      targetPrice: "5",
    });

    expect(marketData.getQuote).toHaveBeenCalledTimes(1);
    expect(alert.baselinePrice).toBe("200");
    expect(alert.baselineAt).toBeInstanceOf(Date);
  });

  test("clears the baseline when an alert leaves a percentage condition", async () => {
    prisma.alert.findFirst.mockResolvedValue(
      makeStoredAlert({
        condition: "PERCENT_CHANGE_UP",
        targetPrice: "5",
        baselinePrice: "190.25",
        baselineAt: new Date("2026-01-01T00:00:00.000Z"),
      }),
    );

    const alert = await updateAlert(USER_ID, ALERT_ID, {
      condition: "PRICE_ABOVE",
      targetPrice: "250",
    });

    expect(marketData.getQuote).not.toHaveBeenCalled();
    expect(alert.baselinePrice).toBeNull();
    expect(alert.baselineAt).toBeNull();
  });

  test("re-arms a percentage alert with a fresh baseline", async () => {
    prisma.alert.findFirst.mockResolvedValue(
      makeStoredAlert({
        condition: "PERCENT_CHANGE_UP",
        targetPrice: "5",
        status: "TRIGGERED",
        baselinePrice: "190.25",
        baselineAt: new Date("2026-01-01T00:00:00.000Z"),
      }),
    );
    marketData.getQuote.mockResolvedValue({ symbol: "AAPL", price: "210" });

    const alert = await updateAlert(USER_ID, ALERT_ID, { status: "ACTIVE" });

    expect(marketData.getQuote).toHaveBeenCalledTimes(1);
    expect(alert.baselinePrice).toBe("210");
    expect(alert.baselineAt).toBeInstanceOf(Date);
  });

  test("serializes baseline fields as decimal strings", () => {
    const serialized = serializeAlert(
      makeStoredAlert({
        condition: "PERCENT_CHANGE_UP",
        baselinePrice: { toString: () => "190.25" },
        baselineAt: new Date("2026-01-01T00:00:00.000Z"),
      }),
    );

    expect(serialized.baselinePrice).toBe("190.25");
    expect(serialized.baselineAt).toEqual(new Date("2026-01-01T00:00:00.000Z"));
  });
});
