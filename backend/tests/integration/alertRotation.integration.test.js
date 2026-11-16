const prisma = require("../../src/config/database");
const { ALERT_JOB_NAMES } = require("../../src/queues/definitions");
const { handleAlertJob } = require("../../src/workers/alertQueueWorker");

// A scan only covers `maxSymbols` distinct symbols. The rotation cursor must
// advance for every attempted group, including a group whose quote request
// fails transiently; otherwise the next scan selects the same failing groups
// again and the deferred symbols never get a turn.

const runId = `${Date.now()}-${process.pid}`;
const symbolLabels = ["A", "B", "C", "D"];

let userId;
let symbols = [];
let alerts = [];
let parkedAlerts = [];

async function loadAlert(id) {
  return prisma.alert.findUnique({ where: { id } });
}

beforeAll(async () => {
  jest.setTimeout(20000);

  const user = await prisma.user.create({
    data: {
      name: "Alert Rotation User",
      email: `alert-rotation-${runId}@stox.local`,
    },
  });

  userId = user.id;

  symbols = [];

  for (const label of symbolLabels) {
    symbols.push(
      await prisma.symbol.create({
        data: {
          symbol: `AROT${runId}${label}`.toUpperCase(),
          name: `Alert Rotation ${label}`,
          assetType: "STOCK",
          exchange: "TEST",
        },
      }),
    );
  }

  // Other suites clean up after themselves, but a developer's local database
  // may still contain ACTIVE alerts. Park their cursor in the future so this
  // suite's four null-cursor alerts are deterministically selected first.
  const otherActiveAlerts = await prisma.alert.findMany({
    where: { status: "ACTIVE" },
  });

  parkedAlerts = otherActiveAlerts
    .filter((alert) => alert.userId !== userId)
    .map((alert) => ({
      id: alert.id,
      lastEvaluatedAt: alert.lastEvaluatedAt,
    }));

  if (parkedAlerts.length > 0) {
    await prisma.alert.updateMany({
      where: { id: { in: parkedAlerts.map((alert) => alert.id) } },
      data: { lastEvaluatedAt: new Date(Date.now() + 24 * 60 * 60 * 1000) },
    });
  }

  alerts = await Promise.all(
    symbols.map((symbol, index) =>
      prisma.alert.create({
        data: {
          userId,
          symbolId: symbol.id,
          condition: "PRICE_ABOVE",
          targetPrice: "200",
          sendEmail: true,
          sendPush: false,
          // Distinct creation times make the null-cursor order deterministic.
          createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)),
        },
      }),
    ),
  );
});

afterAll(async () => {
  try {
    if (parkedAlerts.length > 0) {
      await Promise.all(
        parkedAlerts.map((alert) =>
          prisma.alert.updateMany({
            where: { id: alert.id },
            data: { lastEvaluatedAt: alert.lastEvaluatedAt },
          }),
        ),
      );
    }

    if (userId) {
      await prisma.user.deleteMany({ where: { id: userId } });
    }

    if (symbols.length > 0) {
      await prisma.symbol.deleteMany({
        where: { id: { in: symbols.map((symbol) => symbol.id) } },
      });
    }
  } finally {
    await prisma.$disconnect();
  }
});

describe("Alert scan rotation", () => {
  test("a transient quote failure cannot starve the deferred symbols", async () => {
    const firstScanAt = new Date("2026-01-01T00:00:00.000Z");
    const secondScanAt = new Date("2026-01-01T00:01:00.000Z");
    const thirdScanAt = new Date("2026-01-01T00:02:00.000Z");

    const [symbolA, symbolB, symbolC, symbolD] = symbols;
    const [alertA, alertB, alertC, alertD] = alerts;

    const failingSymbols = new Set([symbolA.symbol, symbolB.symbol]);

    const quoteProvider = {
      getQuote: jest.fn(async (symbol) => {
        if (failingSymbols.has(symbol)) {
          throw Object.assign(new Error("provider unavailable"), {
            code: "MARKET_DATA_PROVIDER_UNAVAILABLE",
          });
        }

        return { price: "150" };
      }),
    };

    const scan = (now) =>
      handleAlertJob(
        {
          name: ALERT_JOB_NAMES.SCAN_ALERTS,
          data: { limit: 4 },
        },
        { quoteProvider, maxSymbols: 2, now: () => now },
      );

    // Scan 1: A and B are attempted and both fail transiently.
    const first = await scan(firstScanAt);

    expect(first).toMatchObject({
      scanned: 2,
      symbolsScanned: 2,
      symbolsDeferred: 2,
      errors: 2,
      triggered: 0,
    });

    const [firstA, firstB, firstC, firstD] = await Promise.all(
      [alertA, alertB, alertC, alertD].map((alert) => loadAlert(alert.id)),
    );

    expect(firstA.lastEvaluatedAt).toEqual(firstScanAt);
    expect(firstB.lastEvaluatedAt).toEqual(firstScanAt);
    expect(firstC.lastEvaluatedAt).toBeNull();
    expect(firstD.lastEvaluatedAt).toBeNull();
    expect([firstA.status, firstB.status, firstC.status, firstD.status]).toEqual(
      ["ACTIVE", "ACTIVE", "ACTIVE", "ACTIVE"],
    );

    // Scan 2: the failed groups are not selected again; C and D get a turn.
    const second = await scan(secondScanAt);

    expect(second).toMatchObject({
      scanned: 2,
      symbolsScanned: 2,
      symbolsDeferred: 2,
      notTriggered: 2,
      errors: 0,
    });

    const [secondA, secondB, secondC, secondD] = await Promise.all(
      [alertA, alertB, alertC, alertD].map((alert) => loadAlert(alert.id)),
    );

    expect(secondA.lastEvaluatedAt).toEqual(firstScanAt);
    expect(secondB.lastEvaluatedAt).toEqual(firstScanAt);
    expect(secondC.lastEvaluatedAt).toEqual(secondScanAt);
    expect(secondD.lastEvaluatedAt).toEqual(secondScanAt);

    // Scan 3: the provider has recovered. A and B are the oldest attempts
    // again, stay eligible, and now evaluate successfully.
    failingSymbols.clear();
    quoteProvider.getQuote.mockImplementation(async () => ({ price: "210" }));

    const third = await scan(thirdScanAt);

    expect(third).toMatchObject({
      scanned: 2,
      symbolsScanned: 2,
      symbolsDeferred: 2,
      triggered: 2,
      errors: 0,
    });

    const [thirdA, thirdB, thirdC, thirdD] = await Promise.all(
      [alertA, alertB, alertC, alertD].map((alert) => loadAlert(alert.id)),
    );

    expect(thirdA.status).toBe("TRIGGERED");
    expect(thirdB.status).toBe("TRIGGERED");
    expect(thirdA.lastEvaluatedAt).toEqual(thirdScanAt);
    expect(thirdB.lastEvaluatedAt).toEqual(thirdScanAt);

    expect(thirdC.status).toBe("ACTIVE");
    expect(thirdD.status).toBe("ACTIVE");
    expect(thirdC.lastEvaluatedAt).toEqual(secondScanAt);
    expect(thirdD.lastEvaluatedAt).toEqual(secondScanAt);

    expect(
      await prisma.notification.count({
        where: { userId, type: "PRICE_ALERT" },
      }),
    ).toBe(2);
  });
});
