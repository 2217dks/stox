const { Prisma } = require("@prisma/client");
const { getPortfolioDailySnapshots } = require("../../../src/services/portfolioSnapshotService");

describe("Daily Portfolio Snapshots Service", () => {
  const userId = "user-123";
  const portfolioId = "portfolio-456";

  let mockClient;

  beforeEach(() => {
    mockClient = {
      portfolio: {
        findFirst: jest.fn(),
      },
      performanceSnapshot: {
        findMany: jest.fn(),
      },
    };
  });

  describe("Validation", () => {
    test("rejects invalid 'from' date before querying database", async () => {
      await expect(
        getPortfolioDailySnapshots(userId, portfolioId, {
          from: "invalid-date",
          client: mockClient,
        }),
      ).rejects.toMatchObject({
        statusCode: 400,
        code: "INVALID_DATE_RANGE",
      });

      expect(mockClient.portfolio.findFirst).not.toHaveBeenCalled();
      expect(mockClient.performanceSnapshot.findMany).not.toHaveBeenCalled();
    });

    test("rejects invalid 'to' date before querying database", async () => {
      await expect(
        getPortfolioDailySnapshots(userId, portfolioId, {
          to: "not-a-date",
          client: mockClient,
        }),
      ).rejects.toMatchObject({
        statusCode: 400,
        code: "INVALID_DATE_RANGE",
      });

      expect(mockClient.portfolio.findFirst).not.toHaveBeenCalled();
      expect(mockClient.performanceSnapshot.findMany).not.toHaveBeenCalled();
    });

    test("rejects reversed date range where 'from' is after 'to'", async () => {
      await expect(
        getPortfolioDailySnapshots(userId, portfolioId, {
          from: "2026-11-10",
          to: "2026-11-01",
          client: mockClient,
        }),
      ).rejects.toMatchObject({
        statusCode: 400,
        code: "INVALID_DATE_RANGE",
      });

      expect(mockClient.portfolio.findFirst).not.toHaveBeenCalled();
      expect(mockClient.performanceSnapshot.findMany).not.toHaveBeenCalled();
    });

    test("rejects non-integer, zero, and negative limits before querying database", async () => {
      for (const invalidLimit of [0, -5, 10.5, "abc"]) {
        await expect(
          getPortfolioDailySnapshots(userId, portfolioId, {
            limit: invalidLimit,
            client: mockClient,
          }),
        ).rejects.toMatchObject({
          statusCode: 400,
          code: "INVALID_LIMIT",
        });
      }

      expect(mockClient.portfolio.findFirst).not.toHaveBeenCalled();
      expect(mockClient.performanceSnapshot.findMany).not.toHaveBeenCalled();
    });

    test("rejects excessively large limits exceeding 1000", async () => {
      await expect(
        getPortfolioDailySnapshots(userId, portfolioId, {
          limit: 1001,
          client: mockClient,
        }),
      ).rejects.toMatchObject({
        statusCode: 400,
        code: "INVALID_LIMIT",
      });

      expect(mockClient.portfolio.findFirst).not.toHaveBeenCalled();
      expect(mockClient.performanceSnapshot.findMany).not.toHaveBeenCalled();
    });
  });

  describe("Retrieval and Ordering", () => {
    test("throws 404 when portfolio does not belong to user", async () => {
      mockClient.portfolio.findFirst.mockResolvedValue(null);

      await expect(
        getPortfolioDailySnapshots(userId, portfolioId, { client: mockClient }),
      ).rejects.toMatchObject({
        statusCode: 404,
        code: "PORTFOLIO_NOT_FOUND",
      });
    });

    test("returns chronological snapshots with exact decimal strings and counts", async () => {
      mockClient.portfolio.findFirst.mockResolvedValue({
        id: portfolioId,
        name: "Growth Portfolio",
        currency: "USD",
        isActive: true,
      });

      const snap1 = {
        id: "snap-1",
        portfolioId,
        snapshotDate: new Date("2026-11-01T00:00:00.000Z"),
        totalValue: new Prisma.Decimal("10000.00000000"),
        cashBalance: new Prisma.Decimal("5000.00000000"),
        holdingsValue: new Prisma.Decimal("5000.00000000"),
        dailyPnl: new Prisma.Decimal("0.00000000"),
        dailyPnlPct: new Prisma.Decimal("0.0000"),
        createdAt: new Date("2026-11-01T23:59:59.000Z"),
      };
      const snap2 = {
        id: "snap-2",
        portfolioId,
        snapshotDate: new Date("2026-11-02T00:00:00.000Z"),
        totalValue: new Prisma.Decimal("10250.00000000"),
        cashBalance: new Prisma.Decimal("5000.00000000"),
        holdingsValue: new Prisma.Decimal("5250.00000000"),
        dailyPnl: new Prisma.Decimal("250.00000000"),
        dailyPnlPct: new Prisma.Decimal("0.0250"),
        createdAt: new Date("2026-11-02T23:59:59.000Z"),
      };

      // Prisma returns desc order (latest first)
      mockClient.performanceSnapshot.findMany.mockResolvedValue([snap2, snap1]);

      const result = await getPortfolioDailySnapshots(userId, portfolioId, {
        from: "2026-11-01",
        to: "2026-11-05",
        limit: 50,
        client: mockClient,
      });

      expect(result.portfolioId).toBe(portfolioId);
      expect(result.count).toBe(2);
      expect(result.from).toBe("2026-11-01");
      expect(result.to).toBe("2026-11-05");
      expect(result.snapshots).toHaveLength(2);
      expect(result.snapshots[0].totalValue).toBe("10000");
      expect(result.snapshots[1].dailyPnl).toBe("250");
      expect(result.snapshots[1].dailyPnlPct).toBe("0.025");
      expect(mockClient.performanceSnapshot.findMany).toHaveBeenCalledWith({
        where: {
          portfolioId,
          snapshotDate: {
            gte: expect.any(Date),
            lte: expect.any(Date),
          },
        },
        orderBy: { snapshotDate: "desc" },
        take: 50,
      });
    });

    test("retrieves the latest window of snapshots in chronological order when count exceeds default limit", async () => {
      mockClient.portfolio.findFirst.mockResolvedValue({
        id: portfolioId,
        name: "Growth Portfolio",
        currency: "USD",
        isActive: true,
      });

      // Simulate 100 snapshots returned by Prisma ordered by snapshotDate: "desc" (representing days 120 down to 21)
      const mockDescendingSnapshots = [];
      for (let day = 120; day >= 21; day--) {
        const dateStr = `2026-${String(Math.floor((day - 1) / 30) + 1).padStart(2, "0")}-${String(((day - 1) % 30) + 1).padStart(2, "0")}`;
        mockDescendingSnapshots.push({
          id: `snap-${day}`,
          portfolioId,
          snapshotDate: new Date(`${dateStr}T00:00:00.000Z`),
          totalValue: new Prisma.Decimal((10000 + day * 10).toFixed(8)),
          cashBalance: new Prisma.Decimal("5000.00000000"),
          holdingsValue: new Prisma.Decimal((5000 + day * 10).toFixed(8)),
          dailyPnl: new Prisma.Decimal("10.00000000"),
          dailyPnlPct: new Prisma.Decimal("0.0010"),
          createdAt: new Date(`${dateStr}T23:59:59.000Z`),
        });
      }

      mockClient.performanceSnapshot.findMany.mockResolvedValue(mockDescendingSnapshots);

      const result = await getPortfolioDailySnapshots(userId, portfolioId, {
        client: mockClient,
      });

      // Default limit of 100 was queried with desc ordering
      expect(mockClient.performanceSnapshot.findMany).toHaveBeenCalledWith({
        where: { portfolioId },
        orderBy: { snapshotDate: "desc" },
        take: 100,
      });

      // Result should be reversed into chronological (ascending) order
      expect(result.count).toBe(100);
      expect(result.snapshots[0].id).toBe("snap-21"); // Oldest in the recent window
      expect(result.snapshots[99].id).toBe("snap-120"); // Newest snapshot
      // Oldest history (days 1-20) was correctly excluded by the recent window
      expect(result.snapshots.some((s) => s.id === "snap-1" || s.id === "snap-20")).toBe(false);
    });

    test("handles empty snapshot history and returns empty array", async () => {
      mockClient.portfolio.findFirst.mockResolvedValue({
        id: portfolioId,
        name: "Growth Portfolio",
        currency: "USD",
        isActive: true,
      });

      mockClient.performanceSnapshot.findMany.mockResolvedValue([]);

      const result = await getPortfolioDailySnapshots(userId, portfolioId, {
        client: mockClient,
      });

      expect(result.count).toBe(0);
      expect(result.snapshots).toEqual([]);
      expect(mockClient.performanceSnapshot.findMany).toHaveBeenCalledWith({
        where: { portfolioId },
        orderBy: { snapshotDate: "desc" },
        take: 100,
      });
    });

    test("supports custom date ranges with custom limits", async () => {
      mockClient.portfolio.findFirst.mockResolvedValue({
        id: portfolioId,
        name: "Growth Portfolio",
        currency: "USD",
        isActive: true,
      });

      const customSnapshots = [
        {
          id: "snap-custom-2",
          portfolioId,
          snapshotDate: new Date("2026-05-10T00:00:00.000Z"),
          totalValue: new Prisma.Decimal("11000.00000000"),
          cashBalance: new Prisma.Decimal("5000.00000000"),
          holdingsValue: new Prisma.Decimal("6000.00000000"),
          dailyPnl: new Prisma.Decimal("100.00000000"),
          dailyPnlPct: new Prisma.Decimal("0.0091"),
          createdAt: new Date("2026-05-10T23:59:59.000Z"),
        },
        {
          id: "snap-custom-1",
          portfolioId,
          snapshotDate: new Date("2026-05-01T00:00:00.000Z"),
          totalValue: new Prisma.Decimal("10900.00000000"),
          cashBalance: new Prisma.Decimal("5000.00000000"),
          holdingsValue: new Prisma.Decimal("5900.00000000"),
          dailyPnl: new Prisma.Decimal("50.00000000"),
          dailyPnlPct: new Prisma.Decimal("0.0046"),
          createdAt: new Date("2026-05-01T23:59:59.000Z"),
        },
      ];

      mockClient.performanceSnapshot.findMany.mockResolvedValue(customSnapshots);

      const result = await getPortfolioDailySnapshots(userId, portfolioId, {
        from: "2026-05-01",
        to: "2026-05-10",
        limit: 20,
        client: mockClient,
      });

      expect(result.from).toBe("2026-05-01");
      expect(result.to).toBe("2026-05-10");
      expect(result.count).toBe(2);
      // Chronological ascending order
      expect(result.snapshots[0].id).toBe("snap-custom-1");
      expect(result.snapshots[1].id).toBe("snap-custom-2");
      expect(mockClient.performanceSnapshot.findMany).toHaveBeenCalledWith({
        where: {
          portfolioId,
          snapshotDate: {
            gte: new Date("2026-05-01"),
            lte: new Date("2026-05-10"),
          },
        },
        orderBy: { snapshotDate: "desc" },
        take: 20,
      });
    });
  });
});
