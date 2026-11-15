const prisma = require("../../src/config/database");
const { getMonthlyTradeStatistics } = require("../../src/services/userStatisticsService");
const { getPortfolioMonthlyPerformance } = require("../../src/services/portfolioMonthlyService");
const { upsertSnapshot } = require("../../src/services/portfolioSnapshotRepository");

describe("Analytics SQL Timezone Safety Regression Tests", () => {
  const timestamp = Date.now();
  let testUser;
  let testPortfolio;

  beforeAll(async () => {
    // 1. Create a user and portfolio
    testUser = await prisma.user.create({
      data: {
        email: `tz-test-${timestamp}@example.com`,
        passwordHash: "dummyHashForTest#2026",
        name: "Timezone Test User",
      },
    });

    testPortfolio = await prisma.portfolio.create({
      data: {
        userId: testUser.id,
        name: "Timezone Boundary Portfolio",
        isDefault: true,
      },
    });

    // 2. Create orders and trades around UTC month boundaries:
    // Trade 1: 2026-01-31T23:50:00.000Z (UTC Jan 31 -> 2026-01; in America/Los_Angeles it is Jan 31 15:50)
    // Trade 2: 2026-02-01T01:15:00.000Z (UTC Feb 01 -> 2026-02; in America/Los_Angeles it is Jan 31 17:15)
    // Trade 3: 2026-02-28T23:55:00.000Z (UTC Feb 28 -> 2026-02; in America/Los_Angeles it is Feb 28 15:55)
    // Trade 4: 2026-03-01T02:00:00.000Z (UTC Mar 01 -> 2026-03; in America/Los_Angeles it is Feb 28 18:00)
    const tradeData = [
      {
        executedAt: new Date("2026-01-31T23:50:00.000Z"),
        realizedPnl: "100.00000000",
        realizedPnlPct: "10.0000",
        totalValue: "1000.00000000",
      },
      {
        executedAt: new Date("2026-02-01T01:15:00.000Z"),
        realizedPnl: "200.00000000",
        realizedPnlPct: "20.0000",
        totalValue: "1000.00000000",
      },
      {
        executedAt: new Date("2026-02-28T23:55:00.000Z"),
        realizedPnl: "300.00000000",
        realizedPnlPct: "15.0000",
        totalValue: "2000.00000000",
      },
      {
        executedAt: new Date("2026-03-01T02:00:00.000Z"),
        realizedPnl: "400.00000000",
        realizedPnlPct: "25.0000",
        totalValue: "1600.00000000",
      },
    ];

    for (let i = 0; i < tradeData.length; i++) {
      const order = await prisma.order.create({
        data: {
          portfolioId: testPortfolio.id,
          symbol: "AAPL",
          assetType: "STOCK",
          side: "SELL",
          type: "MARKET",
          status: "EXECUTED",
          quantity: "10",
          executedPrice: "100",
          executedAt: tradeData[i].executedAt,
        },
      });

      await prisma.trade.create({
        data: {
          portfolioId: testPortfolio.id,
          orderId: order.id,
          symbol: "AAPL",
          assetType: "STOCK",
          side: "SELL",
          quantity: "10",
          price: "100",
          totalValue: tradeData[i].totalValue,
          realizedPnl: tradeData[i].realizedPnl,
          realizedPnlPct: tradeData[i].realizedPnlPct,
          executedAt: tradeData[i].executedAt,
        },
      });
    }

    // 3. Add monthly performance snapshots
    await upsertSnapshot(prisma, {
      portfolioId: testPortfolio.id,
      snapshotDate: new Date("2026-01-31T00:00:00.000Z"),
      totalValue: "10000.00000000",
      cashBalance: "10000.00000000",
      holdingsValue: "0.00000000",
      dailyPnl: "0.00000000",
      dailyPnlPct: "0.0000",
    });
    await upsertSnapshot(prisma, {
      portfolioId: testPortfolio.id,
      snapshotDate: new Date("2026-02-28T00:00:00.000Z"),
      totalValue: "10500.00000000",
      cashBalance: "10000.00000000",
      holdingsValue: "500.00000000",
      dailyPnl: "500.00000000",
      dailyPnlPct: "5.0000",
    });
    await upsertSnapshot(prisma, {
      portfolioId: testPortfolio.id,
      snapshotDate: new Date("2026-03-31T00:00:00.000Z"),
      totalValue: "11000.00000000",
      cashBalance: "10000.00000000",
      holdingsValue: "1000.00000000",
      dailyPnl: "500.00000000",
      dailyPnlPct: "4.7619",
    });
  });

  afterEach(async () => {
    // ALWAYS reset session timezone to UTC after each test, even if test failed
    try {
      await prisma.$executeRawUnsafe(`SET TimeZone = 'UTC'`);
    } catch {
      // ignore
    }
  });

  afterAll(async () => {
    try {
      await prisma.$executeRawUnsafe(`SET TimeZone = 'UTC'`);
    } catch {
      // ignore
    }
    await prisma.$disconnect();
  });

  test("getMonthlyTradeStatistics produces identical UTC month grouping across UTC and America/Los_Angeles session timezones", async () => {
    let utcStats;
    let laStats;

    // Run under UTC session TimeZone
    try {
      await prisma.$executeRawUnsafe(`SET TimeZone = 'UTC'`);
      utcStats = await getMonthlyTradeStatistics(testUser.id, { portfolioId: testPortfolio.id });
    } finally {
      await prisma.$executeRawUnsafe(`SET TimeZone = 'UTC'`);
    }

    // Run under America/Los_Angeles session TimeZone (UTC-8)
    try {
      await prisma.$executeRawUnsafe(`SET TimeZone = 'America/Los_Angeles'`);
      laStats = await getMonthlyTradeStatistics(testUser.id, { portfolioId: testPortfolio.id });
    } finally {
      await prisma.$executeRawUnsafe(`SET TimeZone = 'UTC'`);
    }

    // Must return 3 distinct calendar months: 2026-01, 2026-02, 2026-03
    expect(utcStats).toHaveLength(3);
    expect(laStats).toHaveLength(3);

    // Verify exact equality between runs
    expect(laStats).toEqual(utcStats);

    // Verify boundary trades are in correct UTC buckets:
    // Month 1: 2026-01 (Trade 1 at 2026-01-31T23:50:00Z)
    expect(laStats[0].month).toBe("2026-01");
    expect(laStats[0].totalTrades).toBe(1);
    expect(laStats[0].realizedPnl).toBe("100");

    // Month 2: 2026-02 (Trade 2 at 2026-02-01T01:15:00Z and Trade 3 at 2026-02-28T23:55:00Z)
    expect(laStats[1].month).toBe("2026-02");
    expect(laStats[1].totalTrades).toBe(2);
    expect(laStats[1].realizedPnl).toBe("500");

    // Month 3: 2026-03 (Trade 4 at 2026-03-01T02:00:00Z)
    expect(laStats[2].month).toBe("2026-03");
    expect(laStats[2].totalTrades).toBe(1);
    expect(laStats[2].realizedPnl).toBe("400");
  });

  test("getPortfolioMonthlyPerformance produces identical realized P&L across UTC and America/Los_Angeles session timezones", async () => {
    let utcPerf;
    let laPerf;

    try {
      await prisma.$executeRawUnsafe(`SET TimeZone = 'UTC'`);
      utcPerf = await getPortfolioMonthlyPerformance(testPortfolio.id, testUser.id);
    } finally {
      await prisma.$executeRawUnsafe(`SET TimeZone = 'UTC'`);
    }

    try {
      await prisma.$executeRawUnsafe(`SET TimeZone = 'America/Los_Angeles'`);
      laPerf = await getPortfolioMonthlyPerformance(testPortfolio.id, testUser.id);
    } finally {
      await prisma.$executeRawUnsafe(`SET TimeZone = 'UTC'`);
    }

    expect(utcPerf.months).toHaveLength(3);
    expect(laPerf.months).toHaveLength(3);
    expect(laPerf).toEqual(utcPerf);

    // Assert realized P&L matches expected UTC buckets
    expect(laPerf.months[0].month).toBe("2026-01");
    expect(laPerf.months[0].realizedPnl).toBe("100");

    expect(laPerf.months[1].month).toBe("2026-02");
    expect(laPerf.months[1].realizedPnl).toBe("500");

    expect(laPerf.months[2].month).toBe("2026-03");
    expect(laPerf.months[2].realizedPnl).toBe("400");
  });
});
